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
      context.abortSignal?.throwIfAborted();
      const response = await client.chat.postMessage({
        channel,
        thread_ts: thread,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ channel: response.channel, ts: response.ts }) }],
      };
    },
  });
}
