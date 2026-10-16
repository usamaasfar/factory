import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { finished } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import type Docker from "dockerode";
import { Sandbox, type SandboxCommand, type SandboxOutput, type SandboxProcess } from "factory-oss/sandbox";

// Each command gets a process group. Background jobs in that group do not
// outlive their command. The wrapper itself stays outside the group to reap it.
// Bash -p keeps BASH_ENV and SHELLOPTS out of supervision, not the user shell.
const RUN = String.raw`
set +e
set +m
control=$1
/usr/bin/mkdir -p -- "$control" || exit 125
if [[ -e "$control/cancel" ]]; then
  /usr/bin/rm -rf -- "$control"
  exit 137
fi
/usr/bin/setsid /bin/bash -p -c '
  control=$1
  printf "%s\n" "$$" > "$control/pid.tmp" || exit 125
  /usr/bin/mv -- "$control/pid.tmp" "$control/pid" || exit 125
  [[ ! -e "$control/cancel" ]] || exit 137
  exec /bin/bash -c "$2"
' factory-child "$control" "$2" <&0 &
pid=$!
wait "$pid"
status=$?
kill -KILL -- "-$pid" 2>/dev/null || true
/usr/bin/rm -rf -- "$control"
exit "$status"
`;

// The marker covers cancellation before RUN has published its process group.
const STOP = `
control=$1
/usr/bin/mkdir -p -- "$control" || exit 1
: > "$control/cancel" || exit 1
if [[ -s "$control/pid" ]]; then
  read -r pid < "$control/pid" || exit 1
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || exit 1
  kill -KILL -- "-$pid" 2>/dev/null || true
fi
`;

export class DockerSandbox extends Sandbox {
  constructor(
    private readonly container: Docker.Container,
    id: string,
  ) {
    super({ id, cwd: "/workspace" });
  }

  protected override async start(command: SandboxCommand): Promise<SandboxProcess> {
    command.signal.throwIfAborted();
    // Docker may report an invalid WorkingDir as an ordinary exec exit after
    // hijacking. Check it through the native archive stat API before starting.
    // The trailing /. follows directory symlinks rather than statting the link.
    const response: IncomingMessage = await this.container.infoArchive({
      path: `${command.cwd}/.`,
      abortSignal: command.signal,
    });
    const metadata = response.headers["x-docker-container-path-stat"];
    await finished(response.resume(), { cleanup: true });
    if (typeof metadata !== "string") throw new Error("Docker did not provide working directory metadata");
    const directory: unknown = JSON.parse(Buffer.from(metadata, "base64").toString("utf8"));
    if (
      typeof directory !== "object" ||
      directory === null ||
      !("mode" in directory) ||
      typeof directory.mode !== "number" ||
      (directory.mode & 0x80000000) === 0
    ) {
      throw new Error(`Sandbox working directory is not a directory: ${command.cwd}`);
    }
    const control = `/tmp/factory-exec-${randomUUID()}`;
    const env = Object.entries(command.env).map(([name, value]) => `${name}=${value}`);
    const source = ["/bin/bash", "-p", "-c", RUN, "factory-command", control, command.command];
    const execution = await this.container.exec({
      Cmd: command.inheritEnv ? source : ["/usr/bin/env", "-i", ...env, ...source],
      Env: command.inheritEnv ? env : undefined,
      WorkingDir: command.cwd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      abortSignal: command.signal,
    });
    command.signal.throwIfAborted(); // An exec creation alone does not run anything.
    let stream: Duplex;
    const transport = new AbortController();
    let interrupted: Promise<number | undefined> | undefined;
    const abort = () => {
      // First arm native cancellation and confirm termination. Only then abort
      // the HTTP request; losing an exec-start response is not a process kill.
      interrupted = stopCommand(this.container, execution, control).finally(() =>
        transport.abort(command.signal.reason),
      );
      void interrupted.catch(() => {});
    };
    command.signal.addEventListener("abort", abort, { once: true });
    try {
      command.signal.throwIfAborted();
      stream = await execution.start({ hijack: true, stdin: true, Tty: false, abortSignal: transport.signal });
      if (interrupted) {
        stream.destroy();
        await interrupted;
        command.signal.throwIfAborted();
      }
    } catch (error) {
      try {
        await (interrupted ?? stopCommand(this.container, execution, control));
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Docker command startup cleanup failed");
      }
      throw error;
    } finally {
      command.signal.removeEventListener("abort", abort);
    }

    const observer = new AbortController();
    const completion = Promise.withResolvers<number>();
    // Docker has no exec-wait endpoint. Observe exit independently of output
    // consumption, which may be backpressured by an SDK output callback.
    const monitoring = waitForExit(execution, observer.signal).then(completion.resolve, completion.reject);
    stream.once("error", (error) => {
      completion.reject(error);
      observer.abort(error);
    });
    // Half-close stdin without closing stdout/stderr. Do not await input delivery
    // here: a command may produce output before it consumes a large input.
    stream.end(command.stdin);
    let stopping: Promise<void> | undefined;
    return {
      output: output(stream),
      exited: completion.promise,
      stop: () =>
        (stopping ??= (async () => {
          try {
            const code = await stopCommand(this.container, execution, control);
            completion.resolve(code ?? 137);
          } catch (error) {
            completion.reject(error);
            throw error;
          } finally {
            observer.abort();
            stream.destroy();
            await monitoring;
          }
        })()),
    };
  }
}

