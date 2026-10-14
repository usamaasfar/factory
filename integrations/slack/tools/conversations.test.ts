import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { type ConversationsRepliesArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createReadTool } from "./conversations.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;

test("read a page of Slack thread messages", async () => {
  const client = new WebClient("test-token");
  const replies = mock(async (_args: ConversationsRepliesArguments) => ({
    ok: true,
    messages: [{ ts: "1700000001.000001", user: "U1", text: "Please review the fix." }],
    response_metadata: { next_cursor: "next-page" },
  }));
  client.conversations.replies = replies;
  const tool = createReadTool(client, {} as IntegrationContext);

  const result = await tool.execute(
    { channel: "C1", thread: "1700000000.000001", cursor: "current-page", limit: 10 },
    api,
    context,
  );

  expect(replies).toHaveBeenCalledWith({
    channel: "C1",
    ts: "1700000000.000001",
    cursor: "current-page",
    limit: 10,
  });
  expect(result.content).toEqual([
    {
      type: "text",
      text: "Read 1 messages from Slack channel C1, thread 1700000000.000001:\n[1700000001.000001] U1: Please review the fix.\nNext cursor: next-page",
    },
  ]);
});
