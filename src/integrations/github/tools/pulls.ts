import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const pullRequest = Type.Number({ description: "Pull request number." });
const review = Type.Number({ description: "Pull request review ID." });

export function createPullTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_check_pull_request_merged",
      description: "Check whether a GitHub pull request has been merged.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }) => {
        const response = await github.rest.pulls.checkIfMerged({
          owner,
          repo: repository,
          pull_number: pullRequest,
        });
        return text(
          response.status === 204 ? "The pull request has been merged." : "The pull request has not been merged.",
        );
      },
    }),
    defineTool({
      name: "github_create_pull_request",
      description: "Create a GitHub pull request.",
      parameters: Type.Object({
        owner,
        repository,
        title: Type.String({ description: "Pull request title." }),
        head: Type.String({ description: "Branch containing the changes." }),
        base: Type.String({ description: "Branch to merge into." }),
        body: Type.Optional(Type.String({ description: "Pull request body in GitHub-flavored Markdown." })),
        draft: Type.Optional(Type.Boolean({ description: "Create the pull request as a draft." })),
        maintainerCanModify: Type.Optional(
          Type.Boolean({ description: "Allow maintainers to modify the pull request branch." }),
        ),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, title, head, base, body, draft, maintainerCanModify }) => {
        const response = await github.rest.pulls.create({
          owner,
          repo: repository,
          title,
          head,
          base,
          body,
          draft,
          maintainer_can_modify: maintainerCanModify,
        });
        return link("Created GitHub pull request", response.data.number, response.data.html_url);
      },
    }),
    defineTool({
      name: "github_reply_to_review_comment",
      description: "Reply to a top-level review comment on a GitHub pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        comment: Type.Number({ description: "Top-level review comment ID." }),
        body: Type.String({ description: "Reply in GitHub-flavored Markdown." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, comment, body }) => {
        const response = await github.rest.pulls.createReplyForReviewComment({
          owner,
          repo: repository,
          pull_number: pullRequest,
          comment_id: comment,
          body,
        });
        return link("Created GitHub review reply", response.data.id, response.data.html_url);
      },
    }),
    defineTool({
      name: "github_create_review",
      description: "Create a GitHub pull request review, optionally with inline comments.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        commit: Type.Optional(Type.String({ description: "Pull request head commit SHA." })),
        body: Type.Optional(Type.String({ description: "Review summary in GitHub-flavored Markdown." })),
        event: Type.Optional(
          Type.Union([Type.Literal("COMMENT"), Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES")]),
        ),
        comments: Type.Optional(
          Type.Array(
            Type.Object({
              path: Type.String({ description: "Repository-relative file path." }),
              line: Type.Number({ description: "Line number in the pull request diff." }),
              side: Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")]),
              body: Type.String({ description: "Inline comment in GitHub-flavored Markdown." }),
            }),
          ),
        ),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, commit, body, event, comments }) => {
        const response = await github.rest.pulls.createReview({
          owner,
          repo: repository,
          pull_number: pullRequest,
          commit_id: commit,
          body,
          event,
          comments,
        });
        return link("Created GitHub review", response.data.id, response.data.html_url);
      },
    }),
    defineTool({
      name: "github_create_review_comment",
      description: "Create an inline comment on a GitHub pull request diff.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        body: Type.String({ description: "Comment in GitHub-flavored Markdown." }),
        commit: Type.String({ description: "Commit SHA to comment on." }),
        path: Type.String({ description: "Repository-relative file path." }),
        line: Type.Optional(Type.Number({ description: "Last line covered by the comment." })),
        side: Type.Optional(Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")])),
        startLine: Type.Optional(Type.Number({ description: "First line of a multi-line comment." })),
        startSide: Type.Optional(Type.Union([Type.Literal("LEFT"), Type.Literal("RIGHT")])),
        subjectType: Type.Optional(Type.Union([Type.Literal("line"), Type.Literal("file")])),
      }),
      replay: "unsafe",
      execute: async ({
        owner,
        repository,
        pullRequest,
        body,
        commit,
        path,
        line,
        side,
        startLine,
        startSide,
        subjectType,
      }) => {
        const response = await github.rest.pulls.createReviewComment({
          owner,
          repo: repository,
          pull_number: pullRequest,
          body,
          commit_id: commit,
          path,
          line,
          side,
          start_line: startLine,
          start_side: startSide,
          subject_type: subjectType,
        });
        return link("Created GitHub review comment", response.data.id, response.data.html_url);
      },
    }),
    defineTool({
      name: "github_delete_pending_review",
      description: "Delete a pending GitHub pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, review }) => {
        await github.rest.pulls.deletePendingReview({
          owner,
          repo: repository,
          pull_number: pullRequest,
          review_id: review,
        });
        return text(`Deleted pending review ${review}.`);
      },
    }),
    defineTool({
      name: "github_delete_review_comment",
      description: "Delete a GitHub pull request review comment.",
      parameters: Type.Object({ owner, repository, comment: Type.Number({ description: "Review comment ID." }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment }) => {
        await github.rest.pulls.deleteReviewComment({ owner, repo: repository, comment_id: comment });
        return text(`Deleted review comment ${comment}.`);
      },
    }),
    defineTool({
      name: "github_get_pull_request",
      description: "Get a GitHub pull request.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }) =>
        output(await github.rest.pulls.get({ owner, repo: repository, pull_number: pullRequest })),
    }),
    defineTool({
      name: "github_list_pull_requests",
      description: "List pull requests in a repository.",
      parameters: Type.Object({
        owner,
        repository,
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
        head: Type.Optional(Type.String()),
        base: Type.Optional(Type.String()),
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, state, head, base, page, perPage }) =>
        output(await github.rest.pulls.list({ owner, repo: repository, state, head, base, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_update_pull_request",
      description: "Update a GitHub pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed")])),
        base: Type.Optional(Type.String()),
        maintainerCanModify: Type.Optional(Type.Boolean()),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, title, body, state, base, maintainerCanModify }) =>
        output(
          await github.rest.pulls.update({
            owner,
            repo: repository,
            pull_number: pullRequest,
            title,
            body,
            state,
            base,
            maintainer_can_modify: maintainerCanModify,
          }),
        ),
    }),
    defineTool({
      name: "github_list_pull_request_commits",
      description: "List commits on a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, page, perPage }) =>
        output(
          await github.rest.pulls.listCommits({
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_pull_request_files",
      description: "List files changed by a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, page, perPage }) =>
        output(
          await github.rest.pulls.listFiles({
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_get_pull_request_review",
      description: "Get a pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, review }) =>
        output(
          await github.rest.pulls.getReview({ owner, repo: repository, pull_number: pullRequest, review_id: review }),
        ),
    }),
    defineTool({
      name: "github_list_pull_request_reviews",
      description: "List reviews on a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, page, perPage }) =>
        output(
          await github.rest.pulls.listReviews({
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_submit_pull_request_review",
      description: "Submit a pending pull request review.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        review,
        body: Type.Optional(Type.String()),
        event: Type.Union([Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES"), Type.Literal("COMMENT")]),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, review, body, event }) =>
        output(
          await github.rest.pulls.submitReview({
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            body,
            event,
          }),
        ),
    }),
    defineTool({
      name: "github_update_pull_request_review",
      description: "Update the summary of a pending pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review, body: Type.String() }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, review, body }) =>
        output(
          await github.rest.pulls.updateReview({
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            body,
          }),
        ),
    }),
    defineTool({
      name: "github_get_review_comment",
      description: "Get a pull request review comment.",
      parameters: Type.Object({ owner, repository, comment: Type.Number({ description: "Review comment ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, comment }) =>
        output(await github.rest.pulls.getReviewComment({ owner, repo: repository, comment_id: comment })),
    }),
    defineTool({
      name: "github_list_review_comments",
      description: "List review comments on a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, page, perPage }) =>
        output(
          await github.rest.pulls.listReviewComments({
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_list_review_comments_for_review",
      description: "List comments belonging to a pull request review.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        review,
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number()),
      }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, review, page, perPage }) =>
        output(
          await github.rest.pulls.listCommentsForReview({
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            page,
            per_page: perPage,
          }),
        ),
    }),
    defineTool({
      name: "github_update_review_comment",
      description: "Update a pull request review comment.",
      parameters: Type.Object({
        owner,
        repository,
        comment: Type.Number({ description: "Review comment ID." }),
        body: Type.String(),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment, body }) =>
        output(await github.rest.pulls.updateReviewComment({ owner, repo: repository, comment_id: comment, body })),
    }),
    defineTool({
      name: "github_list_requested_reviewers",
      description: "List requested reviewers for a pull request.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }) =>
        output(await github.rest.pulls.listRequestedReviewers({ owner, repo: repository, pull_number: pullRequest })),
    }),
    defineTool({
      name: "github_request_reviewers",
      description: "Request users or teams to review a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        reviewers: Type.Optional(Type.Array(Type.String())),
        teamReviewers: Type.Optional(Type.Array(Type.String())),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, reviewers, teamReviewers }) =>
        output(
          await github.rest.pulls.requestReviewers({
            owner,
            repo: repository,
            pull_number: pullRequest,
            reviewers,
            team_reviewers: teamReviewers,
          }),
        ),
    }),
    defineTool({
      name: "github_remove_requested_reviewers",
      description: "Remove requested users or teams from a pull request.",
      parameters: Type.Object({
        owner,
        repository,
        pullRequest,
        reviewers: Type.Array(Type.String()),
        teamReviewers: Type.Optional(Type.Array(Type.String())),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, reviewers, teamReviewers }) =>
        output(
          await github.rest.pulls.removeRequestedReviewers({
            owner,
            repo: repository,
            pull_number: pullRequest,
            reviewers,
            team_reviewers: teamReviewers,
          }),
        ),
    }),
  ];
}

function output(response: { data: unknown }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function link(action: string, id: number | bigint, url: string) {
  return {
    content: [{ type: "text" as const, text: `${action}: ${url}` }],
    details: { id: id.toString(), url },
  };
}
