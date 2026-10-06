import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

export type PushBranch = (env: ExecutionEnv, branch: string, context: Context) => Promise<string>;

/** Pushes the workspace HEAD through trusted-host Git transport. */
export function createPushBranchTool(push: PushBranch) {
  return defineTool({
    name: "github_push_branch",
    description:
      "Push the committed workspace HEAD to a repository branch. The push creates a missing branch or fast-forwards an existing branch; it never force-pushes.",
    parameters: Type.Object({
      branch: Type.String({ description: "Repository branch to push" }),
    }),
    replay: "unsafe",
    executionMode: "sequential",
    execute: async ({ branch }, api, context) => {
      if (!api.env) throw new Error("github_push_branch requires an execution environment");
      return {
        content: [{ type: "text", text: `Pushed commit ${await push(api.env, branch, context)}.` }],
      };
    },
  });
}
