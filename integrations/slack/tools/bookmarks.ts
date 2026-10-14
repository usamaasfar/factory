import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

const channelId = Type.String({ minLength: 1, description: "Channel containing the bookmarks." });
const title = Type.String({ minLength: 1, description: "Bookmark title." });
const link = Type.String({ minLength: 1, description: "Bookmark URL, beginning with http:// or https://." });
const emoji = Type.String({ description: "Emoji tag to apply to the bookmark." });

export function createBookmarkTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    add: defineTool({
      name: "slack_bookmarks_add",
      description: "Add a link bookmark to a Slack channel.",
      parameters: Type.Object({
        channel_id: channelId,
        title,
        type: Type.Literal("link"),
        link,
        emoji: Type.Optional(emoji),
        entity_id: Type.Optional(
          Type.String({ minLength: 1, description: "Entity ID; only applies to message and file types." }),
        ),
        access_level: Type.Optional(Type.Union([Type.Literal("read"), Type.Literal("write")])),
        parent_id: Type.Optional(Type.String({ minLength: 1, description: "Parent bookmark ID." })),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args, _api, context) {
        context.abortSignal?.throwIfAborted();
        try {
          const response = await client.bookmarks.add(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            isError: true,
            content: `Failed to add the Slack bookmark: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    edit: defineTool({
      name: "slack_bookmarks_edit",
      description: "Edit a bookmark in a Slack channel. Omitted fields are unchanged.",
      parameters: Type.Object({
        channel_id: channelId,
        bookmark_id: Type.String({ minLength: 1, description: "Bookmark ID." }),
        title: Type.Optional(title),
        link: Type.Optional(link),
        emoji: Type.Optional(emoji),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args, _api, context) {
        context.abortSignal?.throwIfAborted();
        try {
          const response = await client.bookmarks.edit(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            isError: true,
            content: `Failed to edit the Slack bookmark: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    remove: defineTool({
      name: "slack_bookmarks_remove",
      description: "Remove a bookmark from a Slack channel.",
      parameters: Type.Object({
        channel_id: channelId,
        bookmark_id: Type.String({ minLength: 1, description: "Bookmark ID." }),
        quip_section_id: Type.Optional(Type.String({ minLength: 1, description: "Quip section ID to unbookmark." })),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args, _api, context) {
        context.abortSignal?.throwIfAborted();
        try {
          const response = await client.bookmarks.remove(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            isError: true,
            content: `Failed to remove the Slack bookmark: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    list: defineTool({
      name: "slack_bookmarks_list",
      description: "List bookmarks in a Slack channel.",
      parameters: Type.Object({ channel_id: channelId }),
      replay: "safe",
      access: "read",
      async execute(args, _api, context) {
        context.abortSignal?.throwIfAborted();
        try {
          const response = await client.bookmarks.list(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          context.abortSignal?.throwIfAborted();
          return {
            isError: true,
            content: `Failed to list Slack bookmarks: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
