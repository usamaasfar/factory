import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import {
  type ExecutionEnv,
  ExecutionError,
  err,
  FileError,
  type FileInfo,
  ok,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type TextLineReader,
} from "@earendil-works/pi-durable/env";
import type { DockerSandbox } from "./sandboxes.ts";

const WORKSPACE = "/workspace";
const MAX_TIMEOUT_MS = 2_147_483_647;

/** The smallest Pi environment needed by its native read, write, edit, and bash tools. */
export class DockerExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd = WORKSPACE;
  readonly #sandbox: DockerSandbox;

  constructor(sandbox: DockerSandbox) {
    this.#sandbox = sandbox;
    this.id = sandbox.id;
  }

  async absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    if (context.abortSignal?.aborted) return aborted(path);
    try {
      return ok(resolveWorkspacePath(this.cwd, path));
    } catch (error) {
      return fileFailure("permission_denied", path, error);
    }
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const target = await this.absolutePath(path, context);
    if (!target.ok) return target;
    try {
      const result = await this.#sandbox.exec(
        'test -e "$TARGET" || test -L "$TARGET"',
        { env: { TARGET: target.value } },
        context,
      );
      return ok(result.exitCode === 0);
    } catch (error) {
      return this.#fileError(target.value, error);
    }
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const target = await this.absolutePath(path, context);
    if (!target.ok) return target;
    try {
      const result = await this.#sandbox.exec('base64 < "$TARGET"', { env: { TARGET: target.value } }, context);
      if (result.exitCode !== 0) return commandFileError(target.value, result.stderr);
      return ok(Uint8Array.from(Buffer.from(result.stdout, "base64")));
    } catch (error) {
      return this.#fileError(target.value, error);
    }
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const result = await this.readBinaryFile(path, context);
    return result.ok ? ok(new TextDecoder().decode(result.value)) : result;
  }

  async writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    const target = await this.absolutePath(path, context);
    if (!target.ok) return target;
    try {
      const result = await this.#sandbox.exec(
        'mkdir -p -- "$(dirname -- "$TARGET")" && cat > "$TARGET"',
        { env: { TARGET: target.value }, input: content },
        context,
      );
      return result.exitCode === 0 ? ok(undefined) : commandFileError(target.value, result.stderr);
    } catch (error) {
      return this.#fileError(target.value, error);
    }
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    const target = await this.absolutePath(path, context);
    if (!target.ok) return target;
    try {
      const result = await this.#sandbox.exec(
        'if test -L "$TARGET"; then kind=symlink; elif test -f "$TARGET"; then kind=file; elif test -d "$TARGET"; then kind=directory; else exit 44; fi; printf "%s\\n%s\\n%s\\n" "$kind" "$(stat -c %s -- "$TARGET")" "$(stat -c %Y -- "$TARGET")"',
        { env: { TARGET: target.value } },
        context,
      );
      if (result.exitCode === 44)
        return err(new FileError("not_found", `File not found: ${target.value}`, target.value));
      if (result.exitCode !== 0) return commandFileError(target.value, result.stderr);
      const [kind, size, modified] = result.stdout.trim().split("\n");
      if (kind !== "file" && kind !== "directory" && kind !== "symlink") {
        return err(new FileError("unknown", `Invalid file metadata for ${target.value}`, target.value));
      }
      return ok({
        name: posix.basename(target.value),
        path: target.value,
        kind,
        size: Number(size),
        mtimeMs: Number(modified) * 1000,
      });
    } catch (error) {
      return this.#fileError(target.value, error);
    }
  }

  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    const cwd = await this.absolutePath(options?.cwd ?? this.cwd, context);
    if (!cwd.ok)
      return err(new ExecutionError(cwd.error.code === "aborted" ? "aborted" : "spawn_error", cwd.error.message));
    const timeoutMs = timeoutMilliseconds(options?.timeout);
    if (!timeoutMs.ok) return timeoutMs;

    try {
      const result = await this.#sandbox.exec(
        command,
        {
          cwd: cwd.value,
          env: options?.env,
          inheritEnv: options?.inheritEnv,
          timeoutMs: timeoutMs.value,
          onOutput: options?.onOutput ? (text) => options.onOutput?.(text, context) : undefined,
        },
        context,
      );
      return ok({ exitCode: result.exitCode });
    } catch (error) {
      if (isSandboxInterrupted(error)) return err(new ExecutionError(error.reason, error.message, error));
      const cause = error instanceof Error ? error : new Error(String(error));
      return err(new ExecutionError("spawn_error", cause.message, cause));
    }
  }

  async canonicalPath(path: string, _context: Context): Promise<Result<string, FileError>> {
    return unsupported(path);
  }

  async joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    return this.absolutePath(posix.join(...parts), context);
  }

  async openTextLineReader(path: string, _context: Context): Promise<Result<TextLineReader, FileError>> {
    return unsupported(path);
  }

  async readTextLines(
    path: string,
    _options: { maxLines?: number } | undefined,
    _context: Context,
  ): Promise<Result<string[], FileError>> {
    return unsupported(path);
  }

  async appendFile(path: string, _content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    return unsupported(path);
  }

  async truncateFile(path: string, _size: number, _context: Context): Promise<Result<void, FileError>> {
    return unsupported(path);
  }

  async flushFile(path: string, _context: Context): Promise<Result<void, FileError>> {
    return unsupported(path);
  }

  async renameFile(sourcePath: string, _destinationPath: string, _context: Context): Promise<Result<void, FileError>> {
    return unsupported(sourcePath);
  }

  async listDir(path: string, _context: Context): Promise<Result<FileInfo[], FileError>> {
    return unsupported(path);
  }

  async createDir(
    path: string,
    _options: { recursive?: boolean } | undefined,
    _context: Context,
  ): Promise<Result<void, FileError>> {
    return unsupported(path);
  }

  async remove(
    path: string,
    _options: { recursive?: boolean; force?: boolean } | undefined,
    _context: Context,
  ): Promise<Result<void, FileError>> {
    return unsupported(path);
  }

  async createTempDir(_prefix: string | undefined, _context: Context): Promise<Result<string, FileError>> {
    return unsupported(WORKSPACE);
  }

  async createTempFile(
    _options: { prefix?: string; suffix?: string } | undefined,
    _context: Context,
  ): Promise<Result<string, FileError>> {
    return unsupported(WORKSPACE);
  }

  async cleanup(_context: Context): Promise<void> {}

  #fileError(path: string, error: unknown): Result<never, FileError> {
    if (isSandboxInterrupted(error) && error.reason === "aborted") return aborted(path);
    return fileFailure("unknown", path, error);
  }
}

