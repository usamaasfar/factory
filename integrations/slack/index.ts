import { WebClient } from "@slack/web-api";
import { defineIntegration, defineResource } from "factory-oss/integration";
import { createMessageEvents } from "./events/message.ts";
import { createReactionEvents } from "./events/reactions.ts";
import { createBookmarkTools } from "./tools/bookmarks.ts";
import { createReplyTool } from "./tools/chat.ts";
import { createReadTool } from "./tools/conversations.ts";
import { createEmojiTools } from "./tools/emoji.ts";
import { createReactionTools } from "./tools/reactions.ts";
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
  const webhookUrl = ctx.webhook.register(
    createSlackWebhookHandler({ signingSecret }, async (delivery) => {
      let name = delivery.name;
      // Slack delivers public and private channel subscriptions as "message".
      if (name === "message") {
        const channelType = delivery.payload.event.channel_type;
        if (channelType === "channel") name = "message.channels";
        else if (channelType === "group") name = "message.groups";
        else return false;
      }
      return ctx.events.receive({ ...delivery, name });
    }),
  );

  return {
    name: "slack",
    webhookUrl,
    events: [...Object.values(messageEvents), ...Object.values(reactionEvents)],
    resources: [
      defineResource({ name: "conversations", tools: [createReadTool(client, ctx)] }),
      defineResource({ name: "chat", tools: [createReplyTool(client, ctx)] }),
      defineResource({ name: "bookmarks", tools: Object.values(createBookmarkTools(client, ctx)) }),
      defineResource({ name: "emoji", tools: Object.values(createEmojiTools(client, ctx)) }),
      defineResource({ name: "reactions", tools: Object.values(createReactionTools(client, ctx)) }),
    ],
  };
});

export default createSlackIntegration;
