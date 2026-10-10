import type { Octokit } from "@octokit/rest";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createCommentTool(client: Octokit, _ctx: IntegrationContext) {
  return defineTool({
    name: "github_comment_on_pull_request",
    description: "Post a comment on a GitHub pull request.",
    parameters: Type.Object({
      owner: Type.String({ minLength: 1 }),
      repository: Type.String({ minLength: 1 }),
      pullRequest: Type.Integer({ minimum: 1 }),
      body: Type.String({ minLength: 1 }),
    }),
    replay: "unsafe",
    async execute({ owner, repository, pullRequest, body }, _api, context) {
      context.abortSignal?.throwIfAborted();
      const { data } = await client.rest.issues.createComment({
        owner,
        repo: repository,
        issue_number: pullRequest,
        body,
        request: { signal: context.abortSignal },
      });
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, url: data.html_url }) }] };
    },
  });
}
