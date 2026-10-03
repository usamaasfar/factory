import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { join, posix } from "node:path";
import type { Context } from "@earendil-works/chord";
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
} from "@earendil-works/pi-durable/env";
import { type DockerSandbox, SandboxCommandInterrupted } from "./docker.ts";

const WORKSPACE = "/workspace";
const FILESYSTEM_HELPER = "/usr/local/lib/factory/filesystem.ts";
const MAX_TIMEOUT_MS = 2_147_483_647;

type HelperError = { code: string; message: string; path?: string };
type HelperResponse<T> = { ok: true; value?: T } | { ok: false; error: HelperError };
type HelperRequest = Record<string, unknown> & { operation: string };

/** Pi Durable execution environment backed by one workflow session's Docker sandbox. */
export class DockerExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly #sandbox: DockerSandbox;

  constructor(sandbox: DockerSandbox, cwd = WORKSPACE) {
    this.#sandbox = sandbox;
    this.id = sandbox.id;
    this.cwd = confinedPath(WORKSPACE, cwd);
  }

  async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.#pathResult(() => confinedPath(this.cwd, path), context, path);
  }

  async joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    return this.#pathResult(() => confinedPath(this.cwd, posix.join(...parts)), context, parts.join("/"));
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const result = await this.readBinaryFile(path, context);
    return result.ok ? ok(new TextDecoder().decode(result.value)) : result;
  }

  async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    const resolved = this.#resolve(path, context);
    if (!resolved.ok) return resolved;
    const content = await this.readTextFile(resolved.value, context);
    return content.ok ? ok(new StringLineReader(content.value, resolved.value)) : content;
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    if (options?.maxLines !== undefined && options.maxLines <= 0) return ok([]);
    const reader = await this.openTextLineReader(path, context);
    if (!reader.ok) return reader;

    const lines: string[] = [];
    try {
      while (options?.maxLines === undefined || lines.length < options.maxLines) {
        const line = await reader.value.readLine(context);
        if (!line.ok) return line;
        if (line.value === undefined) break;
        lines.push(line.value.text);
      }
      return ok(lines);
    } finally {
      await reader.value.close(context);
    }
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const result = await this.#fileRequest<string>({ operation: "read", path }, context);
    return result.ok ? ok(Uint8Array.from(Buffer.from(result.value, "base64"))) : result;
  }

  async writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.#contentRequest("write", path, content, context);
  }

  async appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.#contentRequest("append", path, content, context);
  }

  async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    const resolved = this.#resolve(path, context);
    if (!resolved.ok) return resolved;
    if (!Number.isSafeInteger(size) || size < 0) {
      return err(new FileError("invalid", "File size must be a non-negative safe integer", resolved.value));
    }
    return this.#request({ operation: "truncate", path: resolved.value, size }, context);
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    return this.#fileRequest({ operation: "flush", path }, context);
  }

  async renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>> {
    const source = this.#resolve(sourcePath, context);
    if (!source.ok) return source;
    const destination = this.#resolve(destinationPath, context);
    if (!destination.ok) return destination;
    return this.#request({ operation: "rename", source: source.value, destination: destination.value }, context);
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return this.#fileRequest({ operation: "info", path }, context);
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return this.#fileRequest({ operation: "list", path }, context);
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.#fileRequest({ operation: "canonical", path }, context);
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const result = await this.fileInfo(path, context);
    if (result.ok) return ok(true);
    return result.error.code === "not_found" ? ok(false) : result;
  }

  async createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const resolved = this.#resolve(path, context);
    if (!resolved.ok) return resolved;
    return this.#request({ operation: "mkdir", path: resolved.value, recursive: options?.recursive ?? true }, context);
  }

  async remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const resolved = this.#resolve(path, context);
    if (!resolved.ok) return resolved;
    return this.#request(
      {
        operation: "remove",
        path: resolved.value,
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      },
      context,
    );
  }

  async createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>> {
    return this.#request({ operation: "temp-dir", prefix: prefix ?? "tmp-" }, context);
  }

  async createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    return this.#request(
      { operation: "temp-file", prefix: options?.prefix ?? "", suffix: options?.suffix ?? "" },
      context,
    );
  }

  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "aborted"));

    const timeout = timeoutMilliseconds(options?.timeout);
    if (!timeout.ok) return timeout;

    const cwd = this.#resolve(options?.cwd ?? this.cwd, context);
    if (!cwd.ok) return err(new ExecutionError("spawn_error", cwd.error.message, cwd.error));
    const canonicalCwd = await this.canonicalPath(cwd.value, context);
    if (!canonicalCwd.ok) {
      return err(
        canonicalCwd.error.code === "aborted"
          ? new ExecutionError("aborted", "aborted", canonicalCwd.error)
          : new ExecutionError("spawn_error", `Working directory does not exist: ${cwd.value}`, canonicalCwd.error),
      );
    }
    const cwdInfo = await this.fileInfo(canonicalCwd.value, context);
    if (!cwdInfo.ok || cwdInfo.value.kind !== "directory") {
      const cause = cwdInfo.ok ? undefined : cwdInfo.error;
      return err(
        cause?.code === "aborted"
          ? new ExecutionError("aborted", "aborted", cause)
          : new ExecutionError("spawn_error", `Working directory does not exist: ${cwd.value}`, cause),
      );
    }

    const spillOptions = options?.spill;
    let spill: ReturnType<typeof createSpillFile> | undefined;
    try {
      spill = spillOptions ? createSpillFile(this.#sandbox.workspace) : undefined;
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      return err(new ExecutionError("unknown", `Failed to create shell output file: ${cause.message}`, cause));
    }
    let callbackError: Error | undefined;
    let spillError: Error | undefined;
    let seenBytes = 0;
    let seenNewlines = 0;
    let endsWithNewline = true;
    let spilled = false;

    const onOutput = (text: string) => {
      if (spill && spillOptions) {
        try {
          const bytes = new TextEncoder().encode(text);
          writeSync(spill.descriptor, bytes);
          seenBytes += bytes.byteLength;
          for (const byte of bytes) if (byte === 0x0a) seenNewlines++;
          if (bytes.byteLength > 0) endsWithNewline = bytes[bytes.byteLength - 1] === 0x0a;
          const lines = seenNewlines + (seenBytes > 0 && !endsWithNewline ? 1 : 0);
          spilled ||= seenBytes > spillOptions.afterBytes || lines > spillOptions.afterLines;
        } catch (error) {
          spillError = error instanceof Error ? error : new Error(String(error));
          throw spillError;
        }
      }
      try {
        options?.onOutput?.(text, context);
      } catch (error) {
        callbackError = error instanceof Error ? error : new Error(String(error));
        throw callbackError;
      }
    };

    try {
      const result = await this.#sandbox.exec(command, {
        cwd: canonicalCwd.value,
        env: options?.env,
        inheritEnv: options?.inheritEnv,
        signal: context.abortSignal,
        timeout: timeout.value,
        onOutput,
        captureOutput: false,
      });
      return ok({ exitCode: result.exitCode, ...(spilled && spill ? { spillPath: spill.containerPath } : {}) });
    } catch (error) {
      const executionError = spillError
        ? new ExecutionError("unknown", `Failed to preserve complete shell output: ${spillError.message}`, spillError)
        : callbackError
          ? new ExecutionError("callback_error", callbackError.message, callbackError)
          : error instanceof SandboxCommandInterrupted
            ? new ExecutionError(error.reason, error.message, error)
            : new ExecutionError("spawn_error", error instanceof Error ? error.message : String(error));
      if (spilled && spill) executionError.spillPath = spill.containerPath;
      return err(executionError);
    } finally {
      if (spill) {
        try {
          closeSync(spill.descriptor);
          if (!spilled) unlinkSync(spill.hostPath);
        } catch {
          // The command result is already known; temporary-output cleanup is best effort.
        }
      }
    }
  }

  async cleanup(_context: Context): Promise<void> {}

  async #contentRequest(
    operation: "write" | "append",
    path: string,
    content: string | Uint8Array,
    context: Context,
  ): Promise<Result<void, FileError>> {
    const resolved = this.#resolve(path, context);
    if (!resolved.ok) return resolved;
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    return this.#request({ operation, path: resolved.value, content: Buffer.from(bytes).toString("base64") }, context);
  }

  async #fileRequest<T>(request: HelperRequest & { path: string }, context: Context): Promise<Result<T, FileError>> {
    const resolved = this.#resolve(request.path, context);
    if (!resolved.ok) return resolved;
    return this.#request({ ...request, path: resolved.value }, context);
  }

  async #request<T>(request: HelperRequest, context: Context): Promise<Result<T, FileError>> {
    if (context.abortSignal?.aborted) return err(new FileError("aborted", "aborted"));
    try {
      const result = await this.#sandbox.run(["bun", FILESYSTEM_HELPER], {
        stdin: JSON.stringify(request),
        signal: context.abortSignal,
      });
      if (result.exitCode !== 0) {
        return err(new FileError("unknown", result.stderr.trim() || `Filesystem helper exited ${result.exitCode}`));
      }
      const response = JSON.parse(result.stdout) as HelperResponse<T>;
      if (!response.ok) return err(toFileError(response.error));
      if (context.abortSignal?.aborted) return err(new FileError("aborted", "aborted"));
      return ok(response.value as T);
    } catch (error) {
      if (error instanceof SandboxCommandInterrupted && error.reason === "aborted") {
        return err(new FileError("aborted", error.message));
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      return err(new FileError("unknown", cause.message, undefined, cause));
    }
  }

  #resolve(path: string, context: Context): Result<string, FileError> {
    if (context.abortSignal?.aborted) return err(new FileError("aborted", "aborted", path));
    try {
      return ok(confinedPath(this.cwd, path));
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      return err(new FileError("permission_denied", cause.message, path, cause));
    }
  }

  #pathResult(resolve: () => string, context: Context, path: string): Promise<Result<string, FileError>> {
    return Promise.resolve(
      context.abortSignal?.aborted ? err(new FileError("aborted", "aborted", path)) : safePath(resolve, path),
    );
  }
}

