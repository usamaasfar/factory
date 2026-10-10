import type {
  PullRequestAssignedEvent,
  PullRequestAutoMergeDisabledEvent,
  PullRequestAutoMergeEnabledEvent,
  PullRequestClosedEvent,
  PullRequestConvertedToDraftEvent,
  PullRequestDemilestonedEvent,
  PullRequestDequeuedEvent,
  PullRequestEditedEvent,
  PullRequestEnqueuedEvent,
  PullRequestLabeledEvent,
  PullRequestLockedEvent,
  PullRequestMilestonedEvent,
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReopenedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewCommentDeletedEvent,
  PullRequestReviewCommentEditedEvent,
  PullRequestReviewDismissedEvent,
  PullRequestReviewEditedEvent,
  PullRequestReviewRequestedEvent,
  PullRequestReviewRequestRemovedEvent,
  PullRequestReviewSubmittedEvent,
  PullRequestReviewThreadResolvedEvent,
  PullRequestReviewThreadUnresolvedEvent,
  PullRequestSynchronizeEvent,
  PullRequestUnassignedEvent,
  PullRequestUnlabeledEvent,
  PullRequestUnlockedEvent,
} from "@octokit/webhooks-types";
import { defineEvent, type IntegrationContext } from "factory-oss/integration";

// Experimental subjects retain resource identity; Factory will own parent routing.