function isSandboxInterrupted(error: unknown): error is Error & { reason: "aborted" | "timeout" } {
  if (!(error instanceof Error) || error.name !== "SandboxInterrupted") return false;
  const reason = (error as Error & { reason?: unknown }).reason;
  return reason === "aborted" || reason === "timeout";
}

function resolveWorkspacePath(cwd: string, path: string): string {
  const absolute = posix.resolve(cwd, path);
  if (absolute !== WORKSPACE && !absolute.startsWith(`${WORKSPACE}/`)) {
    throw new Error(`Path is outside ${WORKSPACE}: ${path}`);
  }
  return absolute;
}

function unsupported<T>(path: string): Result<T, FileError> {
  return err(new FileError("not_supported", "Operation is not supported by the Docker environment", path));
}

function aborted<T>(path: string): Result<T, FileError> {
  return err(new FileError("aborted", "Operation aborted", path));
}

function fileFailure<T>(code: "permission_denied" | "unknown", path: string, error: unknown): Result<T, FileError> {
  const cause = error instanceof Error ? error : new Error(String(error));
  return err(new FileError(code, cause.message, path, cause));
}

function commandFileError<T>(path: string, stderr: string): Result<T, FileError> {
  const code = /No such file|not found/iu.test(stderr)
    ? "not_found"
    : /Permission denied/iu.test(stderr)
      ? "permission_denied"
      : "unknown";
  return err(new FileError(code, stderr.trim() || `Filesystem operation failed: ${path}`, path));
}

function timeoutMilliseconds(seconds: number | undefined): Result<number | undefined, ExecutionError> {
  if (seconds === undefined) return ok(undefined);
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > MAX_TIMEOUT_MS) {
    return err(new ExecutionError("timeout", "Invalid timeout"));
  }
  return ok(milliseconds);
}
