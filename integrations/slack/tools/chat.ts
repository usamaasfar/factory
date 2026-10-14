import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createChatTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    replyToThread: defineTool({
      name: "slack_reply_to_thread",
      description: "Reply to a Slack thread.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1 }),
        thread: Type.String({ minLength: 1, description: "Parent message timestamp." }),
        text: Type.String({ minLength: 1, maxLength: 4000 }),
      }),
      replay: "unsafe",
      access: "write",
      async execute({ channel, thread, text }) {
        try {
          const response = await client.chat.postMessage({
            channel,
            thread_ts: thread,
            text,
            unfurl_links: false,
            unfurl_media: false,
          });
          const timestamp = response.ts ? ` at ${response.ts}` : "";
          return { content: `Replied in Slack channel ${response.channel ?? channel}${timestamp}.` };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to reply in Slack: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    postMessage: defineTool({
      name: "slack_chat_postMessage",
      description: "Post a message to a Slack channel or thread.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        text: Type.String({ minLength: 1, maxLength: 4000 }),
        thread_ts: Type.Optional(Type.String({ minLength: 1, description: "Parent message timestamp." })),
        mrkdwn: Type.Optional(Type.Boolean({ description: "Interpret Slack markup in the text." })),
        unfurl_links: Type.Optional(Type.Boolean({ description: "Show previews of linked pages." })),
        unfurl_media: Type.Optional(Type.Boolean({ description: "Show previews of linked media." })),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.chat.postMessage(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to post the Slack message: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    update: defineTool({
      name: "slack_chat_update",
      description: "Update one of your own Slack messages.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        ts: Type.String({ minLength: 1, description: "Message timestamp." }),
        text: Type.String({ minLength: 1, maxLength: 4000 }),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.chat.update(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to update the Slack message: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    getPermalink: defineTool({
      name: "slack_chat_getPermalink",
      description: "Get a direct link to a Slack message.",
      parameters: Type.Object({
        channel: Type.String({ minLength: 1, description: "Channel ID." }),
        message_ts: Type.String({ minLength: 1, description: "Message timestamp." }),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.chat.getPermalink(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get the Slack message link: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
