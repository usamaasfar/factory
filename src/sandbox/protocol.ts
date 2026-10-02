export type SandboxRequest =
  | { id: string; method: "ping"; params: Record<string, never> }
  | { id: string; method: "exec"; params: { command: string; cwd?: string } }
  | { id: string; method: "read"; params: { path: string } }
  | { id: string; method: "readBinary"; params: { path: string } }
  | { id: string; method: "write"; params: { path: string; content: string } }
  | { id: string; method: "writeBinary"; params: { path: string; content: string } }
  | { id: string; method: "exists"; params: { path: string } }
  | { id: string; method: "fileInfo"; params: { path: string } };

export type SandboxResult =
  | { method: "ping"; value: { ready: true } }
  | { method: "exec"; value: { exitCode: number; stdout: string; stderr: string } }
  | { method: "read"; value: { content: string } }
  | { method: "readBinary"; value: { content: string } }
  | { method: "write"; value: { bytesWritten: number } }
  | { method: "writeBinary"; value: { bytesWritten: number } }
  | { method: "exists"; value: { exists: boolean } }
  | {
      method: "fileInfo";
      value: { name: string; path: string; kind: "file" | "directory" | "symlink"; size: number; mtimeMs: number };
    };

export type SandboxResponse =
  | { id: string; result: SandboxResult }
  | { id: string; error: { code: string; message: string } };
