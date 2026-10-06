import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

export type FetchBranch = (env: ExecutionEnv, branch: string, context: Context) => Promise<string>;

/** Fetches a repository branch without changing the workspace checkout. */
export function createFetchBranchTool(fetch: FetchBranch) {
  return defineTool({
    name: "github_fetch_branch",
    description:
      "Fetch a branch into its origin tracking ref. This imports Git objects but does not merge, rebase, or change the working tree.",
    parameters: Type.Object({
      branch: Type.String({ description: "Repository branch to fetch" }),
    }),
    replay: "safe",
    executionMode: "sequential",
    execute: async ({ branch }, api, context) => {
      if (!api.env) throw new Error("github_fetch_branch requires an execution environment");
      return {
        content: [{ type: "text", text: `Fetched commit ${await fetch(api.env, branch, context)}.` }],
      };
    },
  });
}
