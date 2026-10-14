import { WebClient } from "@slack/web-api";
import { defineIntegration, defineResource } from "factory-oss/integration";
import { createFileEvents } from "./events/files.ts";
import { createMessageEvents } from "./events/message.ts";
import { createReactionEvents } from "./events/reactions.ts";
import { createSlackEventReceiver } from "./events/receive.ts";
import { createAssistantTools } from "./tools/assistant.ts";
import { createBookmarkTools } from "./tools/bookmarks.ts";
import { createCanvasTools } from "./tools/canvases.ts";
import { createChatTools } from "./tools/chat.ts";
import { createConversationTools } from "./tools/conversations.ts";
import { createEmojiTools } from "./tools/emoji.ts";
import { createFileTools } from "./tools/files.ts";
import { createReactionTools } from "./tools/reactions.ts";
import { createUserTools } from "./tools/users.ts";
import { createSlackWebhookHandler } from "./webhook.ts";

/** One authenticated SDK client shared by Slack tools. */
export const createSlackIntegration = defineIntegration((ctx) => {
  const token = Bun.env.SLACK_TOKEN?.trim();
  const signingSecret = Bun.env.SLACK_SIGNING_SECRET?.trim();
  if (!token || !signingSecret) {
    throw new Error("Slack requires SLACK_TOKEN and SLACK_SIGNING_SECRET.");
  }

  // Disable automatic retries: a transport failure after a write can be ambiguous.
  const client = new WebClient(token, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  });
  const messageEvents = createMessageEvents(ctx);
  const reactionEvents = createReactionEvents(client, ctx);
  const fileEvents = createFileEvents(ctx);
  const webhookUrl = ctx.webhook.register(
    createSlackWebhookHandler({ signingSecret }, createSlackEventReceiver(client, ctx)),
  );

  return {
    name: "slack",
    webhookUrl,
    events: [...Object.values(messageEvents), ...Object.values(reactionEvents), ...Object.values(fileEvents)],
    resources: [
      defineResource({ name: "conversations", tools: Object.values(createConversationTools(client, ctx)) }),
      defineResource({ name: "chat", tools: Object.values(createChatTools(client, ctx)) }),
      defineResource({ name: "bookmarks", tools: Object.values(createBookmarkTools(client, ctx)) }),
      defineResource({ name: "emoji", tools: Object.values(createEmojiTools(client, ctx)) }),
      defineResource({ name: "reactions", tools: Object.values(createReactionTools(client, ctx)) }),
      defineResource({ name: "users", tools: Object.values(createUserTools(client, ctx)) }),
      defineResource({ name: "assistant", tools: Object.values(createAssistantTools(client, ctx)) }),
      defineResource({ name: "files", tools: Object.values(createFileTools(client, ctx)) }),
      defineResource({ name: "canvases", tools: Object.values(createCanvasTools(client, ctx)) }),
    ],
  };
});

export default createSlackIntegration;
