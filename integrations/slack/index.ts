import { WebClient } from "@slack/web-api";
import { defineIntegration } from "factory-oss/integration";
import { createMessageEvents } from "./events/message.ts";
import { createReplyTool } from "./tools/chat.ts";
import { createReadTool } from "./tools/conversations.ts";
import { createSlackWebhookHandler } from "./webhook.ts";

export type SlackOptions = {
  token: string;
  signingSecret: string;
  teamId: string;
};

/** One authenticated SDK client shared by Slack tools. */
export const createSlackIntegration = defineIntegration((options: SlackOptions, ctx) => {
  // Disable automatic retries: a transport failure after a write can be ambiguous.
  const client = new WebClient(options.token, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  });
  const messageEvents = createMessageEvents(ctx);
  const webhookUrl = ctx.webhook.register(
    createSlackWebhookHandler({ signingSecret: options.signingSecret, teamId: options.teamId }, ctx),
  );

  return {
    webhookUrl,
    events: Object.values(messageEvents),
    tools: [createReadTool(client, ctx), createReplyTool(client, ctx)],
  };
});

export default createSlackIntegration;