class StringLineReader implements TextLineReader {
  readonly #path: string;
  readonly #lines: TextLine[];
  #index = 0;
  #closed = false;

  constructor(content: string, path: string) {
    this.#path = path;
    this.#lines = textLines(content);
  }

  async readLine(context: Context): Promise<Result<TextLine | undefined, FileError>> {
    if (context.abortSignal?.aborted) return err(new FileError("aborted", "aborted", this.#path));
    if (this.#closed) return err(new FileError("invalid", "Text line reader is closed", this.#path));
    return ok(this.#lines[this.#index++]);
  }

  async close(_context: Context): Promise<void> {
    this.#closed = true;
  }
}

function textLines(content: string): TextLine[] {
  if (content === "") return [];
  const parts = content.split("\n");
  return parts
    .slice(0, -1)
    .map((text) => ({ text, terminated: true }))
    .concat(content.endsWith("\n") ? [] : [{ text: parts[parts.length - 1] ?? "", terminated: false }]);
}

function confinedPath(cwd: string, path: string): string {
  const absolute = posix.isAbsolute(path) ? posix.resolve(path) : posix.resolve(cwd, path);
  if (absolute !== WORKSPACE && !absolute.startsWith(`${WORKSPACE}/`)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }
  return absolute;
}

function safePath(resolve: () => string, path: string): Result<string, FileError> {
  try {
    return ok(resolve());
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return err(new FileError("permission_denied", cause.message, path, cause));
  }
}

function timeoutMilliseconds(timeout: number | undefined): Result<number | undefined, ExecutionError> {
  if (timeout === undefined) return ok(undefined);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > MAX_TIMEOUT_MS) {
    return err(new ExecutionError("timeout", "Invalid timeout: must be a positive finite number of seconds"));
  }
  return ok(timeout * 1000);
}

function toFileError(error: HelperError): FileError {
  const codes: Partial<Record<string, FileErrorCode>> = {
    ABORT_ERR: "aborted",
    ENOENT: "not_found",
    EACCES: "permission_denied",
    EPERM: "permission_denied",
    ENOTDIR: "not_directory",
    EISDIR: "is_directory",
    EINVAL: "invalid",
    ENOTSUP: "not_supported",
  };
  return new FileError(codes[error.code] ?? "unknown", error.message, error.path);
}

function createSpillFile(workspace: string): {
  descriptor: number;
  hostPath: string;
  containerPath: string;
} {
  const directory = join(workspace, ".git", "factory", "tmp");
  mkdirSync(directory, { recursive: true });
  const name = `pi-output-${randomUUID()}.log`;
  const hostPath = join(directory, name);
  return {
    descriptor: openSync(hostPath, "wx"),
    hostPath,
    containerPath: posix.join(WORKSPACE, ".git", "factory", "tmp", name),
  };
}