async function stopCommand(
  container: Docker.Container,
  execution: Docker.Exec,
  control: string,
): Promise<number | undefined> {
  const signal = AbortSignal.timeout(10_000);
  try {
    const before = await execution.inspect({ abortSignal: signal });
    if (!before.Running && before.ExitCode !== null) return before.ExitCode;
    const stop = await container.exec({
      Cmd: ["/bin/bash", "-p", "-c", STOP, "factory-stop", control],
      Tty: false,
      abortSignal: signal,
    });
    const response = await stop.start({ Detach: true, abortSignal: signal });
    await finished(response.resume(), { cleanup: true });
    const status = await waitForExit(stop, signal);
    const after = await execution.inspect({ abortSignal: signal });
    if (!after.Running) {
      // A not-yet-started exec is safe only after the marker was armed.
      if (after.ExitCode === null && status !== 0) throw new Error("Could not arm Docker command cancellation");
      return after.ExitCode ?? undefined;
    }
    // The supervisor may be finishing while STOP observes disappearing control
    // files. Its actual exit, not the control command's status, is authoritative.
    return await waitForExit(execution, signal);
  } catch (error) {
    if (hasStatus(error, 404)) {
      // Exec metadata alone is not proof of termination. Confirm that the
      // container itself is gone or stopped before treating a 404 as success.
      try {
        const info = await container.inspect({ abortSignal: signal });
        if (!info.State.Running) return undefined;
      } catch (inspectionError) {
        if (hasStatus(inspectionError, 404)) return undefined;
        throw new AggregateError([error, inspectionError], "Cannot confirm Docker command termination");
      }
    }
    throw error;
  }
}

function hasStatus(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === code;
}

async function waitForExit(execution: Docker.Exec, signal?: AbortSignal): Promise<number> {
  while (true) {
    const info = await execution.inspect({ abortSignal: signal });
    if (!info.Running && info.ExitCode !== null) return info.ExitCode;
    await delay(100, undefined, { signal });
  }
}

/** Decode Docker's non-TTY, eight-byte stream headers without buffering all output. */
async function* output(stream: Duplex): AsyncGenerator<SandboxOutput> {
  let buffered = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 8) {
        const type = buffered[0];
        if ((type !== 1 && type !== 2 && type !== 3) || buffered.readUIntBE(1, 3) !== 0) {
          throw new Error("Invalid Docker output frame");
        }
        const length = buffered.readUInt32BE(4);
        if (buffered.length < 8 + length) break;
        const data = buffered.subarray(8, 8 + length);
        buffered = buffered.subarray(8 + length);
        if (type === 3) throw new Error(`Docker execution failed: ${data.toString("utf8")}`);
        yield { stream: type === 1 ? "stdout" : "stderr", data };
      }
    }
    if (buffered.length > 0) throw new Error("Truncated Docker output frame");
  } finally {
    stream.destroy();
  }
}
