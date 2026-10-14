import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createEmojiTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    list: defineTool({
      name: "slack_emoji_list",
      description: "List custom emoji and aliases in the Slack workspace.",
      parameters: Type.Object({
        include_categories: Type.Optional(
          Type.Boolean({ description: "Include Unicode emoji categories and the emoji in each category." }),
        ),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.emoji.list(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to list Slack emoji: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
