import type { Octokit } from "@octokit/rest";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const pullRequest = Type.Number({ description: "Pull request number." });
const review = Type.Number({ description: "Pull request review ID." });

export function createPullTools(github: Octokit, _ctx: IntegrationContext) {
  return {
    createCheckPullRequestMerged: defineTool({
      name: "github_check_pull_request_merged",
      description: "Check whether a GitHub pull request has been merged.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }, _api, context) => {
        try {
          const parameters = {
            owner,
            repo: repository,
            pull_number: pullRequest,
            request: { signal: context.abortSignal },
          };
          try {
            await github.rest.pulls.checkIfMerged(parameters);
            return { content: "The pull request has been merged." };
          } catch (error) {
            if (!(error instanceof Error && "status" in error && error.status === 404)) throw error;
            // A 404 also means missing/inaccessible: verify the PR exists before returning false.
            await github.rest.pulls.get(parameters);
            return { content: "The pull request has not been merged." };
          }
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to check whether the pull request was merged: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createPullRequest: defineTool({
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
      execute: async ({ owner, repository, title, head, base, body, draft, maintainerCanModify }, _api, context) => {
        try {
          const response = await github.rest.pulls.create({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            title,
            head,
            base,
            body,
            draft,
            maintainer_can_modify: maintainerCanModify,
          });
          return { content: `Created GitHub pull request: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to create the pull request: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createReplyToReviewComment: defineTool({
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
      execute: async ({ owner, repository, pullRequest, comment, body }, _api, context) => {
        try {
          const response = await github.rest.pulls.createReplyForReviewComment({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            comment_id: comment,
            body,
          });
          return { content: `Created GitHub review reply: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to reply to the review comment: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createReview: defineTool({
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
      execute: async ({ owner, repository, pullRequest, commit, body, event, comments }, _api, context) => {
        try {
          const response = await github.rest.pulls.createReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            commit_id: commit,
            body,
            event,
            comments,
          });
          return { content: `Created GitHub review: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to create the pull request review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createReviewComment: defineTool({
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
      execute: async (
        { owner, repository, pullRequest, body, commit, path, line, side, startLine, startSide, subjectType },
        _api,
        context,
      ) => {
        try {
          const response = await github.rest.pulls.createReviewComment({
            request: { signal: context.abortSignal },
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
          return { content: `Created GitHub review comment: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to create the review comment: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createDeletePendingReview: defineTool({
      name: "github_delete_pending_review",
      description: "Delete a pending GitHub pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, review }, _api, context) => {
        try {
          await github.rest.pulls.deletePendingReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
          });
          return { content: `Deleted pending review ${review}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to delete the pending review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createDeleteReviewComment: defineTool({
      name: "github_delete_review_comment",
      description: "Delete a GitHub pull request review comment.",
      parameters: Type.Object({ owner, repository, comment: Type.Number({ description: "Review comment ID." }) }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment }, _api, context) => {
        try {
          await github.rest.pulls.deleteReviewComment({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            comment_id: comment,
          });
          return { content: `Deleted review comment ${comment}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to delete the review comment: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createGetPullRequest: defineTool({
      name: "github_get_pull_request",
      description: "Get a GitHub pull request.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.get({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
          });
          return { content: `Read PR #${data.number} in ${owner}/${repository}: ${data.title} (${data.state}).` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to read the pull request: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListPullRequests: defineTool({
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
      execute: async ({ owner, repository, state, head, base, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.list({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            state,
            head,
            base,
            page,
            per_page: perPage,
          });
          return {
            content: `Found ${data.length} pull requests in ${owner}/${repository}: ${data.map((pull) => `#${pull.number} ${pull.title}`).join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list pull requests: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createUpdatePullRequest: defineTool({
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
      execute: async (
        { owner, repository, pullRequest, title, body, state, base, maintainerCanModify },
        _api,
        context,
      ) => {
        try {
          const response = await github.rest.pulls.update({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            title,
            body,
            state,
            base,
            maintainer_can_modify: maintainerCanModify,
          });
          return { content: `Updated GitHub pull request: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to update the pull request: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListPullRequestCommits: defineTool({
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
      execute: async ({ owner, repository, pullRequest, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listCommits({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          });
          return {
            content: `Found ${data.length} commits on PR #${pullRequest} in ${owner}/${repository}: ${data.map((commit) => commit.sha.slice(0, 7)).join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list pull request commits: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListPullRequestFiles: defineTool({
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
      execute: async ({ owner, repository, pullRequest, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listFiles({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          });
          return {
            content: `Found ${data.length} changed files on PR #${pullRequest} in ${owner}/${repository}: ${data.map((file) => file.filename).join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list changed files: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createGetPullRequestReview: defineTool({
      name: "github_get_pull_request_review",
      description: "Get a pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest, review }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.getReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
          });
          return { content: `Read review ${data.id} on PR #${pullRequest} in ${owner}/${repository}: ${data.state}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to read the pull request review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListPullRequestReviews: defineTool({
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
      execute: async ({ owner, repository, pullRequest, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listReviews({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          });
          return {
            content: `Found ${data.length} reviews on PR #${pullRequest} in ${owner}/${repository}: ${data.map((review) => `${review.id} ${review.state}`).join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list pull request reviews: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createSubmitPullRequestReview: defineTool({
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
      execute: async ({ owner, repository, pullRequest, review, body, event }, _api, context) => {
        try {
          const response = await github.rest.pulls.submitReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            body,
            event,
          });
          return { content: `Submitted GitHub pull request review: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to submit the pull request review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createUpdatePullRequestReview: defineTool({
      name: "github_update_pull_request_review",
      description: "Update the summary of a pending pull request review.",
      parameters: Type.Object({ owner, repository, pullRequest, review, body: Type.String() }),
      replay: "unsafe",
      execute: async ({ owner, repository, pullRequest, review, body }, _api, context) => {
        try {
          const response = await github.rest.pulls.updateReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            body,
          });
          return { content: `Updated GitHub pull request review: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to update the pull request review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createGetReviewComment: defineTool({
      name: "github_get_review_comment",
      description: "Get a pull request review comment.",
      parameters: Type.Object({ owner, repository, comment: Type.Number({ description: "Review comment ID." }) }),
      replay: "safe",
      execute: async ({ owner, repository, comment }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.getReviewComment({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            comment_id: comment,
          });
          return {
            content: `Read review comment ${data.id} in ${owner}/${repository} by @${data.user?.login ?? "unknown"}: ${data.body}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to read the review comment: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListReviewComments: defineTool({
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
      execute: async ({ owner, repository, pullRequest, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listReviewComments({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            page,
            per_page: perPage,
          });
          return { content: `Found ${data.length} review comments on PR #${pullRequest} in ${owner}/${repository}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list review comments: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListReviewCommentsForReview: defineTool({
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
      execute: async ({ owner, repository, pullRequest, review, page, perPage }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listCommentsForReview({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            review_id: review,
            page,
            per_page: perPage,
          });
          return {
            content: `Found ${data.length} comments for review ${review} on PR #${pullRequest} in ${owner}/${repository}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list comments for the review: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createUpdateReviewComment: defineTool({
      name: "github_update_review_comment",
      description: "Update a pull request review comment.",
      parameters: Type.Object({
        owner,
        repository,
        comment: Type.Number({ description: "Review comment ID." }),
        body: Type.String(),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, comment, body }, _api, context) => {
        try {
          const response = await github.rest.pulls.updateReviewComment({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            comment_id: comment,
            body,
          });
          return { content: `Updated GitHub review comment: ${response.data.html_url}` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to update the review comment: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createListRequestedReviewers: defineTool({
      name: "github_list_requested_reviewers",
      description: "List requested reviewers for a pull request.",
      parameters: Type.Object({ owner, repository, pullRequest }),
      replay: "safe",
      execute: async ({ owner, repository, pullRequest }, _api, context) => {
        try {
          const { data } = await github.rest.pulls.listRequestedReviewers({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
          });
          return {
            content: `Requested reviewers for PR #${pullRequest} in ${owner}/${repository}: ${[...data.users.map((user) => `@${user.login}`), ...data.teams.map((team) => team.name)].join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list requested reviewers: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createRequestReviewers: defineTool({
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
      execute: async ({ owner, repository, pullRequest, reviewers, teamReviewers }, _api, context) => {
        try {
          await github.rest.pulls.requestReviewers({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            reviewers,
            team_reviewers: teamReviewers,
          });
          return { content: `Requested reviewers for pull request #${pullRequest}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to request reviewers: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    createRemoveRequestedReviewers: defineTool({
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
      execute: async ({ owner, repository, pullRequest, reviewers, teamReviewers }, _api, context) => {
        try {
          await github.rest.pulls.removeRequestedReviewers({
            request: { signal: context.abortSignal },
            owner,
            repo: repository,
            pull_number: pullRequest,
            reviewers,
            team_reviewers: teamReviewers,
          });
          return { content: `Removed requested reviewers from pull request #${pullRequest}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to remove requested reviewers: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
