import { posix, resolve } from "node:path";

const WORKSPACE = "/workspace";

export type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxCommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  signal?: AbortSignal;
  timeout?: number;
  onOutput?: (text: string) => void;
  captureOutput?: boolean;
};

export class SandboxCommandInterrupted extends Error {
  readonly reason: "aborted" | "timeout";

  constructor(reason: "aborted" | "timeout") {
    super(reason === "aborted" ? "Sandbox command was aborted" : "Sandbox command timed out");
    this.name = "SandboxCommandInterrupted";
    this.reason = reason;
  }
}

type DockerSandboxOptions = {
  sessionId: string;
  image: string;
  workspace: string;
  cpu: number;
  memory: number;
  network?: "bridge" | "none";
};

type SandboxProcessOptions = SandboxCommandOptions & {
  stdin?: string | Uint8Array;
};

/** A disposable Docker container backed by a persistent, credential-free workspace. */
export class DockerSandbox {
  readonly id: string;
  readonly workspace: string;
  readonly #options: DockerSandboxOptions;
  #containerId?: string;
  #queue: Promise<void> = Promise.resolve();

  private constructor(options: DockerSandboxOptions) {
    this.id = `factory:workflow-session:${options.sessionId}`;
    this.workspace = resolve(options.workspace);
    this.#options = options;
  }

  static async start(options: DockerSandboxOptions): Promise<DockerSandbox> {
    assertName(options.sessionId, "workflow session ID");
    assertPositive(options.cpu, "CPU limit");
    assertPositive(options.memory, "memory limit");

    const sandbox = new DockerSandbox(options);
    await removeSessionContainers(options.sessionId);
    await sandbox.#createContainer();
    return sandbox;
  }

  async exec(command: string, options: SandboxCommandOptions = {}): Promise<SandboxCommandResult> {
    const environment = environmentEntries(options.env);
    const process =
      options.inheritEnv === false
        ? ["/usr/bin/env", "-i", ...environment, "/bin/bash", "-lc", command]
        : ["/bin/bash", "-lc", command];
    return this.run(process, options.inheritEnv === false ? { ...options, env: undefined } : options);
  }

