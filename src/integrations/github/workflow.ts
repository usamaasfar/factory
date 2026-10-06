import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { WorkspaceLifecycle } from "../../workspace/index.ts";
import { type GitIdentity, initializeCodingWorkspace, prepareCodingWorkspace } from "../../workspace/index.ts";
import type { GitHubApp } from "./index.ts";
import type { GitHubEvent } from "./webhooks.ts";

export interface GitHubPullRequestTarget {
  installationId: number;
  repositoryId: number;
  owner: string;
  repository: string;
  number: number;
  branch: string;
  revision: string;
  headRepositoryId: number;
}

/** Resolves the current pull request head represented by a workflow event. */
export async function resolveGitHubPullRequestTarget(
  github: GitHubApp,
  event: GitHubEvent,
): Promise<GitHubPullRequestTarget> {
  if (!("prompt" in event)) throw new Error("GitHub event does not identify a workflow pull request");
  const installationId = event.payload.installation?.id;
  if (!installationId) throw new Error("GitHub workflow event has no installation");

  const repositoryId = event.payload.repository.id;
  const owner = event.payload.repository.owner.login;
  const repository = event.payload.repository.name;
  const pullRequest =
    "pull_request" in event.payload
      ? event.payload.pull_request
      : (
          await (
            await github.client({ installationId, repositoryId })
          ).rest.pulls.get({ owner, repo: repository, pull_number: event.payload.issue.number })
        ).data;

  return {
    installationId,
    repositoryId,
    owner,
    repository,
    number: pullRequest.number,
    branch: pullRequest.head.ref,
    revision: pullRequest.head.sha,
    headRepositoryId: pullRequest.head.repo?.id ?? 0,
  };
}

/** Creates and initializes the persistent workspace for a new pull-request session. */
export async function prepareGitHubWorkspace(
  github: GitHubApp,
  workspaces: WorkspaceLifecycle,
  workspaceId: string,
  identity: GitIdentity,
  target: GitHubPullRequestTarget,
  context: Context,
): Promise<void> {
  await workspaces.ensure(
    workspaceId,
    async (env, initializeContext) => {
      const directory = await mkdtemp(join(tmpdir(), "factory-workspace-"));
      try {
        await github.repository(target).clone(directory, target.revision);
        const prepared = await prepareCodingWorkspace(directory, initializeContext);
        await initializeCodingWorkspace(env, prepared, identity, initializeContext);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    context,
  );
}
