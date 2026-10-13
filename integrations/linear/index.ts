import { LinearClient } from "@linear/sdk";
import { defineIntegration, defineResource } from "factory-oss/integration";
import { createIssueEvents } from "./events/issue.ts";
import { createCommentTools } from "./tools/comment.ts";
import { createIssueTools } from "./tools/issue.ts";
import { createLinearWebhookHandler } from "./webhook.ts";

/** One authenticated SDK client shared by Linear tools. */
export const createLinearIntegration = defineIntegration((ctx) => {
  const apiKey = Bun.env.LINEAR_API_KEY?.trim();
  const webhookSecret = Bun.env.LINEAR_WEBHOOK_SECRET?.trim();
  const organizationId = Bun.env.LINEAR_ORGANIZATION_ID?.trim();
  if (!apiKey || !webhookSecret || !organizationId) {
    throw new Error("Linear requires LINEAR_API_KEY, LINEAR_WEBHOOK_SECRET, and LINEAR_ORGANIZATION_ID.");
  }

  const client = new LinearClient({ apiKey: apiKey });
  const issueTools = createIssueTools(client, ctx);
  const commentTools = createCommentTools(client, ctx);
  const issueEvents = createIssueEvents(ctx);
  const webhookUrl = ctx.webhook.register(
    createLinearWebhookHandler({ secret: webhookSecret, organizationId: organizationId }, ctx),
  );

  return {
    name: "linear",
    webhookUrl,
    events: Object.values(issueEvents),
    resources: [
      defineResource({ name: "issues", tools: Object.values(issueTools) }),
      defineResource({ name: "comments", tools: Object.values(commentTools) }),
    ],
  };
});

export default createLinearIntegration;
