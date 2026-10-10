import type { LinearClient } from "@linear/sdk";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createReadTool(client: LinearClient, _ctx: IntegrationContext) {
  return defineTool({
    name: "linear_read_issue",
    description: "Read a Linear issue.",
    parameters: Type.Object({
      issueId: Type.String({ minLength: 1, description: "Issue UUID or identifier." }),
    }),
    replay: "safe",
    async execute({ issueId }, _api, context) {
      context.abortSignal?.throwIfAborted();
      const issue = await client.issue(issueId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              url: issue.url,
            }),
          },
        ],
      };
    },
  });
}
