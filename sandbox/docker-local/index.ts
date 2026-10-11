import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createCommandSandboxEnvironment,
  type SandboxCommand,
  type SandboxCommandRunner,
  type SandboxProvider,
} from "factory-oss/sandbox";

const WORKSPACE = "/workspace";
const LABEL = "com.factory.sandbox";

const RUN_COMMAND = String.raw`
control=$2
mkdir -p -- "$control"
setsid /bin/bash -c "$1" <&0 &
pid=$!
printf '%s\n' "$pid" > "$control/pid"
if test -e "$control/cancel"; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
wait "$pid"
status=$?
rm -rf -- "$control"
exit "$status"
`;

const STOP_COMMAND = `
control=$1
mkdir -p -- "$control"
touch -- "$control/cancel"
if test -s "$control/pid"; then
  read -r pid < "$control/pid"
  kill -TERM -- "-$pid" 2>/dev/null || exit 0
  i=0
  while kill -0 -- "-$pid" 2>/dev/null && test "$i" -lt 50; do
    sleep 0.1
    i=$((i + 1))
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
fi
`;

export interface LocalDockerSandboxOptions {
  /** Image containing Bash, GNU coreutils, `setsid`, and `sleep`. */
  readonly image: string;
}

/** Persistent local sandboxes backed by Docker Engine containers and volumes. */
export function createLocalDockerSandboxProvider(options: LocalDockerSandboxOptions): SandboxProvider {
  const { image } = options;
  if (!image) throw new TypeError("Docker sandbox image is required");

  return { open, suspend, destroy };

  async function open(key: string, context: Context) {
    const resource = resourceFor(key);
    let container = await inspectContainer(resource.container, context);

    if (!container) {
      await checkedDocker(["volume", "create", "--label", `${LABEL}=${resource.identity}`, resource.volume], context);
      const volume = await inspectVolume(resource.volume, context);
      if (volume?.Labels?.[LABEL] !== resource.identity) {
        throw new Error(`Docker volume name is already in use: ${resource.volume}`);
      }

      const created = await docker(
        [
          "run",
          "--detach",
          "--name",
          resource.container,
          "--label",
          `${LABEL}=${resource.identity}`,
          "--init",
          "--read-only",
          "--mount",
          `type=volume,source=${resource.volume},target=${WORKSPACE}`,
          "--tmpfs",
          "/tmp:rw,nosuid,size=256m",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--user",
          "0:0",
          "--workdir",
          WORKSPACE,
          "--entrypoint",
          "/usr/bin/sleep",
          image,
          "infinity",
        ],
        context,
      );

      if (created.exitCode !== 0) {
        // A concurrent opener may have created the deterministic container.
        container = await inspectContainer(resource.container, context);
        if (!container) throw dockerFailure("create sandbox", created);
      } else {
        container = await inspectContainer(resource.container, context);
      }
    }

    if (!container || container.Config?.Labels?.[LABEL] !== resource.identity) {
      throw new Error(`Docker container name is already in use: ${resource.container}`);
    }
    if (!container.State?.Running) await checkedDocker(["start", resource.container], context);

    return createCommandSandboxEnvironment({
      id: `docker:local:${resource.identity}`,
      cwd: WORKSPACE,
      run: commandRunner(resource.container),
    });
  }

  async function suspend(key: string, context: Context): Promise<void> {
    const resource = resourceFor(key);
    const container = await inspectContainer(resource.container, context);
    if (container && container.Config?.Labels?.[LABEL] !== resource.identity) {
      throw new Error(`Docker container name is already in use: ${resource.container}`);
    }
    if (!container) return;

    const removed = await docker(["rm", "--force", resource.container], context);
    if (removed.exitCode !== 0 && !isMissing(removed.stderr)) throw dockerFailure("suspend sandbox", removed);
  }

  async function destroy(key: string, context: Context): Promise<void> {
    const resource = resourceFor(key);
    await suspend(key, context);

    const volume = await inspectVolume(resource.volume, context);
    if (volume && volume.Labels?.[LABEL] !== resource.identity) {
      throw new Error(`Docker volume name is already in use: ${resource.volume}`);
    }
    if (volume) {
      const removed = await docker(["volume", "rm", resource.volume], context);
      if (removed.exitCode !== 0 && !isMissing(removed.stderr)) {
        throw dockerFailure("remove sandbox volume", removed);
      }
    }
  }
}

function commandRunner(container: string): SandboxCommandRunner {
  return async (command, context) => {
    if (context.abortSignal?.aborted) throw new Error("Sandbox command aborted");

    const control = `/tmp/factory-${crypto.randomUUID()}`;
    const args = ["exec"];
    if (command.stdin !== undefined) args.push("--interactive");
    args.push("--workdir", command.cwd);

    if (command.inheritEnv) {
      for (const [name, value] of Object.entries(command.env)) args.push("--env", `${name}=${value}`);
      args.push(container, "/bin/bash", "-c", RUN_COMMAND, "factory-command", command.command, control);
    } else {
      args.push(container, "/usr/bin/env", "-i");
      for (const [name, value] of Object.entries(command.env)) args.push(`${name}=${value}`);
      args.push("/bin/bash", "-c", RUN_COMMAND, "factory-command", command.command, control);
    }

    const result = await runDockerCommand(args, command, context, () => stopCommand(container, control));
    if (result.exitCode !== 0 && isTransportFailure(result.stderr)) {
      throw dockerFailure("execute sandbox command", result);
    }
    return { exitCode: result.exitCode };
  };
}

