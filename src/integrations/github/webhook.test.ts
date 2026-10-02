import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseGitHubWebhook, verifyGitHubWebhook } from "./webhook.ts";

const payload = {
  action: "opened",
  number: 42,
  installation: { id: 7 },
  repository: { id: 10, name: "factory", full_name: "acme/factory", owner: { login: "acme" } },
  pull_request: {
    title: "Test Factory",
    body: null,
    head: { sha: "head-sha", ref: "feature" },
    base: { sha: "base-sha" },
  },
  sender: { id: 99, login: "alice", type: "User" },
};

describe("GitHub webhooks", () => {
  test("verifies the raw request body", async () => {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(await verifyGitHubWebhook(body, signature, "secret")).toBe(true);
    expect(await verifyGitHubWebhook(body, signature, "wrong-secret")).toBe(false);
  });

  test("parses an opened pull request", () => {
    const headers = new Headers({ "x-github-event": "pull_request", "x-github-delivery": "delivery-1" });
    const event = parseGitHubWebhook(headers, new TextEncoder().encode(JSON.stringify(payload)));
    expect(event).toEqual({
      deliveryId: "delivery-1",
      type: "pull_request.opened",
      installationId: 7,
      repository: { id: 10, owner: "acme", name: "factory", fullName: "acme/factory" },
      pullRequest: {
        number: 42,
        headSha: "head-sha",
        headRef: "feature",
        baseSha: "base-sha",
        title: "Test Factory",
        body: null,
      },
      sender: { id: 99, login: "alice", type: "User" },
    });
  });

  test("parses a pull request conversation comment", () => {
    const headers = new Headers({ "x-github-event": "issue_comment", "x-github-delivery": "delivery-2" });
    const event = parseGitHubWebhook(
      headers,
      new TextEncoder().encode(
        JSON.stringify({
          ...payload,
          action: "created",
          issue: { number: 42, pull_request: { url: "https://api.github.test/pulls/42" } },
          comment: { id: 123, body: "Please explain" },
        }),
      ),
    );
    expect(event).toMatchObject({
      type: "issue_comment.created",
      pullRequest: { number: 42 },
      comment: { id: 123, body: "Please explain" },
    });
  });

  test("ignores unsupported events", () => {
    const headers = new Headers({ "x-github-event": "ping", "x-github-delivery": "delivery-2" });
    expect(parseGitHubWebhook(headers, new TextEncoder().encode("{}"))).toBeUndefined();
  });
});
