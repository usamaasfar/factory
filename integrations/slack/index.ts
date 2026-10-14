import { WebClient } from "@slack/web-api";
import { defineIntegration, defineResource } from "factory-oss/integration";
import { createMessageEvents } from "./events/message.ts";
import { createBookmarkTools } from "./tools/bookmarks.ts";
import { createReplyTool } from "./tools/chat.ts";
import { createReadTool } from "./tools/conversations.ts";
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
  const webhookUrl = ctx.webhook.register(createSlackWebhookHandler({ signingSecret }, ctx));

  return {
    name: "slack",
    webhookUrl,
    events: Object.values(messageEvents),
    resources: [
      defineResource({ name: "conversations", tools: [createReadTool(client, ctx)] }),
      defineResource({ name: "chat", tools: [createReplyTool(client, ctx)] }),
      defineResource({ name: "bookmarks", tools: Object.values(createBookmarkTools(client, ctx)) }),
    ],
  };
});

export default createSlackIntegration;