async function stopCommand(container: string, control: string): Promise<void> {
  const result = await docker(
    ["exec", container, "/bin/bash", "-c", STOP_COMMAND, "factory-cancel", control],
    BACKGROUND_CONTEXT,
  );
  if (result.exitCode !== 0 && !isMissing(result.stderr)) throw dockerFailure("cancel sandbox command", result);
}

interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ContainerInspection {
  Config?: { Labels?: Record<string, string> };
  State?: { Running?: boolean };
}

interface VolumeInspection {
  Labels?: Record<string, string>;
}

async function inspectContainer(name: string, context: Context): Promise<ContainerInspection | undefined> {
  const result = await docker(["container", "inspect", name], context);
  if (result.exitCode !== 0) {
    if (isMissing(result.stderr)) return undefined;
    throw dockerFailure("inspect sandbox", result);
  }

  const inspections: ContainerInspection[] = JSON.parse(result.stdout);
  return inspections[0];
}

async function inspectVolume(name: string, context: Context): Promise<VolumeInspection | undefined> {
  const result = await docker(["volume", "inspect", name], context);
  if (result.exitCode !== 0) {
    if (isMissing(result.stderr)) return undefined;
    throw dockerFailure("inspect sandbox volume", result);
  }

  const inspections: VolumeInspection[] = JSON.parse(result.stdout);
  return inspections[0];
}

async function checkedDocker(args: string[], context: Context): Promise<DockerResult> {
  const result = await docker(args, context);
  if (result.exitCode !== 0) throw dockerFailure(`docker ${args[0]}`, result);
  return result;
}

async function docker(args: string[], context: Context): Promise<DockerResult> {
  if (context.abortSignal?.aborted) throw new Error("Docker operation aborted");

  const child = Bun.spawn(["docker", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const abort = () => child.kill();
  context.abortSignal?.addEventListener("abort", abort, { once: true });
  if (context.abortSignal?.aborted) abort();

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (context.abortSignal?.aborted) throw new Error("Docker operation aborted");
    return { exitCode, stdout, stderr };
  } finally {
    context.abortSignal?.removeEventListener("abort", abort);
  }
}

async function runDockerCommand(
  args: string[],
  command: SandboxCommand,
  context: Context,
  stop: () => Promise<void>,
): Promise<DockerResult> {
  const child = Bun.spawn(["docker", ...args], {
    stdin: command.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let stopping: Promise<void> | undefined;
  const interrupt = () => {
    stopping ??= stop().finally(() => child.kill());
    return stopping;
  };
  const abort = () => void interrupt();
  context.abortSignal?.addEventListener("abort", abort, { once: true });
  if (context.abortSignal?.aborted) abort();

  const input = writeInput(child, command.stdin);
  const output = forwardOutput(child.stdout, child.stderr, command.onOutput);
  try {
    const [stderr, exitCode] = await Promise.all([output, child.exited, input]);
    if (stopping) await stopping;
    if (context.abortSignal?.aborted) throw new Error("Sandbox command aborted");
    return { exitCode, stdout: "", stderr };
  } catch (error) {
    await interrupt().catch(() => undefined);
    await Promise.allSettled([child.exited, output, input]);
    throw error;
  } finally {
    context.abortSignal?.removeEventListener("abort", abort);
  }
}

async function writeInput(child: Bun.Subprocess, input: Uint8Array | undefined): Promise<void> {
  if (input === undefined) return;
  const stdin = child.stdin;
  if (!stdin || typeof stdin === "number") throw new Error("docker exec did not open stdin");
  await stdin.write(input);
  await stdin.end();
}

async function forwardOutput(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
  emit: SandboxCommand["onOutput"],
): Promise<string> {
  const readers = { stdout: stdout.getReader(), stderr: stderr.getReader() };
  const stderrChunks: Uint8Array[] = [];
  let stderrBytes = 0;
  const pending = new Map<"stdout" | "stderr", Promise<OutputRead>>();
  const read = async (stream: "stdout" | "stderr"): Promise<OutputRead> => {
    const result = await readers[stream].read();
    return result.done ? { stream, done: true } : { stream, done: false, value: result.value };
  };
  pending.set("stdout", read("stdout"));
  pending.set("stderr", read("stderr"));

  while (pending.size > 0) {
    const result = await Promise.race(pending.values());
    if (result.done) {
      pending.delete(result.stream);
      continue;
    }
    if (result.stream === "stderr" && stderrBytes < 65_536) {
      const chunk = result.value.subarray(0, 65_536 - stderrBytes);
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
    }
    await emit?.({ stream: result.stream, data: result.value });
    pending.set(result.stream, read(result.stream));
  }

  return decode(stderrChunks);
}

type OutputRead =
  | { stream: "stdout" | "stderr"; done: true }
  | { stream: "stdout" | "stderr"; done: false; value: Uint8Array };

function decode(chunks: Uint8Array[]): string {
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function resourceFor(key: string): { container: string; volume: string; identity: string } {
  if (!key) throw new TypeError("Sandbox key is required");
  const identity = new Bun.CryptoHasher("sha256").update(key).digest("hex");
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 30);
  const suffix = `${slug || "sandbox"}-${identity.slice(0, 16)}`;
  return { container: `factory-${suffix}`, volume: `factory-${suffix}`, identity };
}

function dockerFailure(operation: string, result: Pick<DockerResult, "stderr">): Error {
  return new Error(`Could not ${operation}: ${result.stderr.trim() || "Docker command failed"}`);
}

function isMissing(stderr: string): boolean {
  return /no such (?:container|object|volume)/iu.test(stderr);
}

function isTransportFailure(stderr: string): boolean {
  return /^(?:docker: |Error response from daemon:|Cannot connect to the Docker daemon)/mu.test(stderr);
}