export function createPullRequestEvents(_ctx: IntegrationContext) {
  return {
    opened: defineEvent<PullRequestOpenedEvent>({
      name: "pull_request.opened",
      description: "A pull request opened event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} opened PR #${payload.number} in ${payload.repository.full_name}: ${payload.pull_request.title}`,
        };
      },
    }),
    reopened: defineEvent<PullRequestReopenedEvent>({
      name: "pull_request.reopened",
      description: "A pull request reopened event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} reopened PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    synchronize: defineEvent<PullRequestSynchronizeEvent>({
      name: "pull_request.synchronize",
      description: "A pull request synchronize event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} pushed new commits to PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    readyForReview: defineEvent<PullRequestReadyForReviewEvent>({
      name: "pull_request.ready_for_review",
      description: "A pull request ready for review event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} marked PR #${payload.number} in ${payload.repository.full_name} ready for review.`,
        };
      },
    }),
    closed: defineEvent<PullRequestClosedEvent>({
      name: "pull_request.closed",
      description: "A pull request closed event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} ${payload.pull_request.merged ? "merged" : "closed"} PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    edited: defineEvent<PullRequestEditedEvent>({
      name: "pull_request.edited",
      description: "A pull request edited event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} edited PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    convertedToDraft: defineEvent<PullRequestConvertedToDraftEvent>({
      name: "pull_request.converted_to_draft",
      description: "A pull request converted to draft event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} converted PR #${payload.number} in ${payload.repository.full_name} to draft.`,
        };
      },
    }),
    assigned: defineEvent<PullRequestAssignedEvent>({
      name: "pull_request.assigned",
      description: "A pull request assigned event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} assigned @${payload.assignee.login} to PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    unassigned: defineEvent<PullRequestUnassignedEvent>({
      name: "pull_request.unassigned",
      description: "A pull request unassigned event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} unassigned @${payload.assignee.login} from PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    labeled: defineEvent<PullRequestLabeledEvent>({
      name: "pull_request.labeled",
      description: "A pull request labeled event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} added label ${payload.label.name} to PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    unlabeled: defineEvent<PullRequestUnlabeledEvent>({
      name: "pull_request.unlabeled",
      description: "A pull request unlabeled event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} removed label ${payload.label.name} from PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    milestoned: defineEvent<PullRequestMilestonedEvent>({
      name: "pull_request.milestoned",
      description: "A pull request milestoned event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} added milestone ${payload.milestone.title} to PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    demilestoned: defineEvent<PullRequestDemilestonedEvent>({
      name: "pull_request.demilestoned",
      description: "A pull request demilestoned event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} removed milestone ${payload.milestone.title} from PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    locked: defineEvent<PullRequestLockedEvent>({
      name: "pull_request.locked",
      description: "A pull request locked event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} locked PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    unlocked: defineEvent<PullRequestUnlockedEvent>({
      name: "pull_request.unlocked",
      description: "A pull request unlocked event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} unlocked PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    reviewRequested: defineEvent<PullRequestReviewRequestedEvent>({
      name: "pull_request.review_requested",
      description: "A pull request review requested event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} requested a review for PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    reviewRequestRemoved: defineEvent<PullRequestReviewRequestRemovedEvent>({
      name: "pull_request.review_request_removed",
      description: "A pull request review request removed event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} removed a review request for PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    autoMergeEnabled: defineEvent<PullRequestAutoMergeEnabledEvent>({
      name: "pull_request.auto_merge_enabled",
      description: "A pull request auto merge enabled event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} enabled auto-merge for PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    autoMergeDisabled: defineEvent<PullRequestAutoMergeDisabledEvent>({
      name: "pull_request.auto_merge_disabled",
      description: "A pull request auto merge disabled event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} disabled auto-merge for PR #${payload.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    enqueued: defineEvent<PullRequestEnqueuedEvent>({
      name: "pull_request.enqueued",
      description: "A pull request enqueued event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} added PR #${payload.number} in ${payload.repository.full_name} to the merge queue.`,
        };
      },
    }),
    dequeued: defineEvent<PullRequestDequeuedEvent>({
      name: "pull_request.dequeued",
      description: "A pull request dequeued event.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.number}`,
          content: `@${payload.sender.login} removed PR #${payload.number} in ${payload.repository.full_name} from the merge queue.`,
        };
      },
    }),
    reviewSubmitted: defineEvent<PullRequestReviewSubmittedEvent>({
      name: "pull_request_review.submitted",
      description: "A pull request review was submitted.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review:${payload.review.id}`,
          content: `@${payload.sender.login} submitted a ${payload.review.state} review on PR #${payload.pull_request.number} in ${payload.repository.full_name}${payload.review.body ? `: ${payload.review.body}` : "."}`,
        };
      },
    }),
    reviewEdited: defineEvent<PullRequestReviewEditedEvent>({
      name: "pull_request_review.edited",
      description: "A pull request review was edited.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review:${payload.review.id}`,
          content: `@${payload.sender.login} edited a ${payload.review.state} review on PR #${payload.pull_request.number} in ${payload.repository.full_name}${payload.review.body ? `: ${payload.review.body}` : "."}`,
        };
      },
    }),
    reviewDismissed: defineEvent<PullRequestReviewDismissedEvent>({
      name: "pull_request_review.dismissed",
      description: "A pull request review was dismissed.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review:${payload.review.id}`,
          content: `@${payload.sender.login} dismissed a ${payload.review.state} review on PR #${payload.pull_request.number} in ${payload.repository.full_name}${payload.review.body ? `: ${payload.review.body}` : "."}`,
        };
      },
    }),
    reviewCommentCreated: defineEvent<PullRequestReviewCommentCreatedEvent>({
      name: "pull_request_review_comment.created",
      description: "A pull request comment was created.",
      execute({ payload }) {
        const parentCommentId = payload.comment.in_reply_to_id ?? payload.comment.id;
        const reply = payload.comment.in_reply_to_id ? `:reply:${payload.comment.id}` : "";
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review_comment:${parentCommentId}${reply}`,
          content: `@${payload.sender.login} created a review comment on ${payload.comment.path} in PR #${payload.pull_request.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
    reviewCommentEdited: defineEvent<PullRequestReviewCommentEditedEvent>({
      name: "pull_request_review_comment.edited",
      description: "A pull request comment was edited.",
      execute({ payload }) {
        const parentCommentId = payload.comment.in_reply_to_id ?? payload.comment.id;
        const reply = payload.comment.in_reply_to_id ? `:reply:${payload.comment.id}` : "";
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review_comment:${parentCommentId}${reply}`,
          content: `@${payload.sender.login} edited a review comment on ${payload.comment.path} in PR #${payload.pull_request.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
    reviewCommentDeleted: defineEvent<PullRequestReviewCommentDeletedEvent>({
      name: "pull_request_review_comment.deleted",
      description: "A pull request comment was deleted.",
      execute({ payload }) {
        const parentCommentId = payload.comment.in_reply_to_id ?? payload.comment.id;
        const reply = payload.comment.in_reply_to_id ? `:reply:${payload.comment.id}` : "";
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review_comment:${parentCommentId}${reply}`,
          content: `@${payload.sender.login} deleted a review comment on ${payload.comment.path} in PR #${payload.pull_request.number} in ${payload.repository.full_name}: ${payload.comment.body}`,
        };
      },
    }),
    reviewThreadResolved: defineEvent<PullRequestReviewThreadResolvedEvent>({
      name: "pull_request_review_thread.resolved",
      description: "A pull request thread was resolved.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review_thread:${payload.thread.node_id}`,
          content: `@${payload.sender.login} resolved a review thread in PR #${payload.pull_request.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
    reviewThreadUnresolved: defineEvent<PullRequestReviewThreadUnresolvedEvent>({
      name: "pull_request_review_thread.unresolved",
      description: "A pull request thread was unresolved.",
      execute({ payload }) {
        return {
          subject: `repository:${payload.repository.id}:pull_request:${payload.pull_request.number}:review_thread:${payload.thread.node_id}`,
          content: `@${payload.sender.login} unresolved a review thread in PR #${payload.pull_request.number} in ${payload.repository.full_name}.`,
        };
      },
    }),
  };
}