  async run(command: string[], options: SandboxProcessOptions = {}): Promise<SandboxCommandResult> {
    const previous = this.#queue;
    let release = () => {};
    this.#queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      return await this.#run(command, options);
    } finally {
      release();
    }
  }

  async #run(command: string[], options: SandboxProcessOptions): Promise<SandboxCommandResult> {
    if (command.length === 0 || command.some((argument) => argument.includes("\0"))) {
      throw new Error("Sandbox process arguments must be non-empty and contain no NUL bytes");
    }
    if (options.signal?.aborted) throw new SandboxCommandInterrupted("aborted");
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
      throw new Error(`Invalid command timeout: ${options.timeout}`);
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;

    try {
      const containerId = await this.#runningContainer();
      const args = ["docker", "exec"];
      if (options.stdin !== undefined) args.push("--interactive");
      args.push("--workdir", workspacePath(options.cwd ?? WORKSPACE));
      for (const entry of environmentEntries(options.env)) args.push("--env", entry);
      args.push(containerId, ...command);

      const child = Bun.spawn(args, {
        stdin: options.stdin === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      if (options.stdin !== undefined) {
        if (!child.stdin) {
          await this.#removeContainer();
          child.kill();
          throw new Error("Docker exec did not open stdin");
        }
        try {
          child.stdin.write(options.stdin);
          child.stdin.end();
        } catch (error) {
          await this.#removeContainer();
          child.kill();
          throw error;
        }
      }

      const capture = options.captureOutput ?? true;
      const stdout = readOutput(child.stdout, capture, options.onOutput);
      const stderr = readOutput(child.stderr, capture, options.onOutput);
      const interrupted = new Promise<never>((_, reject) => {
        const interrupt = (reason: "aborted" | "timeout") => reject(new SandboxCommandInterrupted(reason));
        abort = () => interrupt("aborted");
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        if (options.timeout !== undefined) timeout = setTimeout(() => interrupt("timeout"), options.timeout);
      });

      try {
        const [stdoutText, stderrText, exitCode] = await Promise.race([
          Promise.all([stdout, stderr, child.exited]),
          interrupted,
        ]);
        return { exitCode, stdout: stdoutText, stderr: stderrText };
      } catch (error) {
        // Docker cannot reliably signal one exec process tree through its CLI. Destroying the disposable container
        // guarantees that an interrupted command cannot continue in the background.
        await this.#removeContainer();
        child.kill();
        await Promise.allSettled([stdout, stderr, child.exited]);
        throw error;
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (abort) options.signal?.removeEventListener("abort", abort);
    }
  }

  async stop(): Promise<void> {
    await this.#removeContainer();
  }

  async #runningContainer(): Promise<string> {
    if (this.#containerId && (await isContainerRunning(this.#containerId))) return this.#containerId;
    this.#containerId = undefined;
    return this.#createContainer();
  }

  async #createContainer(): Promise<string> {
    const containerId = await output([
      "docker",
      "run",
      "--detach",
      "--rm",
      "--init",
      "--read-only",
      "--mount",
      `type=bind,source=${this.workspace},target=${WORKSPACE}`,
      "--tmpfs",
      "/tmp:rw,nosuid,size=256m",
      "--tmpfs",
      "/home/factory:rw,nosuid,size=256m,uid=1000,gid=1000,mode=0700",
      "--cpus",
      String(this.#options.cpu),
      "--memory",
      `${this.#options.memory}g`,
      "--pids-limit",
      "512",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--network",
      this.#options.network ?? "bridge",
      "--label",
      `com.factory.session=${this.#options.sessionId}`,
      "--entrypoint",
      "sleep",
      this.#options.image,
      "infinity",
    ]);
    this.#containerId = containerId;
    return containerId;
  }

  async #removeContainer(): Promise<void> {
    const containerId = this.#containerId;
    this.#containerId = undefined;
    if (!containerId) return;

    const child = Bun.spawn(["docker", "rm", "--force", containerId], { stdout: "ignore", stderr: "pipe" });
    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;
    if (exitCode !== 0 && !stderr.includes("No such container")) {
      throw new Error(`Failed to remove sandbox: ${stderr.trim()}`);
    }
  }
}

function workspacePath(path: string): string {
  const absolute = posix.resolve(WORKSPACE, path);
  if (absolute !== WORKSPACE && !absolute.startsWith(`${WORKSPACE}/`)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

function environmentEntries(environment: Record<string, string> | undefined): string[] {
  return Object.entries(environment ?? {}).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0")) {
      throw new Error(`Invalid environment variable: ${name}`);
    }
    return `${name}=${value}`;
  });
}

async function readOutput(
  stream: ReadableStream<Uint8Array>,
  capture: boolean,
  onOutput?: (text: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (capture) output += text;
    if (text) onOutput?.(text);
  }

  const tail = decoder.decode();
  if (capture) output += tail;
  if (tail) onOutput?.(tail);
  return output;
}

async function removeSessionContainers(sessionId: string): Promise<void> {
  const ids = (await output(["docker", "ps", "--all", "--quiet", "--filter", `label=com.factory.session=${sessionId}`]))
    .split("\n")
    .filter(Boolean);
  if (ids.length === 0) return;

  const child = Bun.spawn(["docker", "rm", "--force", ...ids], { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`Failed to remove stale sandbox: ${stderr.trim()}`);
}

async function isContainerRunning(containerId: string): Promise<boolean> {
  const child = Bun.spawn(["docker", "inspect", "--format", "{{.State.Running}}", containerId], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(child.stdout).text();
  return (await child.exited) === 0 && stdout.trim() === "true";
}

async function output(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${args[0]} ${args[1] ?? ""} failed: ${stderr.trim()}`);
  return stdout.trim();
}

function assertName(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${label}: ${value}`);
}
