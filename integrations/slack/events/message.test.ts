import { expect, test } from "bun:test";
import type { IntegrationContext } from "factory-oss/integration";
import { createMessageEvents } from "./message.ts";

const { appMention, channelMessage, groupMessage } = createMessageEvents({} as IntegrationContext);

const mention = {
  type: "app_mention",
  user: "U1",
  text: "Please review this.",
  channel: "C1",
  ts: "1700000001.000001",
  event_ts: "1700000001.000001",
};

const reply = {
  type: "message",
  channel: "C1",
  user: "U1",
  text: "The fix is ready.",
  ts: "1700000001.000001",
  thread_ts: "1700000000.000001",
  event_ts: "1700000001.000001",
};

test("a mention in a thread retains its parent and reply identity", async () => {
  const result = await appMention.execute({
    id: "Ev1",
    name: "app_mention",
    payload: {
      team_id: "T1",
      event: { ...mention, thread_ts: "1700000000.000001" },
    },
  });

  expect(result).toEqual({
    subject: "workspace:T1:channel:C1:thread:1700000000.000001:reply:1700000001.000001",
    content: "Slack user U1 mentioned the app in channel C1, thread 1700000000.000001: Please review this.",
  });
});

test("a public-channel reply retains its parent thread and reply identity", async () => {
  const result = await channelMessage.execute({
    id: "Ev1",
    name: "message.channels",
    payload: { team_id: "T1", event: { ...reply, channel_type: "channel" } },
  });

  expect(result).toEqual({
    subject: "workspace:T1:channel:C1:thread:1700000000.000001:reply:1700000001.000001",
    content: "Slack user U1 replied in channel C1, thread 1700000000.000001: The fix is ready.",
  });
});

test("a private-channel reply retains its parent thread and reply identity", async () => {
  const result = await groupMessage.execute({
    id: "Ev1",
    name: "message.groups",
    payload: { team_id: "T1", event: { ...reply, channel_type: "group" } },
  });

  expect(result).toEqual({
    subject: "workspace:T1:channel:C1:thread:1700000000.000001:reply:1700000001.000001",
    content: "Slack user U1 replied in channel C1, thread 1700000000.000001: The fix is ready.",
  });
});
