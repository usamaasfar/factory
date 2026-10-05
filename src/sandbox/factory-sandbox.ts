/**
 * Pi Durable execution environment backed by one command runner.
 *
 * Providers supply sandbox identity, a working directory, and command transport.
 * This class supplies Pi's shell and filesystem semantics.
 *
 * This implementation targets the installed `@earendil-works/pi-durable`
 * release. Re-audit it against Pi's `ExecutionEnv` whenever that dependency is
 * updated; Pi's unreleased `main` interface may differ.
 */

import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import { withAbortSignal, withoutAbortSignal } from "@earendil-works/chord/context";
import {
  type ExecutionEnv,
  ExecutionError,
  err,
  FileError,
  type FileErrorCode,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLine,
  type TextLineReader,
  toError,
} from "@earendil-works/pi-durable/env";
import type { SandboxCommand, SandboxCommandOutput, SandboxCommandResult, SandboxCommandRunner } from "./command.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const STATUS = {
  notFound: 40,
  permissionDenied: 41,
  notDirectory: 42,
  isDirectory: 43,
  invalid: 44,
} as const;

export interface FactorySandboxOptions {
  /** Stable identity for the sandbox's file namespace. */
  readonly id: string;
  /** Absolute POSIX working directory. */
  readonly cwd: string;
  readonly run: SandboxCommandRunner;
}

/** A complete Pi Durable environment implemented through sandbox commands. */
export class FactorySandbox implements ExecutionEnv {
  readonly id: string;
  cwd: string;

  readonly #run: SandboxCommandRunner;
  readonly #active = new Map<AbortController, Promise<unknown>>();

  constructor(options: FactorySandboxOptions) {
    if (!options.id) throw new TypeError("Sandbox id is required");
    if (!posix.isAbsolute(options.cwd) || options.cwd.includes("\0")) {
      throw new TypeError("Sandbox cwd must be an absolute POSIX path");
    }

    this.id = options.id;
    this.cwd = posix.normalize(options.cwd);
    this.#run = options.run;
  }

