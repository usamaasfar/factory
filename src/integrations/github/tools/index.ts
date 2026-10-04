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

/** Creates the Pi extension for an authenticated GitHub installation. */
export function createGitHubTools(github: GitHubClient, publish?: PublishChanges) {
  return defineExtension({
    name: "github",
    tools: [
      ...createActionTools(github),
      ...createCheckTools(github),
      ...createIssueTools(github),
      ...createPullTools(github),
      ...createReactionTools(github),
      ...createSearchTools(github),
      ...createUserTools(github),
      ...(publish ? [createPublishChangesTool(publish)] : []),
    ],
  });
}
