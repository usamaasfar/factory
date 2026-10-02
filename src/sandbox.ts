import type { SandboxRequest, SandboxResponse, SandboxResult } from "./sandbox/protocol.ts";

type RequestParams = SandboxRequest["params"];

type PendingRequest = {
  resolve: (result: SandboxResult) => void;
  reject: (error: Error) => void;
};

export class DockerSandbox {
  readonly #process: Bun.PipedSubprocess;
  readonly #pending = new Map<string, PendingRequest>();
  #nextRequestId = 1;
  #stderr = "";

  private constructor(process: Bun.PipedSubprocess) {
    this.#process = process;
    void this.#consumeStdout();
    void this.#consumeStderr();
  }

  static async start(image: string): Promise<DockerSandbox> {
    const process = Bun.spawn(["docker", "run", "--rm", "--interactive", image], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const sandbox = new DockerSandbox(process);
    await sandbox.ping();
    return sandbox;
  }

  async ping(): Promise<void> {
    const result = await this.#request("ping", {});
    if (result.method !== "ping" || !result.value.ready) throw new Error("Sandbox did not become ready");
  }

  async exec(command: string, cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await this.#request("exec", { command, cwd });
    if (result.method !== "exec") throw new Error(`Unexpected sandbox response: ${result.method}`);
    return result.value;
  }

  async read(path: string): Promise<string> {
    const result = await this.#request("read", { path });
    if (result.method !== "read") throw new Error(`Unexpected sandbox response: ${result.method}`);
    return result.value.content;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const result = await this.#request("readBinary", { path });
    if (result.method !== "readBinary") throw new Error(`Unexpected sandbox response: ${result.method}`);
    return Uint8Array.from(Buffer.from(result.value.content, "base64"));
  }

  async write(path: string, content: string): Promise<void> {
    const result = await this.#request("write", { path, content });
    if (result.method !== "write") throw new Error(`Unexpected sandbox response: ${result.method}`);
  }

  async writeBinary(path: string, content: Uint8Array): Promise<void> {
    const encoded = Buffer.from(content).toString("base64");
    const result = await this.#request("writeBinary", { path, content: encoded });
    if (result.method !== "writeBinary") throw new Error(`Unexpected sandbox response: ${result.method}`);
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.#request("exists", { path });
    if (result.method !== "exists") throw new Error(`Unexpected sandbox response: ${result.method}`);
    return result.value.exists;
  }

  async fileInfo(path: string) {
    const result = await this.#request("fileInfo", { path });
    if (result.method !== "fileInfo") throw new Error(`Unexpected sandbox response: ${result.method}`);
    return result.value;
  }

  async stop(): Promise<void> {
    this.#process.stdin.end();
    const exitCode = await this.#process.exited;
    if (exitCode !== 0) throw new Error(`Sandbox exited with code ${exitCode}: ${this.#stderr.trim()}`);
  }

  async #request(method: SandboxRequest["method"], params: RequestParams): Promise<SandboxResult> {
    const id = String(this.#nextRequestId++);
    const request = { id, method, params } as SandboxRequest;

    const response = new Promise<SandboxResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });

    this.#process.stdin.write(`${JSON.stringify(request)}\n`);
    await this.#process.stdin.flush();
    return response;
  }

  async #consumeStdout(): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = "";

    for await (const chunk of this.#process.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) this.#handleResponse(line);
    }

    buffered += decoder.decode();
    if (buffered) this.#handleResponse(buffered);

    const error = new Error(`Sandbox closed before responding: ${this.#stderr.trim()}`);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #handleResponse(line: string): void {
    const response = JSON.parse(line) as SandboxResponse;
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);

    if ("error" in response) pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    else pending.resolve(response.result);
  }

  async #consumeStderr(): Promise<void> {
    this.#stderr = await new Response(this.#process.stderr).text();
  }
}