  async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    if (context.abortSignal?.aborted) return aborted(path);
    if (path.includes("\0")) return err(new FileError("invalid", "Path contains NUL", path));
    return ok(posix.resolve(this.cwd, path));
  }

  async joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    if (context.abortSignal?.aborted) return aborted();
    if (parts.some((part) => part.includes("\0"))) {
      return err(new FileError("invalid", "Path contains NUL"));
    }
    return ok(posix.join(...parts));
  }

  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "Operation aborted"));
    if (command.includes("\0")) return err(new ExecutionError("spawn_error", "Command contains NUL"));

    const timeout = timeoutMilliseconds(options?.timeout);
    if (!timeout.ok) return timeout;
    if (!validSpill(options?.spill)) {
      return err(new ExecutionError("unknown", "Spill thresholds must be non-negative integers"));
    }

    if (options?.cwd?.includes("\0")) return err(new ExecutionError("spawn_error", "Working directory contains NUL"));
    const cwd = posix.resolve(this.cwd, options?.cwd ?? this.cwd);
    const controller = new AbortController();
    const executionContext = withAbortSignal(controller.signal, context);
    const decoders = {
      stdout: new TextDecoder(),
      stderr: new TextDecoder(),
    };
    let callbackError: Error | undefined;
    let timedOut = false;
    let bytes = 0;
    let newlines = 0;
    let lastByte: number | undefined;
    let spillPath: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const emit = (output: SandboxCommandOutput) => {
      countOutput(output.data);
      if (!options?.onOutput || callbackError) return;
      const text = decoders[output.stream].decode(output.data, { stream: true });
      if (!text) return;
      try {
        options.onOutput(text, context);
      } catch (error) {
        callbackError = toError(error);
        controller.abort();
        throw callbackError;
      }
    };

    const countOutput = (chunk: Uint8Array) => {
      bytes += chunk.length;
      for (const byte of chunk) if (byte === 10) newlines++;
      if (chunk.length > 0) lastByte = chunk.at(-1);
    };

    try {
      let runnable = command;
      const environment = { ...(options?.env ?? {}) };
      if (options?.spill) {
        const temporary = await this.createTempFile({ prefix: "pi-output-", suffix: ".log" }, context);
        if (!temporary.ok) return err(new ExecutionError("unknown", temporary.error.message, temporary.error));
        spillPath = temporary.value;
        environment.FACTORY_SANDBOX_COMMAND = command;
        environment.FACTORY_SANDBOX_OUTPUT = spillPath;
        runnable =
          '/bin/bash -c "$FACTORY_SANDBOX_COMMAND" 2>&1 | tee -- "$FACTORY_SANDBOX_OUTPUT"; exit "$PIPESTATUS"';
      }

      if (timeout.value !== undefined) {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout.value);
      }

      const result = await this.#invoke(
        {
          command: runnable,
          cwd,
          env: environment,
          inheritEnv: options?.inheritEnv ?? true,
          onOutput: emit,
        },
        executionContext,
      );
      callbackError ??= flushDecoder(decoders.stdout, options?.onOutput, context);
      callbackError ??= flushDecoder(decoders.stderr, options?.onOutput, context);

      if (callbackError) return err(new ExecutionError("callback_error", callbackError.message, callbackError));
      if (timedOut)
        return withSpill(new ExecutionError("timeout", `Command timed out after ${options?.timeout} seconds`));
      if (context.abortSignal?.aborted) return withSpill(new ExecutionError("aborted", "Operation aborted"));

      return ok({
        exitCode: result.exitCode,
        ...(shouldKeepSpill() ? { spillPath } : {}),
      });
    } catch (error) {
      callbackError ??= flushDecoder(decoders.stdout, options?.onOutput, context);
      callbackError ??= flushDecoder(decoders.stderr, options?.onOutput, context);
      if (callbackError) return err(new ExecutionError("callback_error", callbackError.message, callbackError));
      if (timedOut)
        return withSpill(new ExecutionError("timeout", `Command timed out after ${options?.timeout} seconds`));
      if (error instanceof OperationAbortedError || executionContext.abortSignal?.aborted) {
        return withSpill(new ExecutionError("aborted", "Operation aborted"));
      }
      const cause = toError(error);
      return err(new ExecutionError("spawn_error", cause.message, cause));
    } finally {
      if (timer) clearTimeout(timer);
      if (spillPath && !shouldKeepSpill()) {
        await this.remove(spillPath, { force: true }, withoutAbortSignal(context));
      }
    }

    function shouldKeepSpill(): boolean {
      const spill = options?.spill;
      if (!spill || !spillPath) return false;
      const lines = newlines + (bytes > 0 && lastByte !== 10 ? 1 : 0);
      return bytes > spill.afterBytes || lines > spill.afterLines;
    }

    function withSpill(error: ExecutionError): Result<ShellExecResult, ExecutionError> {
      if (shouldKeepSpill()) error.spillPath = spillPath;
      return err(error);
    }
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || exit ${STATUS.notFound}
         test ! -d "$TARGET" || exit ${STATUS.isDirectory}
         test -f "$TARGET" || exit ${STATUS.invalid}
         test -r "$TARGET" || exit ${STATUS.permissionDenied}
         cat -- "$TARGET"`,
        { TARGET: target },
        operationContext,
      );
      assertFileCommand(output, target);
      return output.stdout;
    });
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const result = await this.readBinaryFile(path, context);
    if (!result.ok) return result;
    return ok(new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.value));
  }

  async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    const absolutePath = await this.absolutePath(path, context);
    if (!absolutePath.ok) return absolutePath;
    const content = await this.readBinaryFile(absolutePath.value, context);
    if (!content.ok) return content;
    return ok(new MemoryTextLineReader(absolutePath.value, new TextDecoder().decode(content.value)));
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
    const opened = await this.openTextLineReader(path, context);
    if (!opened.ok) return opened;

    const lines: string[] = [];
    try {
      while (options?.maxLines === undefined || lines.length < options.maxLines) {
        const line = await opened.value.readLine(context);
        if (!line.ok) return line;
        if (!line.value) break;
        lines.push(line.value.text);
      }
      return ok(lines);
    } finally {
      await opened.value.close(context);
    }
  }

  async writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.#write(path, content, false, context);
  }

  async appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.#write(path, content, true, context);
  }

  async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    const absolutePath = await this.absolutePath(path, context);
    if (!absolutePath.ok) return absolutePath;
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(new FileError("invalid", "File size must be a non-negative safe integer", absolutePath.value));
    }

    return this.#fileOperation(absolutePath.value, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || exit ${STATUS.notFound}
         test ! -d "$TARGET" || exit ${STATUS.isDirectory}
         test -w "$TARGET" || exit ${STATUS.permissionDenied}
         truncate -s "$SIZE" -- "$TARGET"`,
        { TARGET: target, SIZE: String(size) },
        operationContext,
      );
      assertFileCommand(output, target);
    });
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || exit ${STATUS.notFound}
         test ! -d "$TARGET" || exit ${STATUS.isDirectory}
         sync -d -- "$TARGET"`,
        { TARGET: target },
        operationContext,
      );
      assertFileCommand(output, target);
    });
  }

  async renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>> {
    const destination = await this.absolutePath(destinationPath, context);
    if (!destination.ok) return destination;
    return this.#fileOperation(sourcePath, context, async (source, operationContext) => {
      const output = await this.#capture(
        `test -e "$SOURCE" || test -L "$SOURCE" || exit ${STATUS.notFound}
         test -d "$(dirname -- "$DESTINATION")" || exit ${STATUS.notDirectory}
         mv -- "$SOURCE" "$DESTINATION"`,
        { SOURCE: source, DESTINATION: destination.value },
        operationContext,
      );
      assertFileCommand(output, source);
    });
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || test -L "$TARGET" || exit ${STATUS.notFound}
         stat -c '%F|%s|%Y' -- "$TARGET"`,
        { TARGET: target, LC_ALL: "C" },
        operationContext,
      );
      assertFileCommand(output, target);

      const [description, sizeText, mtimeText] = decode(output.stdout).trim().split("|");
      const kind = fileKind(description);
      const size = Number(sizeText);
      const mtime = Number(mtimeText);
      if (!kind || !Number.isFinite(size) || !Number.isFinite(mtime)) {
        throw new FileError("invalid", "Invalid file metadata", target);
      }
      return { name: posix.basename(target), path: target, kind, size, mtimeMs: mtime * 1_000 };
    });
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || exit ${STATUS.notFound}
         test -d "$TARGET" || exit ${STATUS.notDirectory}
         find "$TARGET" -mindepth 1 -maxdepth 1 -printf '%f\\0'`,
        { TARGET: target },
        operationContext,
      );
      assertFileCommand(output, target);

      const entries: FileInfo[] = [];
      for (const name of decode(output.stdout).split("\0")) {
        if (!name) continue;
        const info = await this.fileInfo(posix.join(target, name), operationContext);
        if (!info.ok) throw info.error;
        entries.push(info.value);
      }
      return entries;
    });
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        `test -e "$TARGET" || test -L "$TARGET" || exit ${STATUS.notFound}
         realpath -z -- "$TARGET"`,
        { TARGET: target },
        operationContext,
      );
      assertFileCommand(output, target);
      return decode(output.stdout.subarray(0, -1));
    });
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const output = await this.#capture(
        'test -e "$TARGET" || test -L "$TARGET"',
        { TARGET: target },
        operationContext,
      );
      if (output.exitCode === 0) return true;
      if (output.exitCode === 1) return false;
      throw new FileError("unknown", commandMessage(output), target);
    });
  }

  async createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const command = (options?.recursive ?? true) ? 'mkdir -p -- "$TARGET"' : 'mkdir -- "$TARGET"';
      const output = await this.#capture(command, { TARGET: target }, operationContext);
      assertFileCommand(output, target);
    });
  }

  async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const flags = `${options?.recursive ? "r" : ""}${options?.force ? "f" : ""}`;
      const command = `rm ${flags ? `-${flags} ` : ""}-- "$TARGET"`;
      const check = options?.force ? "" : `test -e "$TARGET" || test -L "$TARGET" || exit ${STATUS.notFound}\n`;
      const output = await this.#capture(`${check}${command}`, { TARGET: target }, operationContext);
      assertFileCommand(output, target);
    });
  }

  async createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>> {
    if (!validTempPart(prefix)) return err(new FileError("invalid", "Invalid temporary directory prefix"));
    return this.#temporary('mktemp -d --tmpdir "$TEMPLATE"', `${prefix ?? "tmp-"}XXXXXXXX`, context);
  }

  async createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    if (!validTempPart(options?.prefix) || !validTempPart(options?.suffix)) {
      return err(new FileError("invalid", "Invalid temporary file name"));
    }
    return this.#temporary(
      'mktemp --tmpdir "$TEMPLATE"',
      `${options?.prefix ?? ""}XXXXXXXX${options?.suffix ?? ""}`,
      context,
    );
  }

  /** Cancels commands started through this handle without destroying the sandbox. */
  async cleanup(_context: Context): Promise<void> {
    const active = [...this.#active];
    for (const [controller] of active) controller.abort();
    await Promise.allSettled(active.map(([, operation]) => operation));
  }

  async #write(
    path: string,
    content: string | Uint8Array,
    append: boolean,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.#fileOperation(path, context, async (target, operationContext) => {
      const redirect = append ? ">>" : ">";
      const output = await this.#capture(
        `mkdir -p -- "$(dirname -- "$TARGET")"
         test ! -d "$TARGET" || exit ${STATUS.isDirectory}
         if test -e "$TARGET"; then test -w "$TARGET" || exit ${STATUS.permissionDenied}; fi
         cat ${redirect} "$TARGET"`,
        { TARGET: target },
        operationContext,
        typeof content === "string" ? new TextEncoder().encode(content) : content,
      );
      assertFileCommand(output, target);
    });
  }

  async #temporary(command: string, template: string, context: Context): Promise<Result<string, FileError>> {
    try {
      const output = await this.#capture(command, { TEMPLATE: template }, context);
      if (output.exitCode !== 0) return err(new FileError("unknown", commandMessage(output)));
      return ok(decode(output.stdout).trimEnd());
    } catch (error) {
      return fileError(error, undefined, context);
    }
  }

  async #fileOperation<T>(
    path: string,
    context: Context,
    operation: (target: string, context: Context) => Promise<T>,
  ): Promise<Result<T, FileError>> {
    const absolutePath = await this.absolutePath(path, context);
    if (!absolutePath.ok) return absolutePath;
    try {
      return ok(await operation(absolutePath.value, context));
    } catch (error) {
      return fileError(error, absolutePath.value, context);
    }
  }

  async #capture(
    command: string,
    env: Record<string, string>,
    context: Context,
    stdin?: Uint8Array,
  ): Promise<CapturedCommand> {
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await this.#invoke(
      {
        command,
        cwd: this.cwd,
        env,
        inheritEnv: true,
        stdin,
        onOutput: ({ stream, data }) => {
          (stream === "stdout" ? stdout : stderr).push(data.slice());
        },
      },
      context,
    );
    return { ...result, stdout: concat(stdout), stderr: concat(stderr) };
  }

  async #invoke(command: SandboxCommand, context: Context): Promise<SandboxCommandResult> {
    validateEnvironment(command.env);
    if (context.abortSignal?.aborted) throw new OperationAbortedError();

    const controller = new AbortController();
    const operationContext = withAbortSignal(controller.signal, context);
    const operation = Promise.resolve().then(() => this.#run(command, operationContext));
    this.#active.set(controller, operation);
    try {
      const result = await operation;
      if (operationContext.abortSignal?.aborted) throw new OperationAbortedError();
      return result;
    } catch (error) {
      if (operationContext.abortSignal?.aborted) throw new OperationAbortedError();
      throw error;
    } finally {
      this.#active.delete(controller);
    }
  }
}

class OperationAbortedError extends Error {}

interface CapturedCommand extends SandboxCommandResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
}

class MemoryTextLineReader implements TextLineReader {
  readonly #path: string;
  #text: string;
  #offset = 0;
  #closed = false;

  constructor(path: string, text: string) {
    this.#path = path;
    this.#text = text;
  }

  async readLine(context: Context): Promise<Result<TextLine | undefined, FileError>> {
    if (context.abortSignal?.aborted) return aborted(this.#path);
    if (this.#closed) return err(new FileError("invalid", "Text line reader is closed", this.#path));
    if (this.#offset === this.#text.length) return ok(undefined);

    const newline = this.#text.indexOf("\n", this.#offset);
    if (newline === -1) {
      const text = this.#text.slice(this.#offset);
      this.#offset = this.#text.length;
      return ok({ text, terminated: false });
    }

    const text = this.#text.slice(this.#offset, newline);
    this.#offset = newline + 1;
    return ok({ text, terminated: true });
  }

  async close(_context: Context): Promise<void> {
    this.#closed = true;
    this.#text = "";
  }
}

function timeoutMilliseconds(seconds: number | undefined): Result<number | undefined, ExecutionError> {
  if (seconds === undefined) return ok(undefined);
  const milliseconds = seconds * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > MAX_TIMEOUT_MS) {
    return err(new ExecutionError("timeout", "Invalid timeout in seconds"));
  }
  return ok(milliseconds);
}

function validSpill(spill: ShellExecOptions["spill"]): boolean {
  return (
    spill === undefined ||
    [spill.afterBytes, spill.afterLines].every((value) => Number.isSafeInteger(value) && value >= 0)
  );
}

function validTempPart(value: string | undefined): boolean {
  return value === undefined || /^[A-Za-z0-9._-]*$/u.test(value);
}

function validateEnvironment(environment: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(environment)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || value.includes("\0")) {
      throw new TypeError(`Invalid environment variable: ${name}`);
    }
  }
}

function assertFileCommand(output: CapturedCommand, path: string): void {
  if (output.exitCode === 0) return;
  const codes: Partial<Record<number, FileErrorCode>> = {
    [STATUS.notFound]: "not_found",
    [STATUS.permissionDenied]: "permission_denied",
    [STATUS.notDirectory]: "not_directory",
    [STATUS.isDirectory]: "is_directory",
    [STATUS.invalid]: "invalid",
  };
  throw new FileError(codes[output.exitCode] ?? "unknown", commandMessage(output), path);
}

function commandMessage(output: CapturedCommand): string {
  return decode(output.stderr).trim() || `Command failed with exit code ${output.exitCode}`;
}

function fileError<T>(error: unknown, path: string | undefined, context: Context): Result<T, FileError> {
  if (error instanceof FileError) return err(error);
  const cause = toError(error);
  const code = error instanceof OperationAbortedError || context.abortSignal?.aborted ? "aborted" : "unknown";
  return err(new FileError(code, cause.message, path, cause));
}

function aborted<T>(path?: string): Result<T, FileError> {
  return err(new FileError("aborted", "Operation aborted", path));
}

function fileKind(description: string | undefined): FileInfo["kind"] | undefined {
  if (description?.startsWith("regular")) return "file";
  if (description === "directory") return "directory";
  if (description === "symbolic link") return "symlink";
  return undefined;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function flushDecoder(
  decoder: TextDecoder,
  onOutput: ShellExecOptions["onOutput"],
  context: Context,
): Error | undefined {
  if (!onOutput) return;
  const text = decoder.decode();
  if (!text) return;
  try {
    onOutput(text, context);
  } catch (error) {
    return toError(error);
  }
}
