import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { Sandboxes } from "../../sandbox/index.ts";
import type { GitHubApp } from "./index.ts";
import type { GitHubEvent } from "./webhooks.ts";

/** Replaces a conversation's workspace with the pull request's current head. */
export async function prepareGitHubWorkspace(
  github: GitHubApp,
  sandboxes: Sandboxes,
  event: GitHubEvent,
  conversationId: ConversationId,
  context: Context,
): Promise<void> {
  if (!("prompt" in event)) return;
  const installationId = event.payload.installation?.id;
  if (!installationId) throw new Error("GitHub workflow event has no installation");

  const repositoryId = event.payload.repository.id;
  const owner = event.payload.repository.owner.login;
  const repository = event.payload.repository.name;
  let revision: string;
  if ("pull_request" in event.payload) {
    revision = event.payload.pull_request.head.sha;
  } else {
    const client = await github.client({ installationId, repositoryId });
    const response = await client.rest.pulls.get({ owner, repo: repository, pull_number: event.payload.issue.number });
    revision = response.data.head.sha;
  }

  const directory = await mkdtemp(join(tmpdir(), "factory-workspace-"));
  try {
    await github.repository({ installationId, repositoryId, owner, repository }).clone(directory, revision);
    await sandboxes.replace(conversationId, directory, context);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
