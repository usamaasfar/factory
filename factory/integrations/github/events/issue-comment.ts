import type {
  IssueCommentCreatedEvent,
  IssueCommentDeletedEvent,
  IssueCommentEditedEvent,
} from "@octokit/webhooks-types";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

export function createIssueCommentEvents(_ctx: IntegrationContext) {
  return {
    created: defineEvent<IssueCommentCreatedEvent>({
      name: "issue_comment.created",
      description: "A comment on a pull request was created.",
      execute({ payload }) {
        // This vertical slice handles PR discussions, not ordinary issue workflows.
        if (!payload.issue.pull_request) return undefined;
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.issue.number}:comment:${payload.comment.id}`,
          content: `@${payload.sender.login} created a comment on PR #${payload.issue.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
    edited: defineEvent<IssueCommentEditedEvent>({
      name: "issue_comment.edited",
      description: "A comment on a pull request was edited.",
      execute({ payload }) {
        // This vertical slice handles PR discussions, not ordinary issue workflows.
        if (!payload.issue.pull_request) return undefined;
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.issue.number}:comment:${payload.comment.id}`,
          content: `@${payload.sender.login} edited a comment on PR #${payload.issue.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
    deleted: defineEvent<IssueCommentDeletedEvent>({
      name: "issue_comment.deleted",
      description: "A comment on a pull request was deleted.",
      execute({ payload }) {
        // This vertical slice handles PR discussions, not ordinary issue workflows.
        if (!payload.issue.pull_request) return undefined;
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.issue.number}:comment:${payload.comment.id}`,
          content: `@${payload.sender.login} deleted a comment on PR #${payload.issue.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
  };
}
