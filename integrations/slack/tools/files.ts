import type { FilesCompleteUploadExternalArguments, WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

export function createFileTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    info: defineTool({
      name: "slack_files_info",
      description: "Get information about a Slack file.",
      parameters: Type.Object({
        file: Type.String({ minLength: 1, description: "File ID." }),
        cursor: Type.Optional(Type.String({ description: "Pagination cursor for file comments." })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 999 })),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.files.info(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get the Slack file: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    list: defineTool({
      name: "slack_files_list",
      description: "List Slack files shared in a channel or created by a user.",
      parameters: Type.Object({
        channel: Type.Optional(Type.String({ minLength: 1, description: "Channel ID." })),
        user: Type.Optional(Type.String({ minLength: 1, description: "User ID." })),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
        page: Type.Optional(Type.Integer({ minimum: 1 })),
        ts_from: Type.Optional(Type.String()),
        ts_to: Type.Optional(Type.String()),
        types: Type.Optional(Type.String({ description: "Comma-separated file types." })),
        team_id: Type.Optional(Type.String({ minLength: 1, description: "Workspace ID." })),
        show_files_hidden_by_limit: Type.Optional(Type.Boolean()),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          const response = await client.files.list(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to list Slack files: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    getUploadURLExternal: defineTool({
      name: "slack_files_getUploadURLExternal",
      description: "Get a temporary URL for uploading a file to Slack.",
      parameters: Type.Object({
        filename: Type.String({ minLength: 1 }),
        length: Type.Integer({ minimum: 1, description: "File size in bytes." }),
        alt_text: Type.Optional(Type.String({ maxLength: 1000 })),
        snippet_type: Type.Optional(Type.String()),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.files.getUploadURLExternal(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to get the Slack file upload URL: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    completeUploadExternal: defineTool({
      name: "slack_files_completeUploadExternal",
      description: "Finish a Slack file upload and optionally share it in a channel or thread.",
      parameters: Type.Object({
        files: Type.Array(
          Type.Object({
            id: Type.String({ minLength: 1, description: "Uploaded file ID." }),
            title: Type.Optional(Type.String()),
            highlight_type: Type.Optional(Type.String()),
          }),
          { minItems: 1 },
        ),
        channel_id: Type.Optional(Type.String({ minLength: 1, description: "Channel ID." })),
        thread_ts: Type.Optional(Type.String({ minLength: 1, description: "Parent message timestamp." })),
        initial_comment: Type.Optional(Type.String()),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        if (args.thread_ts && !args.channel_id) {
          return { isError: true, content: "Sharing a file in a thread requires channel_id." };
        }
        try {
          const response = await client.files.completeUploadExternal(args as FilesCompleteUploadExternalArguments);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to complete the Slack file upload: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
