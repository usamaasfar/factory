import type { EntityWebhookPayloadWithCommentData, EntityWebhookPayloadWithIssueData } from "@linear/sdk/webhooks";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

type LinearActor = EntityWebhookPayloadWithIssueData["actor"];

function actorName(actor: LinearActor): string {
  if (!actor) return "Linear";
  return "name" in actor ? actor.name : actor.service;
}

export function createIssueEvents(_ctx: IntegrationContext) {
  return {
    created: defineEvent<EntityWebhookPayloadWithIssueData>({
      name: "issue.created",
      description: "A Linear issue was created.",
      execute({ payload }) {
        return {
          subject: `organization:${payload.organizationId}:issue:${payload.data.id}`,
          content: `${actorName(payload.actor)} created ${payload.data.identifier}: ${payload.data.title}`,
        };
      },
    }),

    updated: defineEvent<EntityWebhookPayloadWithIssueData>({
      name: "issue.updated",
      description: "A Linear issue was updated.",
      execute({ payload }) {
        const changedFields = Object.keys(payload.updatedFrom ?? {}).join(", ") || "issue details";
        return {
          subject: `organization:${payload.organizationId}:issue:${payload.data.id}`,
          content: `${actorName(payload.actor)} updated ${payload.data.identifier} (${changedFields}): ${payload.data.title}`,
        };
      },
    }),

    commentCreated: defineEvent<EntityWebhookPayloadWithCommentData>({
      name: "comment.created",
      description: "A comment was added to a Linear issue.",
      execute({ payload }) {
        const { data } = payload;
        if (!data.issueId) return undefined;

        const issue = data.issue?.identifier ?? data.issueId;
        return {
          subject: `organization:${payload.organizationId}:issue:${data.issueId}`,
          content: `${actorName(payload.actor)} commented on ${issue}: ${data.body}`,
        };
      },
    }),
  };
}
