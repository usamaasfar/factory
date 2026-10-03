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
  signal?: AbortSignal;
  timeout?: number;
  onOutput?: (text: string) => void;
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

/** A disposable Docker container backed by a persistent, credential-free workspace. */
export class DockerSandbox {
  readonly id: string;
  readonly #options: DockerSandboxOptions;
  #containerId?: string;
  #executing = false;

  private constructor(options: DockerSandboxOptions) {
    this.id = `factory:workflow-session:${options.sessionId}`;
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
    if (this.#executing) throw new Error("The sandbox is already executing a command");
    if (options.signal?.aborted) throw new SandboxCommandInterrupted("aborted");
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
      throw new Error(`Invalid command timeout: ${options.timeout}`);
    }

    this.#executing = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;

    try {
      const containerId = await this.#runningContainer();
      const args = ["docker", "exec", "--workdir", workspacePath(options.cwd ?? WORKSPACE)];
      for (const [name, value] of Object.entries(options.env ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0")) {
          throw new Error(`Invalid environment variable: ${name}`);
        }
        args.push("--env", `${name}=${value}`);
      }
      args.push(containerId, "/bin/bash", "-lc", command);

      const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const stdout = readOutput(child.stdout, options.onOutput);
      const stderr = readOutput(child.stderr, options.onOutput);
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
        // Docker has no reliable CLI operation for signalling one exec process tree. Destroying the disposable
        // container guarantees that an aborted command cannot continue in the background.
        await this.#removeContainer();
        child.kill();
        await Promise.allSettled([stdout, stderr, child.exited]);
        throw error;
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (abort) options.signal?.removeEventListener("abort", abort);
      this.#executing = false;
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
    const workspace = resolve(this.#options.workspace);
    const containerId = await output([
      "docker",
      "run",
      "--detach",
      "--rm",
      "--init",
      "--read-only",
      "--mount",
      `type=bind,source=${workspace},target=${WORKSPACE}`,
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

async function readOutput(stream: ReadableStream<Uint8Array>, onOutput?: (text: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    output += text;
    if (text) onOutput?.(text);
  }

  const tail = decoder.decode();
  output += tail;
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
