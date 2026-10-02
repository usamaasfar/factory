import { verify } from "@octokit/webhooks-methods";
import type {
  InstallationCreatedEvent,
  InstallationEvent,
  InstallationRepositoriesAddedEvent,
  InstallationRepositoriesEvent,
  IssueCommentCreatedEvent,
  IssueCommentEditedEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestOpenedEvent,
  PullRequestReadyForReviewEvent,
  PullRequestReopenedEvent,
  PullRequestReviewCommentCreatedEvent,
  PullRequestReviewCommentEditedEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEditedEvent,
  PullRequestReviewEvent,
  PullRequestReviewSubmittedEvent,
  PullRequestSynchronizeEvent,
  PushEvent,
} from "@octokit/webhooks-types";

type GitHubWebhook<TName extends string, TPayload> = {
  deliveryId: string;
  name: TName;
  payload: TPayload;
};

type GitHubWorkflowWebhook<TName extends string, TPayload> = GitHubWebhook<TName, TPayload> & {
  prompt: string;
};

export type GitHubPush = GitHubWebhook<"push", PushEvent>;
export type GitHubInstallationCreated = GitHubWebhook<"installation.created", InstallationCreatedEvent>;
export type GitHubInstallationRepositoriesAdded = GitHubWebhook<
  "installation_repositories.added",
  InstallationRepositoriesAddedEvent
>;

export type GitHubPullRequestOpened = GitHubWorkflowWebhook<"pull_request.opened", PullRequestOpenedEvent>;
export type GitHubPullRequestReopened = GitHubWorkflowWebhook<"pull_request.reopened", PullRequestReopenedEvent>;
export type GitHubPullRequestSynchronize = GitHubWorkflowWebhook<
  "pull_request.synchronize",
  PullRequestSynchronizeEvent
>;
export type GitHubPullRequestReadyForReview = GitHubWorkflowWebhook<
  "pull_request.ready_for_review",
  PullRequestReadyForReviewEvent
>;
export type GitHubIssueCommentCreated = GitHubWorkflowWebhook<"issue_comment.created", IssueCommentCreatedEvent>;
export type GitHubIssueCommentEdited = GitHubWorkflowWebhook<"issue_comment.edited", IssueCommentEditedEvent>;
export type GitHubPullRequestReviewSubmitted = GitHubWorkflowWebhook<
  "pull_request_review.submitted",
  PullRequestReviewSubmittedEvent
>;
export type GitHubPullRequestReviewEdited = GitHubWorkflowWebhook<
  "pull_request_review.edited",
  PullRequestReviewEditedEvent
>;
export type GitHubPullRequestReviewCommentCreated = GitHubWorkflowWebhook<
  "pull_request_review_comment.created",
  PullRequestReviewCommentCreatedEvent
>;
export type GitHubPullRequestReviewCommentEdited = GitHubWorkflowWebhook<
  "pull_request_review_comment.edited",
  PullRequestReviewCommentEditedEvent
>;

export type GitHubEvent =
  | GitHubPush
  | GitHubInstallationCreated
  | GitHubInstallationRepositoriesAdded
  | GitHubPullRequestOpened
  | GitHubPullRequestReopened
  | GitHubPullRequestSynchronize
  | GitHubPullRequestReadyForReview
  | GitHubIssueCommentCreated
  | GitHubIssueCommentEdited
  | GitHubPullRequestReviewSubmitted
  | GitHubPullRequestReviewEdited
  | GitHubPullRequestReviewCommentCreated
  | GitHubPullRequestReviewCommentEdited;

// Registration rejects triggers that this integration cannot currently deliver.
export const githubWorkflowEventNames = [
  "github.pull_request.opened",
  "github.pull_request.reopened",
  "github.pull_request.synchronize",
  "github.pull_request.ready_for_review",
  "github.issue_comment.created",
  "github.issue_comment.edited",
  "github.pull_request_review.submitted",
  "github.pull_request_review.edited",
  "github.pull_request_review_comment.created",
  "github.pull_request_review_comment.edited",
] as const;

/** Verifies and reads a supported GitHub webhook request. */
export async function receiveGitHubWebhook(request: Request, secret: string): Promise<GitHubEvent | undefined> {
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256");
  const body = await request.text();

  if (!deliveryId) throw new Error("Missing X-GitHub-Delivery header");
  if (!signature || !(await verify(secret, body, signature))) {
    throw new Error("Invalid GitHub webhook signature");
  }

  const payload: unknown = JSON.parse(body);

  switch (event) {
    case "push":
      return receivePush(deliveryId, payload as PushEvent);
    case "installation":
      return receiveInstallation(deliveryId, payload as InstallationEvent);
    case "installation_repositories":
      return receiveInstallationRepositories(deliveryId, payload as InstallationRepositoriesEvent);
    case "pull_request":
      return receivePullRequest(deliveryId, payload as PullRequestEvent);
    case "issue_comment":
      return receiveIssueComment(deliveryId, payload as IssueCommentEvent);
    case "pull_request_review":
      return receivePullRequestReview(deliveryId, payload as PullRequestReviewEvent);
    case "pull_request_review_comment":
      return receivePullRequestReviewComment(deliveryId, payload as PullRequestReviewCommentEvent);
    default:
      return undefined;
  }
}

