export type GitHubPullRequestEvent = {
  deliveryId: string;
  type: "pull_request.opened" | "pull_request.synchronize";
  installationId: number;
  repository: { id: number; owner: string; name: string; fullName: string };
  pullRequest: {
    number: number;
    headSha: string;
    headRef: string;
    baseSha: string;
    title: string;
    body: string | null;
  };
  sender: { id: number; login: string; type: string };
};

export type GitHubReviewCommentEvent = {
  deliveryId: string;
  type: "pull_request_review_comment.created";
  installationId: number;
  repository: { id: number; owner: string; name: string; fullName: string };
  pullRequest: {
    number: number;
    headSha: string;
    headRef: string;
    baseSha: string;
    title: string;
    body: string | null;
  };
  comment: { id: number; body: string; inReplyToId?: number };
  sender: { id: number; login: string; type: string };
};

export type GitHubIssueCommentEvent = {
  deliveryId: string;
  type: "issue_comment.created";
  installationId: number;
  repository: { id: number; owner: string; name: string; fullName: string };
  pullRequest: { number: number };
  comment: { id: number; body: string };
  sender: { id: number; login: string; type: string };
};

export type GitHubWebhookEvent = GitHubPullRequestEvent | GitHubReviewCommentEvent | GitHubIssueCommentEvent;

type GitHubPayload = {
  action?: unknown;
  number?: unknown;
  installation?: { id?: unknown };
  repository?: { id?: unknown; name?: unknown; full_name?: unknown; owner?: { login?: unknown } };
  pull_request?: {
    title?: unknown;
    body?: unknown;
    head?: { sha?: unknown; ref?: unknown };
    base?: { sha?: unknown };
  };
  issue?: { number?: unknown; pull_request?: unknown };
  comment?: { id?: unknown; body?: unknown; in_reply_to_id?: unknown };
  sender?: { id?: unknown; login?: unknown; type?: unknown };
};

export async function verifyGitHubWebhook(
  rawBody: Uint8Array,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature?.startsWith("sha256=")) return false;
  const signatureBytes = hexBytes(signature.slice(7));
  if (!signatureBytes) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, arrayBuffer(signatureBytes), arrayBuffer(rawBody));
}

export function parseGitHubWebhook(headers: Headers, rawBody: Uint8Array): GitHubWebhookEvent | undefined {
  const eventName = headers.get("x-github-event");
  const deliveryId = headers.get("x-github-delivery");
  if (!deliveryId) throw new Error("Missing X-GitHub-Delivery header");

  const payload = JSON.parse(new TextDecoder().decode(rawBody)) as GitHubPayload;
  if (eventName === "pull_request" && (payload.action === "opened" || payload.action === "synchronize")) {
    const common = parseCommon(payload, deliveryId);
    const type = payload.action === "opened" ? "pull_request.opened" : "pull_request.synchronize";
    return { ...common, type };
  }
  if (eventName === "issue_comment" && payload.action === "created" && payload.issue?.pull_request) {
    return {
      deliveryId,
      type: "issue_comment.created",
      installationId: number(payload.installation?.id, "installation.id"),
      repository: parseRepository(payload),
      pullRequest: { number: number(payload.issue.number, "issue.number") },
      comment: {
        id: number(payload.comment?.id, "comment.id"),
        body: string(payload.comment?.body, "comment.body"),
      },
      sender: parseSender(payload),
    };
  }
  if (eventName === "pull_request_review_comment" && payload.action === "created") {
    const common = parseCommon(payload, deliveryId);
    return {
      ...common,
      type: "pull_request_review_comment.created",
      comment: {
        id: number(payload.comment?.id, "comment.id"),
        body: string(payload.comment?.body, "comment.body"),
        ...(typeof payload.comment?.in_reply_to_id === "number" ? { inReplyToId: payload.comment.in_reply_to_id } : {}),
      },
    };
  }
  return undefined;
}

export function isGitHubAppSender(event: GitHubWebhookEvent, appLogin: string): boolean {
  return event.sender.type === "Bot" && event.sender.login.toLowerCase() === appLogin.toLowerCase();
}

function parseCommon(payload: GitHubPayload, deliveryId: string) {
  const pullRequest = payload.pull_request;
  return {
    deliveryId,
    installationId: number(payload.installation?.id, "installation.id"),
    repository: parseRepository(payload),
    pullRequest: {
      number: number(payload.number, "number"),
      headSha: string(pullRequest?.head?.sha, "pull_request.head.sha"),
      headRef: string(pullRequest?.head?.ref, "pull_request.head.ref"),
      baseSha: string(pullRequest?.base?.sha, "pull_request.base.sha"),
      title: string(pullRequest?.title, "pull_request.title"),
      body: nullableString(pullRequest?.body, "pull_request.body"),
    },
    sender: parseSender(payload),
  };
}

function parseRepository(payload: GitHubPayload) {
  return {
    id: number(payload.repository?.id, "repository.id"),
    owner: string(payload.repository?.owner?.login, "repository.owner.login"),
    name: string(payload.repository?.name, "repository.name"),
    fullName: string(payload.repository?.full_name, "repository.full_name"),
  };
}

function parseSender(payload: GitHubPayload) {
  return {
    id: number(payload.sender?.id, "sender.id"),
    login: string(payload.sender?.login, "sender.login"),
    type: string(payload.sender?.type, "sender.type"),
  };
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`Invalid GitHub webhook field: ${path}`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return string(value, path);
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number") throw new Error(`Invalid GitHub webhook field: ${path}`);
  return value;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function hexBytes(hex: string): Uint8Array | undefined {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return undefined;
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}
