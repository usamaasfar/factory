import { defineExtension } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";
import { createActionTools } from "./actions.ts";
import { createCheckTools } from "./checks.ts";
import { createFetchBranchTool, type FetchBranch } from "./fetch-branch.ts";
import { createIssueTools } from "./issues.ts";
import { createPullTools } from "./pulls.ts";
import { createPushBranchTool, type PushBranch } from "./push-branch.ts";
import { createReactionTools } from "./reactions.ts";
import { createSearchTools } from "./search.ts";
import { createUserTools } from "./users.ts";

export type GitHubToolsOptions = {
  name?: string;
  fetchBranch?: FetchBranch;
  pushBranch?: PushBranch;
};

/** Creates a Pi extension for one authenticated GitHub workflow scope. */
export function createGitHubTools(github: GitHubClient, options: GitHubToolsOptions = {}) {
  return defineExtension({
    name: options.name ?? "github",
    tools: [
      ...createActionTools(github),
      ...createCheckTools(github),
      ...(options.fetchBranch ? [createFetchBranchTool(options.fetchBranch)] : []),
      ...createIssueTools(github),
      ...createPullTools(github),
      ...createReactionTools(github),
      ...createSearchTools(github),
      ...createUserTools(github),
      ...(options.pushBranch ? [createPushBranchTool(options.pushBranch)] : []),
    ],
  });
}
