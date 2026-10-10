import type { Octokit } from "@octokit/rest";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

const owner = Type.String({ description: "Repository owner." });
const repository = Type.String({ description: "Repository name." });
const reaction = Type.Union([
  Type.Literal("+1"),
  Type.Literal("-1"),
  Type.Literal("laugh"),
  Type.Literal("confused"),
  Type.Literal("heart"),
  Type.Literal("hooray"),
  Type.Literal("rocket"),
  Type.Literal("eyes"),
]);
const target = Type.Union([
  Type.Object({
    type: Type.Literal("pull_request"),
    pullRequest: Type.Number({ description: "Pull request number." }),
  }),
  Type.Object({
    type: Type.Literal("issue_comment"),
    comment: Type.Number({ description: "Pull request conversation comment ID." }),
  }),
  Type.Object({
    type: Type.Literal("review_comment"),
    comment: Type.Number({ description: "Pull request review comment ID." }),
  }),
]);

export function createReactionTools(github: Octokit, _ctx: IntegrationContext) {
  return {
    createReaction: defineTool({
      name: "github_create_reaction",
      description: "Add a reaction to a GitHub pull request or pull request comment.",
      parameters: Type.Object({ owner, repository, target, reaction }),
      replay: "unsafe",
      execute: async ({ owner, repository, target, reaction }, _api, context) => {
        const subject =
          target.type === "pull_request"
            ? `PR #${target.pullRequest}`
            : `${target.type === "issue_comment" ? "comment" : "review comment"} ${target.comment}`;
        const common = {
          request: { signal: context.abortSignal },
          owner,
          repo: repository,
          content: reaction,
        };

        try {
          switch (target.type) {
            case "pull_request":
              await github.rest.reactions.createForIssue({ ...common, issue_number: target.pullRequest });
              break;
            case "issue_comment":
              await github.rest.reactions.createForIssueComment({ ...common, comment_id: target.comment });
              break;
            case "review_comment":
              await github.rest.reactions.createForPullRequestReviewComment({
                ...common,
                comment_id: target.comment,
              });
              break;
            default:
              throw new Error("Unsupported reaction target.");
          }
          return { content: `Added ${reaction} reaction to ${subject} in ${owner}/${repository}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to add ${reaction} reaction to ${subject}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    deleteReaction: defineTool({
      name: "github_delete_reaction",
      description: "Delete a reaction from a GitHub pull request or pull request comment.",
      parameters: Type.Object({
        owner,
        repository,
        target,
        reactionId: Type.Number({ description: "Reaction ID." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, target, reactionId }, _api, context) => {
        const subject =
          target.type === "pull_request"
            ? `PR #${target.pullRequest}`
            : `${target.type === "issue_comment" ? "comment" : "review comment"} ${target.comment}`;
        const common = {
          request: { signal: context.abortSignal },
          owner,
          repo: repository,
          reaction_id: reactionId,
        };

        try {
          switch (target.type) {
            case "pull_request":
              await github.rest.reactions.deleteForIssue({ ...common, issue_number: target.pullRequest });
              break;
            case "issue_comment":
              await github.rest.reactions.deleteForIssueComment({ ...common, comment_id: target.comment });
              break;
            case "review_comment":
              await github.rest.reactions.deleteForPullRequestComment({
                ...common,
                comment_id: target.comment,
              });
              break;
            default:
              throw new Error("Unsupported reaction target.");
          }
          return { content: `Deleted reaction ${reactionId} from ${subject} in ${owner}/${repository}.` };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to delete reaction ${reactionId} from ${subject}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    listReactions: defineTool({
      name: "github_list_reactions",
      description: "List reactions on a GitHub pull request or pull request comment.",
      parameters: Type.Object({
        owner,
        repository,
        target,
        reaction: Type.Optional(reaction),
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number({ description: "Results per page, up to 100." })),
      }),
      replay: "safe",
      execute: async ({ owner, repository, target, reaction, page, perPage }, _api, context) => {
        const subject =
          target.type === "pull_request"
            ? `PR #${target.pullRequest}`
            : `${target.type === "issue_comment" ? "comment" : "review comment"} ${target.comment}`;
        const common = {
          request: { signal: context.abortSignal },
          owner,
          repo: repository,
          content: reaction,
          page,
          per_page: perPage,
        };

        try {
          let reactions: Array<{
            id: number;
            content: string;
            user: { login: string } | null;
          }>;
          switch (target.type) {
            case "pull_request":
              reactions = (await github.rest.reactions.listForIssue({ ...common, issue_number: target.pullRequest }))
                .data;
              break;
            case "issue_comment":
              reactions = (await github.rest.reactions.listForIssueComment({ ...common, comment_id: target.comment }))
                .data;
              break;
            case "review_comment":
              reactions = (
                await github.rest.reactions.listForPullRequestReviewComment({
                  ...common,
                  comment_id: target.comment,
                })
              ).data;
              break;
            default:
              throw new Error("Unsupported reaction target.");
          }
          return {
            content: `Found ${reactions.length} reactions on ${subject} in ${owner}/${repository}: ${reactions.map((item) => `${item.content} by @${item.user?.login ?? "unknown"} (${item.id})`).join(", ") || "none"}.`,
          };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            content: `Failed to list reactions on ${subject}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
