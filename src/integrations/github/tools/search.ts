import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const query = Type.String({ description: "GitHub search query, including any qualifiers." });
const page = Type.Optional(Type.Number({ description: "Page number." }));
const perPage = Type.Optional(Type.Number({ description: "Results per page, up to 100." }));
const parameters = Type.Object({ query, page, perPage });

export function createSearchTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_search_code",
      description:
        "Search code on repository default branches. Prefer local search for the current workspace. Limited to 10 requests per minute.",
      parameters,
      replay: "safe",
      execute: async ({ query, page, perPage }) =>
        output(await github.rest.search.code({ q: query, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_search_commits",
      description: "Search GitHub commits by message and qualifiers.",
      parameters,
      replay: "safe",
      execute: async ({ query, page, perPage }) =>
        output(await github.rest.search.commits({ q: query, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_search_issues_and_pull_requests",
      description: "Search GitHub issues and pull requests. Use is:issue or is:pull-request to select a resource type.",
      parameters,
      replay: "safe",
      execute: async ({ query, page, perPage }) =>
        output(await github.rest.search.issuesAndPullRequests({ q: query, page, per_page: perPage })),
    }),
    defineTool({
      name: "github_search_repositories",
      description: "Search GitHub repositories by name, description, README, and qualifiers.",
      parameters,
      replay: "safe",
      execute: async ({ query, page, perPage }) =>
        output(await github.rest.search.repos({ q: query, page, per_page: perPage })),
    }),
  ];
}

function output(response: { data: unknown }) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }],
  };
}
