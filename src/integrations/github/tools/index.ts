import { defineExtension } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";
import { createActionTools } from "./actions.ts";
import { createCheckTools } from "./checks.ts";
import { createIssueTools } from "./issues.ts";
import { createPublishChangesTool, type PublishChanges } from "./publish.ts";
import { createPullTools } from "./pulls.ts";
import { createReactionTools } from "./reactions.ts";
import { createSearchTools } from "./search.ts";
import { createUserTools } from "./users.ts";

export type GitHubToolsOptions = {
  name?: string;
  publish?: PublishChanges;
};

/** Creates a Pi extension for one authenticated GitHub workflow scope. */
export function createGitHubTools(github: GitHubClient, options: GitHubToolsOptions = {}) {
  return defineExtension({
    name: options.name ?? "github",
    tools: [
      ...createActionTools(github),
      ...createCheckTools(github),
      ...createIssueTools(github),
      ...createPullTools(github),
      ...createReactionTools(github),
      ...createSearchTools(github),
      ...createUserTools(github),
      ...(options.publish ? [createPublishChangesTool(options.publish)] : []),
    ],
  });
}
