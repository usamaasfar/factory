import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

// The installed SDK does not yet expose assistant.search methods.
export function createAssistantTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    searchContext: defineTool({
      name: "slack_assistant_search_context",
      description: "Search Slack discussions, files, channels, and users for relevant context.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        action_token: Type.Optional(
          Type.String({
            minLength: 1,
            description: "Action token from the triggering Slack event; required for bot tokens.",
          }),
        ),
        channel_types: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal("public_channel"),
              Type.Literal("private_channel"),
              Type.Literal("mpim"),
              Type.Literal("im"),
            ]),
            { minItems: 1 },
          ),
        ),
        content_types: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal("messages"),
              Type.Literal("files"),
              Type.Literal("channels"),
              Type.Literal("users"),
            ]),
            { minItems: 1 },
          ),
        ),
        include_bots: Type.Optional(Type.Boolean()),
        include_deleted_users: Type.Optional(Type.Boolean()),
        before: Type.Optional(Type.Integer({ minimum: 0 })),
        after: Type.Optional(Type.Integer({ minimum: 0 })),
        include_context_messages: Type.Optional(Type.Boolean()),
        context_channel_id: Type.Optional(Type.String({ minLength: 1 })),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        sort: Type.Optional(Type.Union([Type.Literal("score"), Type.Literal("timestamp")])),
        sort_dir: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
        include_message_blocks: Type.Optional(Type.Boolean()),
        highlight: Type.Optional(Type.Boolean()),
        term_clauses: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 5 })),
        modifiers: Type.Optional(Type.String()),
        include_archived_channels: Type.Optional(Type.Boolean()),
        disable_semantic_search: Type.Optional(Type.Boolean()),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.apiCall("assistant.search.context", args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to search Slack: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    searchInfo: defineTool({
      name: "slack_assistant_search_info",
      description: "Check whether semantic search is enabled in the Slack workspace.",
      parameters: Type.Object({}),
      replay: "safe",
      access: "read",
      async execute() {
        try {
          const response = await client.apiCall("assistant.search.info");
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get Slack search capabilities: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
