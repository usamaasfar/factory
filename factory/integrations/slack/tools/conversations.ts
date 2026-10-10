import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createReadTool(client: WebClient, _ctx: IntegrationContext) {
  return defineTool({
    name: "slack_read_thread",
    description: "Read one page of messages in a Slack thread.",
    parameters: Type.Object({
      channel: Type.String({ minLength: 1 }),
      thread: Type.String({ minLength: 1, description: "Parent message timestamp." }),
      cursor: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 15 })),
    }),
    replay: "safe",
    async execute({ channel, thread, cursor, limit }, _api, context) {
      try {
        context.abortSignal?.throwIfAborted();
        const response = await client.conversations.replies({
          channel,
          ts: thread,
          cursor,
          limit: limit ?? 15,
        });
        const messages = response.messages ?? [];
        const formattedMessages =
          messages.map((message) => `[${message.ts}] ${message.user ?? "unknown"}: ${message.text ?? ""}`).join("\n") ||
          "none";
        const nextCursor = response.response_metadata?.next_cursor;
        const pagination = nextCursor ? `\nNext cursor: ${nextCursor}` : "";

        return {
          content: `Read ${messages.length} messages from Slack channel ${channel}, thread ${thread}:\n${formattedMessages}${pagination}`,
        };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return {
          content: `Failed to read the Slack thread: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
}
