import { posix, resolve } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { DockerExecutionEnv } from "./execution-env.ts";

const WORKSPACE = "/workspace";

export interface SandboxesOptions {
  image: string;
}

/** Reopens one disposable container and persistent volume per Pi conversation. */
export class Sandboxes {
  readonly #image: string;
  readonly #sandboxes = new Map<ConversationId, DockerSandbox>();

  constructor(options: SandboxesOptions) {
    this.#image = options.image;
  }

  async open(conversationId: ConversationId, context: Context): Promise<DockerExecutionEnv> {
    const sandbox = this.#get(conversationId);
    await sandbox.ensure(context);
    return new DockerExecutionEnv(sandbox);
  }

  async replace(conversationId: ConversationId, directory: string, context: Context): Promise<void> {
    await this.#get(conversationId).replace(directory, context);
  }

  async close(context: Context): Promise<void> {
    const sandboxes = [...this.#sandboxes.values()];
    this.#sandboxes.clear();
    await Promise.all(sandboxes.map((sandbox) => sandbox.remove(context)));
  }

  #get(conversationId: ConversationId): DockerSandbox {
    let sandbox = this.#sandboxes.get(conversationId);
    if (!sandbox) {
      sandbox = new DockerSandbox(String(conversationId), this.#image);
      this.#sandboxes.set(conversationId, sandbox);
    }
    return sandbox;
  }
}

export interface SandboxProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  input?: string | Uint8Array;
  timeoutMs?: number;
  onOutput?: (text: string) => void;
}

export interface SandboxProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class SandboxInterrupted extends Error {
  constructor(readonly reason: "aborted" | "timeout") {
    super(`Sandbox command ${reason}`);
    this.name = "SandboxInterrupted";
  }
}

export class DockerSandbox {
  readonly id: string;
  readonly name: string;
  readonly volume: string;
  readonly #image: string;
  #ensuring?: Promise<void>;

  constructor(id: string, image: string) {
    const suffix = safeName(id);
    this.id = `factory:${id}`;
    this.name = `factory-${suffix}`;
    this.volume = `factory-${suffix}`;
    this.#image = image;
  }

  ensure(context: Context): Promise<void> {
    this.#ensuring ??= this.#ensure(context).finally(() => {
      this.#ensuring = undefined;
    });
    return this.#ensuring;
  }

  async exec(
    command: string,
    options: SandboxProcessOptions | undefined,
    context: Context,
  ): Promise<SandboxProcessResult> {
    await this.ensure(context);
    const args = ["docker", "exec"];
    if (options?.input !== undefined) args.push("--interactive");
    args.push("--workdir", workspacePath(options?.cwd ?? WORKSPACE));
    for (const [name, value] of Object.entries(options?.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || value.includes("\0")) {
        throw new Error(`Invalid environment variable: ${name}`);
      }
      args.push("--env", `${name}=${value}`);
    }
    if (options?.inheritEnv === false) {
      args.push(this.name, "/usr/bin/env", "-i", "/bin/bash", "-c", command);
    } else {
      args.push(this.name, "/bin/bash", "-c", command);
    }
    return run(args, options, context, () => this.remove(BACKGROUND_CONTEXT));
  }

  async replace(directory: string, context: Context): Promise<void> {
    await this.ensure(context);
    await checkedDocker(
      [
        "run",
        "--rm",
        "--mount",
        `type=volume,source=${this.volume},target=${WORKSPACE}`,
        "--mount",
        `type=bind,source=${resolve(directory)},target=/source,readonly`,
        "--entrypoint",
        "/bin/sh",
        this.#image,
        "-c",
        "find /workspace -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && cp -a /source/. /workspace/",
      ],
      context,
    );
  }

  async remove(context: Context): Promise<void> {
    const result = await docker(["rm", "--force", this.name], context, true);
    if (result.exitCode !== 0 && !result.stderr.includes("No such container")) {
      throw new Error(`Could not remove sandbox ${this.name}: ${result.stderr.trim()}`);
    }
  }

  async #ensure(context: Context): Promise<void> {
    const state = await docker(["inspect", "--format", "{{.State.Running}}", this.name], context, true);
    if (state.exitCode === 0) {
      if (state.stdout.trim() !== "true") await checkedDocker(["start", this.name], context);
      return;
    }

    await checkedDocker(["volume", "create", this.volume], context);
    const created = await docker(
      [
        "run",
        "--detach",
        "--name",
        this.name,
        "--init",
        "--read-only",
        "--mount",
        `type=volume,source=${this.volume},target=${WORKSPACE}`,
        "--tmpfs",
        "/tmp:rw,nosuid,size=256m",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--workdir",
        WORKSPACE,
        "--entrypoint",
        "sleep",
        this.#image,
        "infinity",
      ],
      context,
      true,
    );
    if (created.exitCode === 0) return;

    // Another process may have created the stable container between inspect and run.
    const retry = await docker(["inspect", "--format", "{{.State.Running}}", this.name], context, true);
    if (retry.exitCode !== 0) throw new Error(`Could not create sandbox ${this.name}: ${created.stderr.trim()}`);
    if (retry.stdout.trim() !== "true") await checkedDocker(["start", this.name], context);
  }
}

async function checkedDocker(args: string[], context: Context): Promise<SandboxProcessResult> {
  const result = await docker(args, context);
  if (result.exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  return result;
}

async function docker(args: string[], context: Context, allowFailure = false): Promise<SandboxProcessResult> {
  return run(["docker", ...args], undefined, context).then((result) => {
    if (!allowFailure && result.exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
    return result;
  });
}

async function run(
  args: string[],
  options: SandboxProcessOptions | undefined,
  context: Context,
  interrupt: () => Promise<void> = async () => {},
): Promise<SandboxProcessResult> {
  if (context.abortSignal?.aborted) throw new SandboxInterrupted("aborted");
  const child = Bun.spawn(args, {
    stdin: options?.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options?.input !== undefined) {
    const stdin = child.stdin;
    if (!stdin) throw new Error("Docker command did not open stdin");
    stdin.write(options.input);
    stdin.end();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const stop = (reason: "aborted" | "timeout") => {
      void interrupt().finally(() => child.kill());
      reject(new SandboxInterrupted(reason));
    };
    abort = () => stop("aborted");
    context.abortSignal?.addEventListener("abort", abort, { once: true });
    if (options?.timeoutMs !== undefined) timer = setTimeout(() => stop("timeout"), options.timeoutMs);
  });

  const stdout = readText(child.stdout, options?.onOutput);
  const stderr = readText(child.stderr, options?.onOutput);
  try {
    const [stdoutText, stderrText, exitCode] = await Promise.race([
      Promise.all([stdout, stderr, child.exited]),
      interrupted,
    ]);
    return { exitCode, stdout: stdoutText, stderr: stderrText };
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) context.abortSignal?.removeEventListener("abort", abort);
  }
}

async function readText(stream: ReadableStream<Uint8Array>, onOutput?: (text: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    result += text;
    if (text) onOutput?.(text);
  }
  const tail = decoder.decode();
  if (tail) onOutput?.(tail);
  return result + tail;
}

function workspacePath(path: string): string {
  const normalized = posix.resolve(WORKSPACE, path);
  if (normalized !== WORKSPACE && !normalized.startsWith(`${WORKSPACE}/`)) {
    throw new Error(`Path is outside ${WORKSPACE}: ${path}`);
  }
  return normalized;
}

function safeName(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/gu, "-")
    .slice(0, 63);
  if (!safe) throw new Error("Conversation ID cannot form a Docker name");
  return safe;
}
