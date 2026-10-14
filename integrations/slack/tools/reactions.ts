import type { ReactionsGetArguments, ReactionsRemoveArguments, WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

const channel = Type.String({ minLength: 1, description: "Channel where the message was posted." });
const timestamp = Type.String({ minLength: 1, description: "Message timestamp." });
const name = Type.String({ minLength: 1, description: "Emoji name without surrounding colons." });
const item = {
  channel: Type.Optional(channel),
  timestamp: Type.Optional(timestamp),
  file: Type.Optional(Type.String({ minLength: 1, description: "File ID." })),
  file_comment: Type.Optional(Type.String({ minLength: 1, description: "File comment ID." })),
};
const full = Type.Optional(Type.Boolean({ description: "Return the complete reaction list." }));

export function createReactionTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    add: defineTool({
      name: "slack_reactions_add",
      description: "Add an emoji reaction to a Slack message.",
      parameters: Type.Object({ channel, timestamp, name }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.reactions.add(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to add the Slack reaction: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    get: defineTool({
      name: "slack_reactions_get",
      description: "Get a Slack item and its reactions.",
      parameters: Type.Object({ ...item, full }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.reactions.get(args as ReactionsGetArguments);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get Slack reactions: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    remove: defineTool({
      name: "slack_reactions_remove",
      description: "Remove an emoji reaction from a Slack item.",
      parameters: Type.Object({ name, ...item }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.reactions.remove(args as ReactionsRemoveArguments);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to remove the Slack reaction: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
