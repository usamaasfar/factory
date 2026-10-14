import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type BookmarksAddArguments,
  type BookmarksEditArguments,
  type BookmarksListArguments,
  type BookmarksRemoveArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createBookmarkTools } from "./bookmarks.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;
const bookmark = {
  id: "Bk1",
  channel_id: "C1",
  title: "Repository",
  type: "link",
  link: "https://example.com/repository",
  emoji: ":rocket:",
};

function setup() {
  const client = new WebClient("test-token");
  const add = mock(async (_args: BookmarksAddArguments) => ({ ok: true, bookmark }));
  const edit = mock(async (_args: BookmarksEditArguments) => ({ ok: true, bookmark }));
  const list = mock(async (_args: BookmarksListArguments) => ({ ok: true, bookmarks: [bookmark] }));
  const remove = mock(async (_args: BookmarksRemoveArguments) => ({ ok: true }));
  client.bookmarks.add = add;
  client.bookmarks.edit = edit;
  client.bookmarks.list = list;
  client.bookmarks.remove = remove;
  return { tools: createBookmarkTools(client, {} as IntegrationContext), add, edit, list, remove };
}

test("add a channel bookmark", async () => {
  const { tools, add } = setup();
  const args = {
    channel_id: "C1",
    title: "Repository",
    type: "link" as const,
    link: "https://example.com/repository",
    emoji: ":rocket:",
    parent_id: "Bk0",
    access_level: "read" as const,
  };

  const result = await tools.add.execute(args, api, context);

  expect(add).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, bookmark }) }]);
});

test("edit a channel bookmark", async () => {
  const { tools, edit } = setup();
  const args = { channel_id: "C1", bookmark_id: "Bk1", title: "Source code", emoji: "" };
  const updated = { ...bookmark, title: "Source code", emoji: "" };
  edit.mockResolvedValueOnce({ ok: true, bookmark: updated });

  const result = await tools.edit.execute(args, api, context);

  expect(edit).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, bookmark: updated }) }]);
});

test("list channel bookmarks", async () => {
  const { tools, list } = setup();
  const args = { channel_id: "C1" };

  const result = await tools.list.execute(args, api, context);

  expect(list).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true, bookmarks: [bookmark] }) }]);
});

test("remove a channel bookmark", async () => {
  const { tools, remove } = setup();
  const args = { channel_id: "C1", bookmark_id: "Bk1", quip_section_id: "section1" };

  const result = await tools.remove.execute(args, api, context);

  expect(remove).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true }) }]);
});
