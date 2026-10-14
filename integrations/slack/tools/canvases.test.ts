import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { type CanvasesCreateArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createCanvasTools } from "./canvases.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;

test("create a Slack canvas in a channel tab", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, canvas_id: "F1" };
  const create = mock(async (_args: CanvasesCreateArguments) => response);
  client.canvases.create = create;
  const tools = createCanvasTools(client, {} as IntegrationContext);
  const args = {
    title: "Project plan",
    channel_id: "C1",
    document_content: { type: "markdown" as const, markdown: "# Project plan\n\n- [ ] Ship the fix" },
  };

  const result = await tools.create.execute(args, api, context);

  expect(create).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("read Slack canvas content", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, content: "# Project plan\n\n- [ ] Ship the fix" };
  const apiCall = mock(async (_method: string, _args?: Record<string, unknown>) => response);
  client.apiCall = apiCall;
  const tools = createCanvasTools(client, {} as IntegrationContext);
  const args = { canvas_id: "F1", content_type: "markdown" as const };

  const result = await tools.getContent.execute(args, api, context);

  expect(apiCall).toHaveBeenCalledWith("canvases.getContent", args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("find a Slack canvas section", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, sections: [{ id: "temp:C:section1" }] };
  const apiCall = mock(async (_method: string, _args?: Record<string, unknown>) => response);
  client.apiCall = apiCall;
  const tools = createCanvasTools(client, {} as IntegrationContext);
  const args = { canvas_id: "F1", criteria: { section_types: ["list"], contains_text: "Ship the fix" } };

  const result = await tools.sectionsLookup.execute(args, api, context);

  expect(apiCall).toHaveBeenCalledWith("canvases.sections.lookup", args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("replace a Slack canvas section", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true };
  const apiCall = mock(async (_method: string, _args?: Record<string, unknown>) => response);
  client.apiCall = apiCall;
  const tools = createCanvasTools(client, {} as IntegrationContext);
  const args = {
    canvas_id: "F1",
    changes: [
      {
        operation: "replace" as const,
        section_id: "temp:C:section1",
        document_content: { type: "markdown" as const, markdown: "- [x] Ship the fix" },
      },
    ],
  };

  const result = await tools.edit.execute(args, api, context);

  expect(apiCall).toHaveBeenCalledWith("canvases.edit", args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
