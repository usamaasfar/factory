import { expect, mock, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
  type UsersInfoArguments,
  type UsersListArguments,
  type UsersLookupByEmailArguments,
  WebClient,
} from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createUserTools } from "./users.ts";

const api = {} as ToolExecutionApi;
const context = BACKGROUND_CONTEXT;
const user = {
  id: "U1",
  name: "alex",
  real_name: "Alex Chen",
  profile: { email: "alex@example.com" },
};

test("get a Slack user", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, user: { ...user, locale: "en-US" } };
  const info = mock(async (_args: UsersInfoArguments) => response);
  client.users.info = info;
  const tools = createUserTools(client, {} as IntegrationContext);
  const args = { user: "U1", include_locale: true };

  const result = await tools.info.execute(args, api, context);

  expect(info).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("list a page of Slack users", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, members: [user], response_metadata: { next_cursor: "next-page" } };
  const list = mock(async (_args: UsersListArguments) => response);
  client.users.list = list;
  const tools = createUserTools(client, {} as IntegrationContext);
  const args = { cursor: "previous-page", limit: 20, include_locale: true, team_id: "T1" };

  const result = await tools.list.execute(args, api, context);

  expect(list).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});

test("find a Slack user by email", async () => {
  const client = new WebClient("test-token");
  const response = { ok: true, user };
  const lookupByEmail = mock(async (_args: UsersLookupByEmailArguments) => response);
  client.users.lookupByEmail = lookupByEmail;
  const tools = createUserTools(client, {} as IntegrationContext);
  const args = { email: "alex@example.com" };

  const result = await tools.lookupByEmail.execute(args, api, context);

  expect(lookupByEmail).toHaveBeenCalledWith(args);
  expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
});
