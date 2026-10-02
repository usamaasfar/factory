import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { GitHubWebhookEvent } from "./integrations/github/webhook.ts";
import { createServer } from "./server.ts";

const servers: Bun.Server<unknown>[] = [];
const secret = "test-secret";

const payload = {
  action: "opened",
  number: 42,
  installation: { id: 7 },
  repository: { id: 10, name: "factory-test", full_name: "usamaasfar/factory-test", owner: { login: "usamaasfar" } },
  pull_request: {
    title: "Test Factory",
    body: null,
    head: { sha: "head-sha", ref: "feature" },
    base: { sha: "base-sha" },
  },
  sender: { id: 99, login: "alice", type: "User" },
};

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("Factory server", () => {
  test("reports health", async () => {
    const server = start();
    const response = await fetch(new URL("/health", server.url));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("accepts a signed GitHub event", async () => {
    const events: GitHubWebhookEvent[] = [];
    const server = start((event) => events.push(event));
    const response = await deliver(server, payload);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pull_request.opened");
  });

  test("rejects an invalid signature", async () => {
    const server = start();
    const response = await fetch(new URL("/webhooks/github", server.url), {
      method: "POST",
      headers: webhookHeaders("sha256=invalid"),
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(401);
  });

  test("ignores events sent by the app", async () => {
    const events: GitHubWebhookEvent[] = [];
    const server = start((event) => events.push(event));
    const response = await deliver(server, {
      ...payload,
      sender: { id: 100, login: "factory-agent[bot]", type: "Bot" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(events).toHaveLength(0);
  });
});

function start(onGitHubEvent?: (event: GitHubWebhookEvent) => void) {
  const server = createServer({ webhookSecret: secret, appLogin: "factory-agent[bot]", port: 0, onGitHubEvent });
  servers.push(server);
  return server;
}

async function deliver(server: Bun.Server<unknown>, value: unknown): Promise<Response> {
  const body = JSON.stringify(value);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return fetch(new URL("/webhooks/github", server.url), {
    method: "POST",
    headers: webhookHeaders(signature),
    body,
  });
}

function webhookHeaders(signature: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-github-delivery": crypto.randomUUID(),
    "x-github-event": "pull_request",
    "x-hub-signature-256": signature,
  };
}
