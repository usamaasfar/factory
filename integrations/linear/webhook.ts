import {
  type EntityWebhookPayloadWithCommentData,
  type EntityWebhookPayloadWithIssueData,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LinearWebhookClient,
  type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { IntegrationContext, WebhookHandler } from "factory-oss/integration";

export type LinearWebhookOptions = {
  secret: string;
  organizationId: string;
};

/** Verify and decode Linear webhook deliveries. */
export function createLinearWebhookHandler(options: LinearWebhookOptions, ctx: IntegrationContext): WebhookHandler {
  if (!options.secret.trim()) throw new Error("Linear webhook secret must not be empty.");
  if (!options.organizationId.trim()) throw new Error("Linear organization ID must not be empty.");

  const webhooks = new LinearWebhookClient(options.secret);

  return async (request) => {
    const id = request.headers.get("linear-delivery");
    const event = request.headers.get("linear-event");
    const signature = request.headers.get(LINEAR_WEBHOOK_SIGNATURE_HEADER);
    if (!id?.trim() || !event?.trim()) {
      return new Response("Missing Linear delivery headers", { status: 400 });
    }
    if (!signature) return new Response("Invalid Linear signature", { status: 401 });

    const body = await request.text();
    let payload: LinearWebhookPayload;
    try {
      payload = webhooks.parseData(Buffer.from(body), signature);
    } catch {
      return new Response("Invalid Linear signature", { status: 401 });
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.organizationId !== "string" ||
      typeof payload.type !== "string"
    ) {
      return new Response("Invalid Linear payload", { status: 400 });
    }
    if (payload.organizationId !== options.organizationId) return new Response(null, { status: 204 });
    if (payload.type !== event) return new Response("Invalid Linear event", { status: 400 });

    let name: string;
    if (payload.type === "Issue" && (payload.action === "create" || payload.action === "update")) {
      const issue = payload as EntityWebhookPayloadWithIssueData;
      if (
        !issue.data ||
        typeof issue.data !== "object" ||
        Array.isArray(issue.data) ||
        typeof issue.data.id !== "string" ||
        typeof issue.data.identifier !== "string" ||
        typeof issue.data.title !== "string"
      ) {
        return new Response("Invalid Linear event", { status: 400 });
      }
      name = payload.action === "create" ? "issue.created" : "issue.updated";
    } else if (payload.type === "Comment" && payload.action === "create") {
      const comment = payload as EntityWebhookPayloadWithCommentData;
      if (
        !comment.data ||
        typeof comment.data !== "object" ||
        Array.isArray(comment.data) ||
        typeof comment.data.id !== "string" ||
        typeof comment.data.body !== "string" ||
        (comment.data.issueId !== undefined &&
          comment.data.issueId !== null &&
          typeof comment.data.issueId !== "string")
      ) {
        return new Response("Invalid Linear event", { status: 400 });
      }
      name = "comment.created";
    } else {
      return new Response(null, { status: 204 });
    }

    const accepted = await ctx.events.receive({ id, name, payload });
    return new Response(null, { status: accepted ? 200 : 204 });
  };
}
