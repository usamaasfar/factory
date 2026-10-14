import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type ConversationsCanvasesCreateArguments,
  type ConversationsHistoryArguments,
  type ConversationsInfoArguments,
  type ConversationsJoinArguments,
  type ConversationsListArguments,
  type ConversationsMembersArguments,
  type ConversationsRepliesArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createConversationTools } from "./conversations.ts";

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
  const tools = createConversationTools(client, {} as IntegrationContext);

  const result = await tools.readThread.execute(
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

test("list a page of Slack channels", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    channels: [{ id: "C1", name: "engineering" }],
    response_metadata: { next_cursor: "next-page" },
  };
  const list = mock(async (_args: ConversationsListArguments) => response);
  client.conversations.list = list;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = { cursor: "current-page", limit: 20, types: "public_channel,private_channel", exclude_archived: true };

  const result = await tools.list.execute(args, api, context);

  expect(list).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("get a Slack channel and its canvas", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    channel: {
      id: "C1",
      name: "engineering",
      properties: { canvas: { file_id: "F1" }, tabs: [{ id: "tab1", type: "channel_canvas" }] },
    },
  };
  const info = mock(async (_args: ConversationsInfoArguments) => response);
  client.conversations.info = info;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = { channel: "C1", include_num_members: true };

  const result = await tools.info.execute(args, api, context);

  expect(info).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("read a page of Slack channel history", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    messages: [{ ts: "1700000001.000001", user: "U1", text: "The fix is ready." }],
    response_metadata: { next_cursor: "next-page" },
  };
  const history = mock(async (_args: ConversationsHistoryArguments) => response);
  client.conversations.history = history;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = {
    channel: "C1",
    cursor: "current-page",
    limit: 10,
    oldest: "1700000000.000001",
    latest: "1700000002.000001",
    inclusive: true,
  };

  const result = await tools.history.execute(args, api, context);

  expect(history).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("list a page of Slack channel members", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, members: ["U1", "U2"], response_metadata: { next_cursor: "next-page" } };
  const members = mock(async (_args: ConversationsMembersArguments) => response);
  client.conversations.members = members;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = { channel: "C1", cursor: "current-page", limit: 20 };

  const result = await tools.members.execute(args, api, context);

  expect(members).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("join a public Slack channel", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, channel: { id: "C1", name: "engineering", is_member: true } };
  const join = mock(async (_args: ConversationsJoinArguments) => response);
  client.conversations.join = join;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = { channel: "C1" };

  const result = await tools.join.execute(args, api, context);

  expect(join).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("create a Slack channel canvas", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, canvas_id: "F1" };
  const create = mock(async (_args: ConversationsCanvasesCreateArguments) => response);
  client.conversations.canvases.create = create;
  const tools = createConversationTools(client, {} as IntegrationContext);
  const args = {
    channel_id: "C1",
    title: "Engineering notes",
    document_content: { type: "markdown" as const, markdown: "# Engineering\n\nWeekly notes." },
  };

  const result = await tools.canvasesCreate.execute(args, api, context);

  expect(create).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
