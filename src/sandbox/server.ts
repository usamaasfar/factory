import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { SandboxRequest, SandboxResponse, SandboxResult } from "./protocol.ts";

const workspace = await realpath(process.env.FACTORY_WORKSPACE ?? "/workspace");

function errorResponse(id: string, code: string, message: string): SandboxResponse {
  return { id, error: { code, message } };
}

function send(response: SandboxResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function workspacePath(path: string): string {
  const candidate = resolve(workspace, path);
  const fromWorkspace = relative(workspace, candidate);

  if (isAbsolute(fromWorkspace) || fromWorkspace === ".." || fromWorkspace.startsWith(`..${sep}`)) {
    throw new Error(`Path is outside the workspace: ${path}`);
  }

  return candidate;
}

async function handle(request: SandboxRequest): Promise<SandboxResult> {
  switch (request.method) {
    case "ping":
      return { method: "ping", value: { ready: true } };

    case "exec": {
      const cwd = workspacePath(request.params.cwd ?? ".");
      const process = Bun.spawn(["/bin/bash", "-lc", request.params.command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      return { method: "exec", value: { exitCode, stdout, stderr } };
    }

    case "read": {
      const content = await readFile(workspacePath(request.params.path), "utf8");
      return { method: "read", value: { content } };
    }

    case "write": {
      const path = workspacePath(request.params.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, request.params.content, "utf8");
      return { method: "write", value: { bytesWritten: Buffer.byteLength(request.params.content) } };
    }
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

for await (const line of lines) {
  if (!line.trim()) continue;

  let request: SandboxRequest;
  try {
    request = JSON.parse(line) as SandboxRequest;
  } catch {
    send(errorResponse("unknown", "INVALID_JSON", "Request must be valid JSON"));
    continue;
  }

  try {
    send({ id: request.id, result: await handle(request) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(errorResponse(request.id, "OPERATION_FAILED", message));
  }
}
