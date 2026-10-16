import { Buffer } from "node:buffer";
import { posix } from "node:path";
import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import {
  err,
  FileError,
  type FileErrorCode,
  type FileInfo,
  type FileSystem,
  ok,
  type Result,
  type TextLine,
  type TextLineReader,
  toError,
} from "@earendil-works/pi-durable/env";
import type { Sandbox } from "./sandbox.ts";

// Structured exit codes belong only to these internal scripts, never user commands.
const CODES: Readonly<Record<number, FileErrorCode>> = {
  80: "not_found",
  81: "permission_denied",
  82: "not_directory",
  83: "is_directory",
  85: "not_supported",
};
const PRELUDE = String.raw`
export LC_ALL=C
parents() {
  local p=$1
  while [[ "$p" != / ]]; do
    p=${"$"}{p%/*}
    [[ -n "$p" ]] || p=/
    if [[ -e "$p" ]]; then
      [[ -d "$p" ]] || exit 82
      [[ -x "$p" ]] || exit 81
    fi
  done
}
exists() { parents "$1"; [[ -e "$1" || -L "$1" ]] || exit 80; }
regular() {
  exists "$1"
  [[ -e "$1" ]] || exit 80
  [[ ! -d "$1" ]] || exit 83
  [[ -f "$1" ]] || exit 85
}
writable() { [[ -w "$1" ]] || exit 81; }
info() {
  exists "$1"
  local kind
  if [[ -L "$1" ]]; then kind=symlink
  elif [[ -d "$1" ]]; then kind=directory
  elif [[ -f "$1" ]]; then kind=file
  else exit 85; fi
  printf '%s\0%s\0' "$1" "$kind"
  stat --printf='%s\0%y\0' -- "$1"
}
`;

