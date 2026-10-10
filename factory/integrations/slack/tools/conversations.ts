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
      context.abortSignal?.throwIfAborted();
      const response = await client.conversations.replies({
        channel,
        ts: thread,
        cursor,
        limit: limit ?? 15,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              messages: response.messages?.map((message) => ({
                user: message.user,
                text: message.text,
                ts: message.ts,
              })),
              hasMore: response.has_more,
              nextCursor: response.response_metadata?.next_cursor,
            }),
          },
        ],
      };
    },
  });
}
