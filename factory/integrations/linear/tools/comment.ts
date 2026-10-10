import type { LinearClient } from "@linear/sdk";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createCommentTool(client: LinearClient, _ctx: IntegrationContext) {
  return defineTool({
    name: "linear_comment_on_issue",
    description: "Post a comment on a Linear issue.",
    parameters: Type.Object({
      issueId: Type.String({ minLength: 1, description: "Canonical issue UUID." }),
      body: Type.String({ minLength: 1 }),
    }),
    replay: "unsafe",
    async execute({ issueId, body }, _api, context) {
      context.abortSignal?.throwIfAborted();
      const result = await client.createComment({ issueId, body });
      if (!result.success) throw new Error("Linear did not create the comment.");
      // Do not perform another network request after a successful mutation.
      return { content: [{ type: "text", text: "Comment created." }] };
    },
  });
}
