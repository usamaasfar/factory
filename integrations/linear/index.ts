import { LinearClient } from "@linear/sdk";
import { defineIntegration } from "factory-oss/integration";
import { createIssueEvents } from "./events/issue.ts";
import { createCommentTools } from "./tools/comment.ts";
import { createIssueTools } from "./tools/issue.ts";
import { createLinearWebhookHandler } from "./webhook.ts";

export type LinearOptions = {
  apiKey: string;
  webhookSecret: string;
  organizationId: string;
};

/** One authenticated SDK client shared by Linear tools. */
export const createLinearIntegration = defineIntegration((options: LinearOptions, ctx) => {
  const client = new LinearClient({ apiKey: options.apiKey });
  const issueTools = createIssueTools(client, ctx);
  const commentTools = createCommentTools(client, ctx);
  const issueEvents = createIssueEvents(ctx);
  const webhookUrl = ctx.webhook.register(
    createLinearWebhookHandler({ secret: options.webhookSecret, organizationId: options.organizationId }, ctx),
  );

  return {
    webhookUrl,
    events: Object.values(issueEvents),
    tools: [...Object.values(issueTools), ...Object.values(commentTools)],
  };
});

export default createLinearIntegration;
