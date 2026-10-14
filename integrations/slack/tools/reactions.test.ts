import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type ReactionsAddArguments,
  type ReactionsGetArguments,
  type ReactionsRemoveArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createReactionTools } from "./reactions.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;
const message = {
  ts: "1700000000.000001",
  text: "The fix is ready.",
  reactions: [{ name: "white_check_mark", count: 1, users: ["U1"] }],
};

function setup() {
  const client = new WebClient("test-token");
  const add = mock(async (_args: ReactionsAddArguments) => ({ ok: true }));
  const get = mock(async (_args: ReactionsGetArguments) => ({ ok: true, type: "message", channel: "C1", message }));
  const remove = mock(async (_args: ReactionsRemoveArguments) => ({ ok: true }));
  client.reactions.add = add;
  client.reactions.get = get;
  client.reactions.remove = remove;
  return { tools: createReactionTools(client, {} as IntegrationContext), add, get, remove };
}

test("add a message reaction", async () => {
  const { tools, add } = setup();
  const args = { channel: "C1", timestamp: message.ts, name: "white_check_mark" };

  const result = await tools.add.execute(args, api, context);

  expect(add).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true }) }]);
});

test("get a message and its reactions", async () => {
  const { tools, get } = setup();
  const args = { channel: "C1", timestamp: message.ts, full: true };

  const result = await tools.get.execute(args, api, context);

  expect(get).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([
    { type: "text", text: JSON.stringify({ ok: true, type: "message", channel: "C1", message }) },
  ]);
});

test("remove a message reaction", async () => {
  const { tools, remove } = setup();
  const args = { channel: "C1", timestamp: message.ts, name: "white_check_mark" };

  const result = await tools.remove.execute(args, api, context);

  expect(remove).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify({ ok: true }) }]);
});
