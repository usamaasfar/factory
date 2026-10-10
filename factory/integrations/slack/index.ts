import { WebClient } from "@slack/web-api";
import { defineIntegration } from "factory-oss/integration";
import { createReplyTool } from "./tools/chat.ts";
import { createReadTool } from "./tools/conversations.ts";

export type SlackOptions = {
  token: string;
};

/** One authenticated SDK client shared by Slack tools. */
export const createSlackIntegration = defineIntegration((options: SlackOptions, ctx) => {
  // Disable automatic retries: a transport failure after a write can be ambiguous.
  const client = new WebClient(options.token, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
  });
  return { tools: [createReadTool(client, ctx), createReplyTool(client, ctx)] };
});

export default createSlackIntegration;
