export type SandboxRequest =
  | { id: string; method: "ping"; params: Record<string, never> }
  | { id: string; method: "exec"; params: { command: string; cwd?: string } }
  | { id: string; method: "read"; params: { path: string } }
  | { id: string; method: "write"; params: { path: string; content: string } };

export type SandboxResult =
  | { method: "ping"; value: { ready: true } }
  | { method: "exec"; value: { exitCode: number; stdout: string; stderr: string } }
  | { method: "read"; value: { content: string } }
  | { method: "write"; value: { bytesWritten: number } };

export type SandboxResponse =
  | { id: string; result: SandboxResult }
  | { id: string; error: { code: string; message: string } };