function quote(value: string): string {
  if (value.includes("\0")) throw new FileError("invalid", "Path contains NUL", value);
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** All I/O runs in the sandbox; no host filesystem capability is used. */
export class SandboxFiles implements FileSystem {
  readonly id: string;
  #cwd: string;
  readonly #temporary = new Set<string>();

  constructor(
    protected readonly sandbox: Sandbox,
    cwd = sandbox.cwd,
  ) {
    this.id = sandbox.id;
    this.#cwd = sandbox.cwd;
    this.cwd = cwd;
  }

  get cwd(): string {
    return this.#cwd;
  }
  set cwd(value: string) {
    quote(value);
    if (!posix.isAbsolute(value)) throw new TypeError("Environment cwd must be an absolute Linux path");
    this.#cwd = posix.normalize(value);
  }

  absolutePath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.operation(path, context, async (resolved) => resolved);
  }
  joinPath(parts: string[], context: Context): Promise<Result<string, FileError>> {
    return this.operation("", context, async () => {
      for (const part of parts) quote(part);
      return posix.join(...parts);
    });
  }
  // Base64 carries arbitrary bytes through exec's UTF-8 channel without data loss.
  readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    return this.operation(path, context, async (p) =>
      Buffer.from(
        await this.run(`regular ${quote(p)}; [[ -r ${quote(p)} ]] || exit 81; base64 -w 0 -- ${quote(p)}`, p, context),
        "base64",
      ),
    );
  }
  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const result = await this.readBinaryFile(path, context);
    return result.ok ? ok(new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.value)) : result;
  }
  writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.write(path, content, false, context);
  }
  appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    return this.write(path, content, true, context);
  }
  private write(
    path: string,
    content: string | Uint8Array,
    append: boolean,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.operation(path, context, async (p) => {
      const parent = quote(posix.dirname(p));
      await this.run(
        `parents ${quote(p)}; mkdir -p -- ${parent} || exit 81
if [[ -e ${quote(p)} ]]; then regular ${quote(p)}; writable ${quote(p)}; else writable ${parent}; fi
cat ${append ? ">>" : ">"} ${quote(p)}`,
        p,
        context,
        typeof content === "string" ? new TextEncoder().encode(content) : content,
      );
    });
  }
  truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    return this.operation(path, context, async (p) => {
      if (!Number.isSafeInteger(size) || size < 0) throw new FileError("invalid", "Invalid file size", p);
      await this.run(`regular ${quote(p)}; writable ${quote(p)}; truncate -s ${size} -- ${quote(p)}`, p, context);
    });
  }
  flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    return this.operation(path, context, async (p) => {
      await this.run(`regular ${quote(p)}; sync -- ${quote(p)}`, p, context);
    });
  }
  renameFile(source: string, destination: string, context: Context): Promise<Result<void, FileError>> {
    return this.operation(source, context, async (p) => {
      const target = this.resolve(destination);
      await this.run(
        `exists ${quote(p)}; exists ${quote(posix.dirname(target))}; writable ${quote(posix.dirname(p))}; writable ${quote(posix.dirname(target))}; mv -T -- ${quote(p)} ${quote(target)}`,
        p,
        context,
      );
    });
  }
  fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    return this.operation(path, context, async (p) => {
      const [info] = this.parseInfo(await this.run(`info ${quote(p)}`, p, context));
      if (!info) throw new FileError("unknown", "Missing sandbox file metadata", p);
      return info;
    });
  }
  listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    return this.operation(path, context, async (p) =>
      this.parseInfo(
        await this.run(
          `exists ${quote(p)}; [[ -d ${quote(p)} ]] || exit 82; [[ -r ${quote(p)} && -x ${quote(p)} ]] || exit 81
shopt -s nullglob dotglob
for entry in ${quote(p)}/*; do info "$entry" || exit; done`,
          p,
          context,
        ),
      ),
    );
  }
  canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    return this.operation(path, context, async (p) =>
      (
        await this.run(`exists ${quote(p)}; [[ -e ${quote(p)} ]] || exit 80; realpath -e -z -- ${quote(p)}`, p, context)
      ).slice(0, -1),
    );
  }
  exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    return this.operation(
      path,
      context,
      async (p) =>
        (await this.run(
          `parents ${quote(p)}; if [[ -e ${quote(p)} || -L ${quote(p)} ]]; then printf yes; fi`,
          p,
          context,
        )) === "yes",
    );
  }
  createDir(
    path: string,
    options: { recursive?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.operation(path, context, async (p) => {
      await this.run(
        `parents ${quote(p)}; mkdir ${options?.recursive === false ? "" : "-p"} -- ${quote(p)}`,
        p,
        context,
      );
    });
  }
  remove(
    path: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    context: Context,
  ): Promise<Result<void, FileError>> {
    return this.operation(path, context, async (p) => {
      await this.run(
        `${options?.force ? "parents" : "exists"} ${quote(p)}
${options?.recursive ? "" : `[[ ! -d ${quote(p)} || -L ${quote(p)} ]] || exit 83`}
rm ${options?.recursive ? "-r" : ""} ${options?.force ? "-f" : ""} -- ${quote(p)}`,
        p,
        context,
      );
    });
  }
  createTempDir(prefix = "pi-", context: Context): Promise<Result<string, FileError>> {
    return this.operation("/tmp", context, async (p) => {
      if (prefix.includes("/") || prefix.includes("\0"))
        throw new FileError("invalid", "Invalid temporary directory prefix");
      const path = (await this.run(`mktemp -d -- ${quote(`/tmp/${prefix}XXXXXXXXXXXX`)}`, p, context)).slice(0, -1);
      this.#temporary.add(path);
      return path;
    });
  }
  createTempFile(
    options: { prefix?: string; suffix?: string } | undefined,
    context: Context,
  ): Promise<Result<string, FileError>> {
    return this.operation("/tmp", context, async (p) => {
      const { prefix = "pi-", suffix = "" } = options ?? {};
      if (prefix.includes("/") || suffix.includes("/")) throw new FileError("invalid", "Invalid temporary file name");
      const path = (
        await this.run(`mktemp --suffix=${quote(suffix)} -- ${quote(`/tmp/${prefix}XXXXXXXXXXXX`)}`, p, context)
      ).slice(0, -1);
      this.#temporary.add(path);
      return path;
    });
  }
  /** Cancel this sandbox handle's operations, then remove only this environment's temporary paths. */
  async cleanup(context: Context): Promise<void> {
    await this.sandbox.cleanup();
    for (const path of this.#temporary) {
      const result = await this.remove(path, { recursive: true, force: true }, withoutAbortSignal(context));
      if (!result.ok) throw result.error;
      this.#temporary.delete(path);
    }
  }

  /** Snapshot the file in memory. Like Pi's Node reader, strip the BOM and split strictly on LF. */
  async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
    const result = await this.readBinaryFile(path, context);
    if (!result.ok) return result;
    let text = new TextDecoder().decode(result.value);
    let closed = false;
    return ok({
      async readLine(context): Promise<Result<TextLine | undefined, FileError>> {
        if (context.abortSignal?.aborted) return err(new FileError("aborted", "Read aborted", path));
        if (closed) return err(new FileError("invalid", "Text line reader is closed", path));
        if (!text) return ok(undefined);
        const end = text.indexOf("\n");
        const line = { text: end < 0 ? text : text.slice(0, end), terminated: end >= 0 };
        text = end < 0 ? "" : text.slice(end + 1);
        return ok(line);
      },
      async close() {
        closed = true;
        text = "";
      },
    });
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

  private resolve(path: string): string {
    quote(path);
    return posix.resolve(this.cwd, path);
  }
  private async operation<T>(
    path: string,
    context: Context,
    action: (resolved: string) => Promise<T>,
  ): Promise<Result<T, FileError>> {
    try {
      context.abortSignal?.throwIfAborted();
      const result = await action(this.resolve(path));
      context.abortSignal?.throwIfAborted();
      return ok(result);
    } catch (error) {
      if (error instanceof FileError) return err(error);
      const aborted =
        !(error instanceof AggregateError) &&
        (context.abortSignal?.aborted || (error instanceof Error && error.name === "AbortError"));
      return err(new FileError(aborted ? "aborted" : "unknown", toError(error).message, path, toError(error)));
    }
  }
  private async run(command: string, path: string, context: Context, stdin?: Uint8Array): Promise<string> {
    let stdout = "";
    let stderr = "";
    const result = await this.sandbox.exec(`${PRELUDE}\n${command}`, {
      cwd: "/",
      inheritEnv: false,
      signal: context.abortSignal,
      stdin,
      onOutput: (text, stream) => {
        if (stream === "stdout") stdout += text;
        else if (stderr.length < 8192) stderr += text.slice(0, 8192 - stderr.length);
      },
    });
    if (result.exitCode !== 0)
      throw new FileError(
        CODES[result.exitCode] ?? "unknown",
        stderr.trim() || `File operation failed (${result.exitCode})`,
        path,
      );
    return stdout;
  }
  // NUL-delimited metadata preserves filenames containing whitespace and newlines.
  private parseInfo(text: string): FileInfo[] {
    if (text === "") return [];
    if (!text.endsWith("\0")) throw new FileError("unknown", "Truncated sandbox file metadata");
    const fields = text.slice(0, -1).split("\0");
    if (fields.length % 4 !== 0) throw new FileError("unknown", "Invalid sandbox file metadata");
    const infos: FileInfo[] = [];
    for (let i = 0; i < fields.length; i += 4) {
      const path = fields[i];
      const kind = fields[i + 1];
      const size = Number(fields[i + 2]);
      const mtimeMs = Date.parse(fields[i + 3] ?? "");
      if (
        path === undefined ||
        (kind !== "file" && kind !== "directory" && kind !== "symlink") ||
        !Number.isFinite(size) ||
        !Number.isFinite(mtimeMs)
      )
        throw new FileError("unknown", "Invalid sandbox file metadata", path);
      infos.push({ name: posix.basename(path), path, kind, size, mtimeMs });
    }
    return infos;
  }
}
