import { randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

const WORKSPACE = "/workspace";
const TEMPORARY_FILES = "/workspace/.git/factory/tmp";

type Request =
  | { operation: "read"; path: string }
  | { operation: "write" | "append"; path: string; content: string }
  | { operation: "truncate"; path: string; size: number }
  | { operation: "flush" | "info" | "list" | "canonical"; path: string }
  | { operation: "rename"; source: string; destination: string }
  | { operation: "mkdir" | "remove"; path: string; recursive: boolean; force?: boolean }
  | { operation: "temp-dir"; prefix: string }
  | { operation: "temp-file"; prefix: string; suffix: string };

type FileKind = "file" | "directory" | "symlink";

type FileInfo = {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
};

type Response = { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string; path?: string } };

const request = (await Bun.stdin.json()) as Request;

try {
  const value = await execute(request);
  respond({ ok: true, ...(value === undefined ? {} : { value }) });
} catch (error) {
  respond({ ok: false, error: fileError(error, requestPath(request)) });
}

async function execute(request: Request): Promise<unknown> {
  switch (request.operation) {
    case "read":
      return Buffer.from(await readFile(await existingPath(request.path))).toString("base64");
    case "write": {
      const path = await writablePath(request.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(request.content, "base64"));
      return;
    }
    case "append": {
      const path = await writablePath(request.path);
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, Buffer.from(request.content, "base64"));
      return;
    }
    case "truncate":
      await truncate(await existingPath(request.path), request.size);
      return;
    case "flush": {
      const file = await open(await existingPath(request.path), "r+");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      return;
    }
    case "rename":
      await rename(await entryPath(request.source), await writablePath(request.destination));
      return;
    case "info":
      return fileInfo(await entryPath(request.path));
    case "list": {
      const path = await existingPath(request.path);
      const entries = await readdir(path);
      return Promise.all(entries.map((entry) => fileInfo(join(path, entry))));
    }
    case "canonical":
      return existingPath(request.path);
    case "mkdir":
      await mkdir(await writablePath(request.path), { recursive: request.recursive });
      return;
    case "remove":
      await rm(await entryPath(request.path), { recursive: request.recursive, force: request.force ?? false });
      return;
    case "temp-dir": {
      assertTemporaryName(request.prefix);
      await mkdir(TEMPORARY_FILES, { recursive: true });
      return mkdtemp(join(TEMPORARY_FILES, request.prefix));
    }
    case "temp-file": {
      assertTemporaryName(request.prefix);
      assertTemporaryName(request.suffix);
      await mkdir(TEMPORARY_FILES, { recursive: true });
      const path = join(TEMPORARY_FILES, `${request.prefix}${randomUUID()}${request.suffix}`);
      await writeFile(path, "");
      return path;
    }
  }
}

async function fileInfo(path: string): Promise<FileInfo> {
  const stats = await lstat(path);
  const kind = stats.isFile()
    ? "file"
    : stats.isDirectory()
      ? "directory"
      : stats.isSymbolicLink()
        ? "symlink"
        : undefined;
  if (!kind) throw Object.assign(new Error("Unsupported file type"), { code: "ENOTSUP", path });
  return { name: basename(path), path, kind, size: stats.size, mtimeMs: stats.mtimeMs };
}

function workspacePath(path: string): string {
  const absolute = posix.resolve(WORKSPACE, path);
  if (absolute !== WORKSPACE && !absolute.startsWith(`${WORKSPACE}/`)) {
    throw Object.assign(new Error(`Path is outside the workspace: ${path}`), { code: "EINVAL", path });
  }
  return absolute;
}

async function existingPath(path: string): Promise<string> {
  return workspacePath(await realpath(workspacePath(path)));
}

async function entryPath(path: string): Promise<string> {
  const lexical = workspacePath(path);
  if (lexical === WORKSPACE) return existingPath(lexical);
  const parent = await existingPath(dirname(lexical));
  return join(parent, basename(lexical));
}

async function writablePath(path: string): Promise<string> {
  const lexical = workspacePath(path);
  try {
    await lstat(lexical);
    return existingPath(lexical);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }

  let ancestor = dirname(lexical);
  while (true) {
    try {
      workspacePath(await realpath(ancestor));
      return lexical;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function assertTemporaryName(value: string): void {
  if (!/^[A-Za-z0-9._-]*$/.test(value)) {
    throw Object.assign(new Error(`Invalid temporary file name: ${value}`), { code: "EINVAL" });
  }
}

function requestPath(request: Request): string | undefined {
  if ("path" in request) return request.path;
  if (request.operation === "rename") return request.source;
  return undefined;
}

function fileError(error: unknown, fallbackPath?: string): { code: string; message: string; path?: string } {
  const cause = error instanceof Error ? error : new Error(String(error));
  const nodeError = cause as Error & { code?: string; path?: string };
  return {
    code: nodeError.code ?? "UNKNOWN",
    message: cause.message,
    ...((nodeError.path ?? fallbackPath) ? { path: nodeError.path ?? fallbackPath } : {}),
  };
}

function respond(response: Response): void {
  process.stdout.write(JSON.stringify(response));
}
