import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createConversationTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    readThread: defineTool({
      name: "slack_read_thread",
      description: "Read one page of messages in a Slack thread.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1 }),
        thread: Type.String({ minLength: 1, description: "Parent message timestamp." }),
        cursor: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
      }),
      replay: "safe",
      access: "read",
      async execute({ channel, thread, cursor, limit }) {
        try {
          const response = await client.conversations.replies({ channel, ts: thread, cursor, limit });
          const messages = response.messages ?? [];
          const formattedMessages =
            messages
              .map((message) => `[${message.ts}] ${message.user ?? "unknown"}: ${message.text ?? ""}`)
              .join("\n") || "none";
          const nextCursor = response.response_metadata?.next_cursor;
          const pagination = nextCursor ? `\nNext cursor: ${nextCursor}` : "";

          return {
            content: `Read ${messages.length} messages from Slack channel ${channel}, thread ${thread}:\n${formattedMessages}${pagination}`,
          };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to read the Slack thread: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    list: defineTool({
      name: "slack_conversations_list",
      description: "List available Slack channels.",
      parameters: Type.Object({
        cursor: Type.Optional(Type.String({ description: "Pagination cursor from the previous response." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })),
        types: Type.Optional(
          Type.String({ description: "Comma-separated channel types: public_channel, private_channel." }),
        ),
        exclude_archived: Type.Optional(Type.Boolean()),
        team_id: Type.Optional(Type.String({ minLength: 1, description: "Workspace ID." })),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.conversations.list(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to list Slack channels: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    info: defineTool({
      name: "slack_conversations_info",
      description: "Get information about a Slack channel.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        include_locale: Type.Optional(Type.Boolean()),
        include_num_members: Type.Optional(Type.Boolean()),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.conversations.info(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get the Slack channel: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    history: defineTool({
      name: "slack_conversations_history",
      description: "Read a page of messages in a Slack channel.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        cursor: Type.Optional(Type.String({ description: "Pagination cursor from the previous response." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
        oldest: Type.Optional(Type.String({ description: "Only include messages after this timestamp." })),
        latest: Type.Optional(Type.String({ description: "Only include messages before this timestamp." })),
        inclusive: Type.Optional(Type.Boolean({ description: "Include messages at the timestamp boundaries." })),
        include_all_metadata: Type.Optional(Type.Boolean()),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.conversations.history(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to read Slack channel history: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    members: defineTool({
      name: "slack_conversations_members",
      description: "List members of a Slack channel.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        cursor: Type.Optional(Type.String({ description: "Pagination cursor from the previous response." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.conversations.members(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to list Slack channel members: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    join: defineTool({
      name: "slack_conversations_join",
      description: "Join a public Slack channel.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.conversations.join(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to join the Slack channel: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    canvasesCreate: defineTool({
      name: "slack_conversations_canvases_create",
      description: "Create a Slack channel's dedicated canvas.",
      parameters: Type.Object({
        channel_id: Type.String({ minLength: 1, description: "Channel ID." }),
        title: Type.Optional(Type.String()),
        document_content: Type.Optional(
          Type.Object({
            type: Type.Literal("markdown"),
            markdown: Type.String({ maxLength: 1048576 }),
          }),
        ),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.conversations.canvases.create(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to create the Slack channel canvas: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