function receivePush(deliveryId: string, payload: PushEvent): GitHubPush {
  return { deliveryId, name: "push", payload };
}

function receiveInstallation(deliveryId: string, payload: InstallationEvent): GitHubInstallationCreated | undefined {
  if (payload.action !== "created") return undefined;
  return { deliveryId, name: "installation.created", payload };
}

function receiveInstallationRepositories(
  deliveryId: string,
  payload: InstallationRepositoriesEvent,
): GitHubInstallationRepositoriesAdded | undefined {
  if (payload.action !== "added") return undefined;
  return { deliveryId, name: "installation_repositories.added", payload };
}

function receivePullRequest(deliveryId: string, payload: PullRequestEvent): GitHubEvent | undefined {
  switch (payload.action) {
    case "opened":
      return {
        deliveryId,
        name: "pull_request.opened",
        payload,
        prompt: `Pull request #${payload.number} was opened by @${payload.sender.login}: ${payload.pull_request.title}`,
      };
    case "reopened":
      return {
        deliveryId,
        name: "pull_request.reopened",
        payload,
        prompt: `Pull request #${payload.number} was reopened by @${payload.sender.login}.`,
      };
    case "synchronize":
      return {
        deliveryId,
        name: "pull_request.synchronize",
        payload,
        prompt: `New commits were pushed to pull request #${payload.number} by @${payload.sender.login}. The head changed from ${payload.before} to ${payload.after}.`,
      };
    case "ready_for_review":
      return {
        deliveryId,
        name: "pull_request.ready_for_review",
        payload,
        prompt: `Pull request #${payload.number} was marked ready for review by @${payload.sender.login}.`,
      };
    default:
      return undefined;
  }
}

function receiveIssueComment(deliveryId: string, payload: IssueCommentEvent): GitHubEvent | undefined {
  if (!payload.issue.pull_request) return undefined;

  switch (payload.action) {
    case "created":
      return {
        deliveryId,
        name: "issue_comment.created",
        payload,
        prompt: `@${payload.sender.login} commented on pull request #${payload.issue.number}:\n\n${payload.comment.body}`,
      };
    case "edited":
      return {
        deliveryId,
        name: "issue_comment.edited",
        payload,
        prompt: `@${payload.sender.login} edited a comment on pull request #${payload.issue.number}:\n\n${payload.comment.body}`,
      };
    default:
      return undefined;
  }
}

function receivePullRequestReview(deliveryId: string, payload: PullRequestReviewEvent): GitHubEvent | undefined {
  switch (payload.action) {
    case "submitted":
      return {
        deliveryId,
        name: "pull_request_review.submitted",
        payload,
        prompt: withBody(
          `@${payload.sender.login} submitted a ${payload.review.state} review on pull request #${payload.pull_request.number}.`,
          payload.review.body,
        ),
      };
    case "edited":
      return {
        deliveryId,
        name: "pull_request_review.edited",
        payload,
        prompt: withBody(
          `@${payload.sender.login} edited a review on pull request #${payload.pull_request.number}.`,
          payload.review.body,
        ),
      };
    default:
      return undefined;
  }
}

function receivePullRequestReviewComment(
  deliveryId: string,
  payload: PullRequestReviewCommentEvent,
): GitHubEvent | undefined {
  const line = payload.comment.line ?? payload.comment.original_line;
  const location = `${payload.comment.path}${line == null ? "" : `:${line}`}`;

  switch (payload.action) {
    case "created":
      return {
        deliveryId,
        name: "pull_request_review_comment.created",
        payload,
        prompt: `@${payload.sender.login} commented on ${location} in pull request #${payload.pull_request.number}:\n\n${payload.comment.body}`,
      };
    case "edited":
      return {
        deliveryId,
        name: "pull_request_review_comment.edited",
        payload,
        prompt: `@${payload.sender.login} edited a comment on ${location} in pull request #${payload.pull_request.number}:\n\n${payload.comment.body}`,
      };
    default:
      return undefined;
  }
}

function withBody(message: string, body: string | null) {
  return body ? `${message}\n\n${body}` : message;
}
