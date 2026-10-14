import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { type EmojiListArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createEmojiTools } from "./emoji.ts";

test("list workspace emoji and aliases", async () => {
  const client = new WebClient("test-token");
  const response = {
    ok: true,
    emoji: { shipit: "https://example.com/shipit.png", deploy: "alias:shipit" },
  };
  const list = mock(async (_args: EmojiListArguments) => response);
  client.emoji.list = list;
  const tools = createEmojiTools(client, {} as IntegrationContext);
  const args = { include_categories: true };

  const result = await tools.list.execute(args, {} as ToolExecutionApi, BACKGROUND_CONTEXT);

  expect(list).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
