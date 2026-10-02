import { createPrivateKey, createSign } from "node:crypto";

const API_VERSION = "2022-11-28";

export type GitHubAppOptions = {
  appId: string;
  privateKey: string;
  apiUrl?: string;
};

export class GitHubApp {
  readonly #appId: string;
  readonly #privateKey: string;
  readonly #apiUrl: string;

  constructor(options: GitHubAppOptions) {
    this.#appId = options.appId;
    this.#privateKey = options.privateKey;
    this.#apiUrl = options.apiUrl ?? "https://api.github.com";
  }

  async installationClient(installationId: number, repositoryId?: number): Promise<GitHubClient> {
    const response = await this.#request<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.#jwt()}` },
        body: JSON.stringify(repositoryId ? { repository_ids: [repositoryId] } : {}),
      },
    );
    return new GitHubClient(response.token, this.#apiUrl);
  }

  async #request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.#apiUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": API_VERSION,
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  #jwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encodeJson({ alg: "RS256", typ: "JWT" });
    const payload = encodeJson({ iat: now - 60, exp: now + 9 * 60, iss: this.#appId });
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const signature = signer.sign(createPrivateKey(this.#privateKey)).toString("base64url");
    return `${unsigned}.${signature}`;
  }
}

export class GitHubClient {
  constructor(
    readonly token: string,
    readonly apiUrl = "https://api.github.com",
  ) {}

  async file(owner: string, repository: string, path: string, ref: string): Promise<string> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const query = new URLSearchParams({ ref });
    const file = await this.request<{ content: string; encoding: string }>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?${query}`,
    );
    if (file.encoding !== "base64") throw new Error(`Unsupported GitHub content encoding: ${file.encoding}`);
    return Buffer.from(file.content.replaceAll("\n", ""), "base64").toString("utf8");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-github-api-version": API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
