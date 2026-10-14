import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createAssistantTools } from "./assistant.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;

test("search Slack for relevant context", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    results: {
      messages: [
        {
          channel_id: "C1",
          message_ts: "1700000001.000001",
          content: "The deployment is ready.",
          permalink: "https://example.slack.com/archives/C1/p1700000001000001",
        },
      ],
    },
    next_cursor: "next-page",
  };
  const apiCall = mock(async (_method: string, _args?: Record<string, unknown>) => response);
  client.apiCall = apiCall;
  const tools = createAssistantTools(client, {} as IntegrationContext);
  const args = {
    query: "deployment plan",
    action_token: "event-action-token",
    channel_types: ["public_channel" as const],
    content_types: ["messages" as const, "files" as const],
    include_context_messages: true,
    cursor: "current-page",
    limit: 10,
  };

  const result = await tools.searchContext.execute(args, api, context);

  expect(apiCall).toHaveBeenCalledWith("assistant.search.context", args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("get Slack semantic search availability", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, is_ai_search_enabled: true };
  const apiCall = mock(async (_method: string, _args?: Record<string, unknown>) => response);
  client.apiCall = apiCall;
  const tools = createAssistantTools(client, {} as IntegrationContext);

  const result = await tools.searchInfo.execute({}, api, context);

  expect(apiCall).toHaveBeenCalledWith("assistant.search.info");
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
