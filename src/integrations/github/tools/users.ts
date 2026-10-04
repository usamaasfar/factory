import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { GitHubClient } from "../index.ts";

const username = Type.String({ description: "GitHub username." });
const perPage = Type.Optional(Type.Number({ description: "Results per page, up to 100." }));

export function createUserTools(github: GitHubClient) {
  return [
    defineTool({
      name: "github_get_user",
      description: "Get a GitHub user by username.",
      parameters: Type.Object({ username }),
      replay: "safe",
      execute: async ({ username }) => output(await github.rest.users.getByUsername({ username })),
    }),
    defineTool({
      name: "github_get_user_by_id",
      description: "Get a GitHub user by numeric account ID.",
      parameters: Type.Object({ accountId: Type.Number({ description: "GitHub account ID." }) }),
      replay: "safe",
      execute: async ({ accountId }) => output(await github.rest.users.getById({ account_id: accountId })),
    }),
    defineTool({
      name: "github_list_users",
      description: "List GitHub users.",
      parameters: Type.Object({ since: Type.Optional(Type.Number()), perPage }),
      replay: "safe",
      execute: async ({ since, perPage }) => output(await github.rest.users.list({ since, per_page: perPage })),
    }),
  ];
}

function output(response: { data: unknown }) {
  return { content: [{ type: "text" as const, text: JSON.stringify(response.data, null, 2) }] };
}
