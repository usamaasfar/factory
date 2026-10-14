import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createUserTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    info: defineTool({
      name: "slack_users_info",
      description: "Get information about a Slack user.",
      parameters: Type.Object({
        user: Type.String({ minLength: 1, description: "User ID." }),
        include_locale: Type.Optional(Type.Boolean({ description: "Include the user's locale." })),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.users.info(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get the Slack user: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    list: defineTool({
      name: "slack_users_list",
      description: "List users in the Slack workspace.",
      parameters: Type.Object({
        cursor: Type.Optional(Type.String({ description: "Pagination cursor from the previous response." })),
        limit: Type.Optional(
          Type.Integer({ minimum: 1, maximum: 999, description: "Maximum number of users to return." }),
        ),
        include_locale: Type.Optional(Type.Boolean({ description: "Include users' locales." })),
        team_id: Type.Optional(Type.String({ minLength: 1, description: "Workspace ID." })),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.users.list(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to list Slack users: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    lookupByEmail: defineTool({
      name: "slack_users_lookupByEmail",
      description: "Find a Slack user by email address.",
      parameters: Type.Object({
        email: Type.String({ minLength: 1, description: "Email address." }),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.users.lookupByEmail(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to find the Slack user by email: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
