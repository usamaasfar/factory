import type { LinearClient } from "@linear/sdk";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createCommentTools(client: LinearClient, _ctx: IntegrationContext) {
  return {
    create: defineTool({
      name: "linear_comment_on_issue",
      description: "Post a comment on a Linear issue.",
      parameters: Type.Object({
        issueId: Type.String({ minLength: 1, description: "Issue UUID or identifier." }),
        body: Type.String({ minLength: 1 }),
      }),
      replay: "unsafe",
      async execute({ issueId, body }, _api, context) {
        try {
          context.abortSignal?.throwIfAborted();
          const result = await client.createComment({ issueId, body });
          if (!result.success) throw new Error("Linear did not create the comment.");

          return { content: `Commented on Linear issue ${issueId}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to comment on the Linear issue: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
