import { Buffer } from "node:buffer";
import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import {
  type ExecutionEnv,
  ExecutionError,
  type ExecutionErrorCode,
  err,
  FileError,
  getOrThrow,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  toError,
} from "@earendil-works/pi-durable/env";
import { SandboxFiles } from "./files.ts";

/** Pi's environment adapter stays in the SDK, not in individual providers. */
export class SandboxExecutionEnv extends SandboxFiles implements ExecutionEnv {
  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    let spillPath: string | undefined;
    let prefix: Uint8Array[] = [];
    let bytes = 0;
    let newlines = 0;
    // Preserve output already received even when the command itself is cancelled.
    const cleanupContext = withoutAbortSignal(context);
    try {
      const spill = options?.spill;
      if (spill && ![spill.afterBytes, spill.afterLines].every((n) => Number.isSafeInteger(n) && n >= 0)) {
        throw new TypeError("Spill thresholds must be non-negative safe integers");
      }
      const result = await this.sandbox.exec(command, {
        cwd: posix.resolve(this.cwd, options?.cwd ?? "."),
        env: options?.env,
        inheritEnv: options?.inheritEnv,
        timeout: options?.timeout,
        signal: context.abortSignal,
        onData: spill
          ? async ({ data }) => {
              if (spillPath !== undefined) {
                getOrThrow(await this.appendFile(spillPath, data, cleanupContext));
                return;
              }
              bytes += data.length;
              for (const byte of data) if (byte === 10) newlines++;
              prefix.push(data.slice());
              const lines = newlines + (data.length > 0 && data[data.length - 1] !== 10 ? 1 : 0);
              if (bytes > spill.afterBytes || lines > spill.afterLines) {
                spillPath = getOrThrow(
                  await this.createTempFile({ prefix: "pi-output-", suffix: ".log" }, cleanupContext),
                );
                getOrThrow(await this.writeFile(spillPath, Buffer.concat(prefix), cleanupContext));
                prefix = [];
              }
            }
          : undefined,
        onOutput: (text) => {
          try {
            options?.onOutput?.(text, context);
          } catch (error) {
            const cause = toError(error);
            throw new ExecutionError("callback_error", cause.message, cause);
          }
        },
      });
      return ok({ ...result, ...(spillPath === undefined ? {} : { spillPath }) });
    } catch (error) {
      const cause = toError(error);
      let code: ExecutionErrorCode = "spawn_error";
      if (error instanceof AggregateError) code = "unknown";
      else if (context.abortSignal?.aborted || cause.name === "AbortError") code = "aborted";
      else if (cause.name === "TimeoutError") code = "timeout";
      else if (cause instanceof TypeError || cause instanceof FileError) code = "unknown";
      const failure = error instanceof ExecutionError ? error : new ExecutionError(code, cause.message, cause);
      if (spillPath !== undefined) failure.spillPath = spillPath;
      return err(failure);
    }
  }
}
