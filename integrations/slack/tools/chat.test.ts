import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type ChatGetPermalinkArguments,
  type ChatPostMessageArguments,
  type ChatUpdateArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createChatTools } from "./chat.ts";

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
  const tools = createChatTools(client, {} as IntegrationContext);

  const result = await tools.replyToThread.execute(
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

test("post a message to a Slack channel", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, channel: "C1", ts: "1700000001.000001" };
  const postMessage = mock(async (_args: ChatPostMessageArguments) => response);
  client.chat.postMessage = postMessage;
  const tools = createChatTools(client, {} as IntegrationContext);
  const args = { channel: "C1", text: "The fix is ready for review.", unfurl_links: false, unfurl_media: false };

  const result = await tools.postMessage.execute(args, api, context);

  expect(postMessage).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("update a Slack message", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, channel: "C1", ts: "1700000001.000001", text: "The fix is merged." };
  const update = mock(async (_args: ChatUpdateArguments) => response);
  client.chat.update = update;
  const tools = createChatTools(client, {} as IntegrationContext);
  const args = { channel: "C1", ts: "1700000001.000001", text: "The fix is merged." };

  const result = await tools.update.execute(args, api, context);

  expect(update).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("get a Slack message permalink", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, permalink: "https://example.slack.com/archives/C1/p1700000001000001" };
  const getPermalink = mock(async (_args: ChatGetPermalinkArguments) => response);
  client.chat.getPermalink = getPermalink;
  const tools = createChatTools(client, {} as IntegrationContext);
  const args = { channel: "C1", message_ts: "1700000001.000001" };

  const result = await tools.getPermalink.execute(args, api, context);

  expect(getPermalink).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
