import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

export type PublishChanges = (context: Context) => Promise<string>;

/** Publishes committed sandbox changes through the trusted host Git transport. */
export function createPublishChangesTool(publish: PublishChanges) {
  return defineTool({
    name: "github_publish_changes",
    description:
      "Publish the committed changes in the current workspace to this pull request branch. Commit all intended changes with Git before calling this tool.",
    parameters: Type.Object({}),
    replay: "unsafe",
    executionMode: "sequential",
    execute: async (_args, _api, context) => ({
      content: [{ type: "text", text: `Published commit ${await publish(context)}.` }],
    }),
  });
}
