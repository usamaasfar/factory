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
import type { DockerSandbox } from "./sandbox.ts";

export class SandboxExecutionEnv implements ExecutionEnv {
  readonly id: string;
  cwd: string;
  readonly #sandbox: DockerSandbox;

  constructor(sandbox: DockerSandbox, options: { id: string; cwd?: string }) {
    this.#sandbox = sandbox;
    this.id = options.id;
    this.cwd = options.cwd ?? "/workspace";
  }

  async absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    const absolute = posix.resolve(this.cwd, path);
    if (absolute !== "/workspace" && !absolute.startsWith("/workspace/")) {
      return err(new FileError("permission_denied", `Path is outside the workspace: ${path}`, path));
    }
    return ok(absolute);
  }

  async joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    return this.absolutePath(posix.join(...parts), context);
  }

  async readTextFile(path: string, _context: Context): Promise<Result<string, FileError>> {
    return this.#fileOperation(path, () => this.#sandbox.read(path));
  }

  async readBinaryFile(path: string, _context: Context): Promise<Result<Uint8Array, FileError>> {
    return this.#fileOperation(path, () => this.#sandbox.readBinary(path));
  }

  async writeFile(path: string, content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    return this.#fileOperation(path, () =>
      typeof content === "string" ? this.#sandbox.write(path, content) : this.#sandbox.writeBinary(path, content),
    );
  }

  async fileInfo(path: string, _context: Context): Promise<Result<FileInfo, FileError>> {
    return this.#fileOperation(path, () => this.#sandbox.fileInfo(path));
  }

  async exists(path: string, _context: Context): Promise<Result<boolean, FileError>> {
    return this.#fileOperation(path, () => this.#sandbox.exists(path));
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.absolutePath(path, context);
  }

  async exec(
    command: string,
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    if (context.abortSignal?.aborted) return err(new ExecutionError("aborted", "Command was aborted"));
    try {
      const result = await this.#sandbox.exec(command, options?.cwd);
      if (result.stdout) options?.onOutput?.(result.stdout, context);
      if (result.stderr) options?.onOutput?.(result.stderr, context);
      return ok({ exitCode: result.exitCode });
    } catch (error) {
      return err(new ExecutionError("unknown", this.#message(error)));
    }
  }

  async openTextLineReader(path: string, _context: Context): Promise<Result<TextLineReader, FileError>> {
    return err(this.#unsupported("openTextLineReader", path));
  }

  async readTextLines(
    path: string,
    _options: { maxLines?: number } | undefined,
    _context: Context,
  ): Promise<Result<string[], FileError>> {
    return err(this.#unsupported("readTextLines", path));
  }

  async appendFile(path: string, _content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
    return err(this.#unsupported("appendFile", path));
  }

  async truncateFile(path: string, _size: number, _context: Context): Promise<Result<void, FileError>> {
    return err(this.#unsupported("truncateFile", path));
  }

  async flushFile(path: string, _context: Context): Promise<Result<void, FileError>> {
    return err(this.#unsupported("flushFile", path));
  }

  async renameFile(sourcePath: string, _destinationPath: string, _context: Context): Promise<Result<void, FileError>> {
    return err(this.#unsupported("renameFile", sourcePath));
  }

  async listDir(path: string, _context: Context): Promise<Result<FileInfo[], FileError>> {
    return err(this.#unsupported("listDir", path));
  }

  async createDir(
    path: string,
    _options: { recursive?: boolean } | undefined,
    _context: Context,
  ): Promise<Result<void, FileError>> {
    return err(this.#unsupported("createDir", path));
  }

  async remove(
    path: string,
    _options: { recursive?: boolean; force?: boolean } | undefined,
    _context: Context,
  ): Promise<Result<void, FileError>> {
    return err(this.#unsupported("remove", path));
  }

  async createTempDir(_prefix: string | undefined, _context: Context): Promise<Result<string, FileError>> {
    return err(this.#unsupported("createTempDir"));
  }

  async createTempFile(
    _options: { prefix?: string; suffix?: string } | undefined,
    _context: Context,
  ): Promise<Result<string, FileError>> {
    return err(this.#unsupported("createTempFile"));
  }

  async cleanup(_context: Context): Promise<void> {}

  async #fileOperation<T>(path: string, operation: () => Promise<T>): Promise<Result<T, FileError>> {
    try {
      return ok(await operation());
    } catch (error) {
      const message = this.#message(error);
      const code = message.includes("ENOENT") ? "not_found" : "unknown";
      return err(new FileError(code, message, path));
    }
  }

  #unsupported(operation: string, path?: string): FileError {
    return new FileError("not_supported", `${operation} is not supported by the sandbox`, path);
  }

  #message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
