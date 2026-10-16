import { Buffer } from "node:buffer";
import { posix } from "node:path";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type {
  ExecOptions,
  ExecResult,
  OperationOptions,
  SandboxCommand,
  SandboxOptions,
  SandboxOutput,
  SandboxProcess,
} from "./command.ts";
import { SandboxExecutionEnv } from "./environment.ts";
import { execute } from "./process.ts";

/** A command-backed Linux sandbox. Providers implement only start(). */
export abstract class Sandbox {
  readonly id: string;
  readonly cwd: string;
  readonly #active = new Map<AbortController, { signal: AbortSignal; completion: Promise<unknown> }>();

  constructor(options: SandboxOptions) {
    if (!options.id) throw new TypeError("Sandbox id is required");
    const cwd = options.cwd ?? "/workspace";
    if (!posix.isAbsolute(cwd)) throw new TypeError("Sandbox cwd must be an absolute Linux path");
    validatePath(cwd);
    this.id = options.id;
    this.cwd = posix.normalize(cwd);
  }

  /** A rejected start must clean up any execution it already created. */
  protected abstract start(command: SandboxCommand): Promise<SandboxProcess>;

  /**
   * Create a Pi Durable 1.0.2 environment with its own cwd and temporary files.
   * Environments created from this handle share its active execution scope.
   */
  toExecutionEnv(cwd = this.cwd): ExecutionEnv {
    return new SandboxExecutionEnv(this, cwd);
  }

  /** Stream output without accumulating it. Nonzero exits are results; transport failures reject. */
  exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    return this.#operate(options, async (signal) => {
      const decoders = {
        stdout: new TextDecoder("utf-8", { ignoreBOM: true }),
        stderr: new TextDecoder("utf-8", { ignoreBOM: true }),
      };
      const exitCode = await this.#run(command, options, signal, async (output) => {
        await options.onData?.(output);
        signal.throwIfAborted();
        const { stream, data } = output;
        if (!options.onOutput) return;
        const text = decoders[stream].decode(data, { stream: true });
        if (text) await options.onOutput(text, stream);
      });
      for (const stream of ["stdout", "stderr"] as const) {
        signal.throwIfAborted();
        const text = decoders[stream].decode();
        if (text) await options.onOutput?.(text, stream);
      }
      return { exitCode };
    });
  }

  /** Buffer a regular file from the sandbox. Relative paths resolve against cwd. */
  async readFile(path: string, options: OperationOptions = {}): Promise<Uint8Array> {
    const target = quote(this.#path(path));
    return this.#file(
      `test -f ${target} || { printf 'Not a regular file: %s\\n' ${target} >&2; exit 1; }\ncat -- ${target}`,
      options,
    );
  }

  async readTextFile(path: string, options: OperationOptions = {}): Promise<string> {
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await this.readFile(path, options));
  }

  /** Create parent directories and replace the file with the supplied bytes or UTF-8 text. */
  async writeFile(path: string, content: string | Uint8Array, options: OperationOptions = {}): Promise<void> {
    const target = this.#path(path);
    const input = typeof content === "string" ? new TextEncoder().encode(content) : content;
    await this.#file(`mkdir -p -- ${quote(posix.dirname(target))} && cat > ${quote(target)}`, options, input);
  }

  /** Cancel and await current operations. Does not close the handle or remove infrastructure. */
  async cleanup(): Promise<void> {
    const operations = [...this.#active];
    for (const [controller] of operations) controller.abort();
    const errors: unknown[] = [];
    await Promise.all(
      operations.map(async ([, operation]) => {
        try {
          await operation.completion;
        } catch (error) {
          if (error !== operation.signal.reason) errors.push(error);
        }
      }),
    );
    if (errors.length > 0) throw new AggregateError(errors, "Sandbox cleanup failed");
  }

  #path(path: string): string {
    validatePath(path);
    return posix.resolve(this.cwd, path);
  }

  #run(
    command: string,
    options: ExecOptions,
    signal: AbortSignal,
    onOutput: (output: SandboxOutput) => void | Promise<void>,
  ): Promise<number> {
    if (command.includes("\0")) throw new TypeError("Command contains NUL");
    const env = { ...options.env };
    for (const [name, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || value.includes("\0")) {
        throw new TypeError(`Invalid environment variable: ${name}`);
      }
    }
    return execute(
      (command) => this.start(command),
      {
        command,
        cwd: this.#path(options.cwd ?? "."),
        env,
        inheritEnv: options.inheritEnv ?? true,
        stdin: options.stdin,
        signal,
      },
      onOutput,
    );
  }

  #file(command: string, options: OperationOptions, stdin?: Uint8Array): Promise<Uint8Array> {
    return this.#operate(options, async (signal) => {
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      let errorBytes = 0;
      const exitCode = await this.#run(command, { cwd: "/", stdin, inheritEnv: false }, signal, ({ stream, data }) => {
        if (stream === "stdout") stdout.push(data.slice());
        else if (errorBytes < 8192) {
          const chunk = data.slice(0, 8192 - errorBytes);
          stderr.push(chunk);
          errorBytes += chunk.length;
        }
      });
      if (exitCode !== 0) {
        const message = new TextDecoder().decode(Buffer.concat(stderr)).trim();
        throw new Error(`Sandbox file operation failed (${exitCode})${message ? `: ${message}` : ""}`);
      }
      return Buffer.concat(stdout);
    });
  }

  async #operate<T>(options: OperationOptions, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const milliseconds = options.timeout === undefined ? undefined : options.timeout * 1000;
    if (
      milliseconds !== undefined &&
      (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 2_147_483_647)
    ) {
      throw new TypeError("Timeout must be positive and at most 2147483.647 seconds");
    }
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const timer =
      milliseconds === undefined
        ? undefined
        : setTimeout(() => {
            controller.abort(
              new DOMException(`Sandbox operation timed out after ${options.timeout} seconds`, "TimeoutError"),
            );
          }, milliseconds);
    const completion = Promise.resolve()
      .then(async () => {
        signal.throwIfAborted();
        const value = await action(signal);
        signal.throwIfAborted();
        return value;
      })
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    this.#active.set(controller, { signal, completion });
    try {
      return await completion;
    } finally {
      this.#active.delete(controller);
    }
  }
}

function validatePath(path: string): void {
  if (path.includes("\0")) throw new TypeError("Path contains NUL");
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
