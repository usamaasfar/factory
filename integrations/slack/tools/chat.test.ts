import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { type ChatPostMessageArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createReplyTool } from "./chat.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;

test("reply to a Slack thread", async () => {
  const client = new WebClient("test-token");
  const postMessage = mock(async (_args: ChatPostMessageArguments) => ({
    ok: true,
    channel: "C1",
    ts: "1700000001.000001",
  }));
  client.chat.postMessage = postMessage;
  const tool = createReplyTool(client, {} as IntegrationContext);

  const result = await tool.execute(
    { channel: "C1", thread: "1700000000.000001", text: "The fix is ready for review." },
    api,
    context,
  );

  expect(postMessage).toHaveBeenCalledWith({
    channel: "C1",
    thread_ts: "1700000000.000001",
    text: "The fix is ready for review.",
    unfurl_links: false,
    unfurl_media: false,
  });
  expect(result.content).toEqual([{ type: "text", text: "Replied in Slack channel C1 at 1700000001.000001." }]);
});
