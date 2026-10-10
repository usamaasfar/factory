import type { Octokit } from "@octokit/rest";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createReadTool(client: Octokit, _ctx: IntegrationContext) {
  return defineTool({
    name: "github_read_pull_request",
    description: "Read a GitHub pull request.",
    parameters: Type.Object({
      owner: Type.String({ minLength: 1 }),
      repository: Type.String({ minLength: 1 }),
      pullRequest: Type.Integer({ minimum: 1 }),
    }),
    replay: "safe",
    async execute({ owner, repository, pullRequest }, _api, context) {
      context.abortSignal?.throwIfAborted();
      const { data } = await client.rest.pulls.get({
        owner,
        repo: repository,
        pull_number: pullRequest,
        request: { signal: context.abortSignal },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              number: data.number,
              title: data.title,
              body: data.body,
              state: data.state,
              url: data.html_url,
              head: data.head.sha,
              base: data.base.sha,
            }),
          },
        ],
      };
    },
  });
}
