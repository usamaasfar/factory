import type { WebClient } from "@slack/web-api";
import { defineTool, type IntegrationContext, Type } from "factory-oss/integration";

const documentContent = Type.Object({
  type: Type.Literal("markdown"),
  markdown: Type.String({ maxLength: 1048576 }),
});

export function createCanvasTools(client: WebClient, _ctx: IntegrationContext) {
  return {
    create: defineTool({
      name: "slack_canvases_create",
      description: "Create a Slack canvas, optionally added to a channel tab.",
      parameters: Type.Object({
        title: Type.Optional(Type.String()),
        channel_id: Type.Optional(Type.String({ minLength: 1, description: "Channel ID." })),
        document_content: Type.Optional(documentContent),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          const response = await client.canvases.create(args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to create the Slack canvas: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    getContent: defineTool({
      name: "slack_canvases_getContent",
      description: "Read a Slack canvas as markdown or HTML.",
      parameters: Type.Object({
        canvas_id: Type.String({ minLength: 1, description: "Canvas ID." }),
        content_type: Type.Optional(Type.Union([Type.Literal("markdown"), Type.Literal("html")])),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        try {
          // This method is not yet represented in the installed SDK.
          const response = await client.apiCall("canvases.getContent", args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to read the Slack canvas: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    sectionsLookup: defineTool({
      name: "slack_canvases_sections_lookup",
      description: "Find sections in a Slack canvas for targeted edits.",
      parameters: Type.Object({
        canvas_id: Type.String({ minLength: 1, description: "Canvas ID." }),
        criteria: Type.Object({
          section_types: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              minItems: 1,
              description: "Section types, such as any_header, h1, h2, h3, list, or table.",
            }),
          ),
          contains_text: Type.Optional(Type.String({ minLength: 1 })),
        }),
      }),
      replay: "safe",
      access: "read",
      async execute(args) {
        if (!args.criteria.section_types && !args.criteria.contains_text) {
          return { isError: true, content: "Finding canvas sections requires section_types or contains_text." };
        }
        try {
          // The SDK's section types omit several types supported by Slack.
          const response = await client.apiCall("canvases.sections.lookup", args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to find Slack canvas sections: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),

    edit: defineTool({
      name: "slack_canvases_edit",
      description: "Insert or replace Slack canvas content, or rename the canvas.",
      parameters: Type.Object({
        canvas_id: Type.String({ minLength: 1, description: "Canvas ID." }),
        changes: Type.Array(
          Type.Union([
            Type.Object({
              operation: Type.Union([Type.Literal("insert_before"), Type.Literal("insert_after")]),
              section_id: Type.String({ minLength: 1 }),
              document_content: documentContent,
            }),
            Type.Object({
              operation: Type.Union([Type.Literal("insert_at_start"), Type.Literal("insert_at_end")]),
              document_content: documentContent,
            }),
            Type.Object({
              operation: Type.Literal("replace"),
              section_id: Type.Optional(Type.String({ minLength: 1 })),
              document_content: documentContent,
            }),
            Type.Object({
              operation: Type.Literal("rename"),
              title_content: documentContent,
            }),
          ]),
          { minItems: 1, maxItems: 1 },
        ),
      }),
      replay: "unsafe",
      access: "write",
      async execute(args) {
        try {
          // The SDK's change types do not yet include rename.
          const response = await client.apiCall("canvases.edit", args);
          return { content: JSON.stringify(response) };
        } catch (error) {
          return {
            isError: true,
            content: `Failed to edit the Slack canvas: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    }),
  };
}
