import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createReplyTool(client: WebClient, _ctx: IntegrationContext) {
  return defineTool({
    name: "slack_reply_to_thread",
    description: "Reply to a Slack thread.",
    parameters: Type.Object({
      channel: Type.String({ minLength: 1 }),
      thread: Type.String({ minLength: 1, description: "Parent message timestamp." }),
      text: Type.String({ minLength: 1, maxLength: 4000 }),
    }),
    replay: "unsafe",
    async execute({ channel, thread, text }, _api, context) {
      try {
        context.abortSignal?.throwIfAborted();
        const response = await client.chat.postMessage({
          channel,
          thread_ts: thread,
          text,
          unfurl_links: false,
          unfurl_media: false,
        });
        const timestamp = response.ts ? ` at ${response.ts}` : "";
        return {
          content: `Replied in Slack channel ${response.channel ?? channel}${timestamp}.`,
        };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return {
          content: `Failed to reply in Slack: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
}
