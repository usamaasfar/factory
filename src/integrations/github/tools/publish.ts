import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";

export type PublishChanges = (env: ExecutionEnv, context: Context) => Promise<string>;

/** Publishes committed sandbox changes through the trusted host Git transport. */
export function createPublishChangesTool(publish: PublishChanges) {
  return defineTool({
    name: "github_publish_changes",
    description:
      "Publish the committed changes in the current workspace to this pull request branch. Commit all intended changes with Git before calling this tool.",
    parameters: Type.Object({}),
    replay: "unsafe",
    executionMode: "sequential",
    execute: async (_args, api, context) => {
      if (!api.env) throw new Error("github_publish_changes requires an execution environment");
      return {
        content: [{ type: "text", text: `Published commit ${await publish(api.env, context)}.` }],
      };
    },
  });
}
