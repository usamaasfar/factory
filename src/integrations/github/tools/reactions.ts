import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

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
  Type.Object({ type: Type.Literal("commit_comment"), comment: Type.Number() }),
  Type.Object({ type: Type.Literal("issue"), issue: Type.Number() }),
  Type.Object({ type: Type.Literal("issue_comment"), comment: Type.Number() }),
  Type.Object({ type: Type.Literal("pull_request_review_comment"), comment: Type.Number() }),
  Type.Object({ type: Type.Literal("release"), release: Type.Number() }),
]);

export function createReactionTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_create_reaction",
      description: "Add a reaction to a GitHub issue, comment, review comment, commit comment, or release.",
      parameters: Type.Object({ owner, repository, target, reaction }),
      replay: "unsafe",
      execute: async ({ owner, repository, target, reaction }) => {
        const common = { owner, repo: repository, content: reaction };
        switch (target.type) {
          case "commit_comment":
            return output(
              (await github.rest.reactions.createForCommitComment({ ...common, comment_id: target.comment })).data,
            );
          case "issue":
            return output((await github.rest.reactions.createForIssue({ ...common, issue_number: target.issue })).data);
          case "issue_comment":
            return output(
              (await github.rest.reactions.createForIssueComment({ ...common, comment_id: target.comment })).data,
            );
          case "pull_request_review_comment":
            return output(
              (await github.rest.reactions.createForPullRequestReviewComment({ ...common, comment_id: target.comment }))
                .data,
            );
          case "release":
            if (reaction === "-1" || reaction === "confused") {
              throw new Error(`GitHub releases do not support the ${reaction} reaction`);
            }
            return output(
              (
                await github.rest.reactions.createForRelease({
                  ...common,
                  content: reaction,
                  release_id: target.release,
                })
              ).data,
            );
        }
      },
    }),
    defineTool({
      name: "github_list_reactions",
      description: "List reactions on a GitHub issue, comment, review comment, commit comment, or release.",
      parameters: Type.Object({
        owner,
        repository,
        target,
        reaction: Type.Optional(reaction),
        page: Type.Optional(Type.Number()),
        perPage: Type.Optional(Type.Number({ description: "Results per page, up to 100." })),
      }),
      replay: "safe",
      execute: async ({ owner, repository, target, reaction, page, perPage }) => {
        const common = { owner, repo: repository, content: reaction, page, per_page: perPage };
        switch (target.type) {
          case "commit_comment":
            return output(
              (await github.rest.reactions.listForCommitComment({ ...common, comment_id: target.comment })).data,
            );
          case "issue":
            return output((await github.rest.reactions.listForIssue({ ...common, issue_number: target.issue })).data);
          case "issue_comment":
            return output(
              (await github.rest.reactions.listForIssueComment({ ...common, comment_id: target.comment })).data,
            );
          case "pull_request_review_comment":
            return output(
              (await github.rest.reactions.listForPullRequestReviewComment({ ...common, comment_id: target.comment }))
                .data,
            );
          case "release":
            if (reaction === "-1" || reaction === "confused") {
              throw new Error(`GitHub releases do not support the ${reaction} reaction`);
            }
            return output(
              (await github.rest.reactions.listForRelease({ ...common, content: reaction, release_id: target.release }))
                .data,
            );
        }
      },
    }),
    defineTool({
      name: "github_delete_reaction",
      description: "Delete a reaction from a GitHub issue, comment, review comment, commit comment, or release.",
      parameters: Type.Object({
        owner,
        repository,
        target,
        reaction: Type.Number({ description: "Reaction ID." }),
      }),
      replay: "unsafe",
      execute: async ({ owner, repository, target, reaction }) => {
        const common = { owner, repo: repository, reaction_id: reaction };
        switch (target.type) {
          case "commit_comment":
            await github.rest.reactions.deleteForCommitComment({ ...common, comment_id: target.comment });
            break;
          case "issue":
            await github.rest.reactions.deleteForIssue({ ...common, issue_number: target.issue });
            break;
          case "issue_comment":
            await github.rest.reactions.deleteForIssueComment({ ...common, comment_id: target.comment });
            break;
          case "pull_request_review_comment":
            await github.rest.reactions.deleteForPullRequestComment({ ...common, comment_id: target.comment });
            break;
          case "release":
            await github.rest.reactions.deleteForRelease({ ...common, release_id: target.release });
            break;
        }

        return { content: [{ type: "text", text: `Deleted reaction ${reaction}.` }] };
      },
    }),
  ];
}

function output(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
