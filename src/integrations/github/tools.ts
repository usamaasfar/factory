import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "./app.ts";

export type GitHubPullRequestScope = {
  client: GitHubClient;
  owner: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
};

export function createGitHubTools(scope: GitHubPullRequestScope) {
  const createReview = defineTool({
    name: "github_create_review",
    description: "Publish a review on the current GitHub pull request.",
    parameters: Type.Object({
      body: Type.String({ description: "Review summary" }),
      event: Type.Union([Type.Literal("COMMENT"), Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES")]),
    }),
    replay: "unsafe",
    execute: async ({ body, event }) => {
      const review = await scope.client.request<{ id: number; html_url: string; state: string }>(
        "POST",
        `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repository)}/pulls/${scope.pullRequestNumber}/reviews`,
        { body, event, commit_id: scope.headSha },
      );
      return {
        content: [{ type: "text", text: `Published GitHub review ${review.html_url}` }],
        details: { id: review.id, url: review.html_url, state: review.state },
      };
    },
  });

  const replyToReviewComment = defineTool({
    name: "github_reply_to_review_comment",
    description: "Reply to a top-level review comment on the current GitHub pull request.",
    parameters: Type.Object({
      commentId: Type.Number({ description: "Top-level review comment ID" }),
      body: Type.String({ description: "Reply text" }),
    }),
    replay: "unsafe",
    execute: async ({ commentId, body }) => {
      const comment = await scope.client.request<{ id: number; html_url: string }>(
        "POST",
        `/repos/${encodeURIComponent(scope.owner)}/${encodeURIComponent(scope.repository)}/pulls/${scope.pullRequestNumber}/comments/${commentId}/replies`,
        { body },
      );
      return {
        content: [{ type: "text", text: `Published GitHub reply ${comment.html_url}` }],
        details: { id: comment.id, url: comment.html_url },
      };
    },
  });

  return defineExtension({ name: "github", tools: [createReview, replyToReviewComment] });
}
