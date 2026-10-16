import { describe, expect, mock, test } from "bun:test";
import { type ConversationsInfoArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createMessageEvents } from "./message.ts";

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

describe("app_mention", () => {
  test("in a thread", async () => {
    const client = new WebClient("test-token");
    const { appMention } = createMessageEvents(client, {} as IntegrationContext);

    const result = await appMention.execute({
      id: "Ev1",
      name: "app_mention",
      payload: {
        team_id: "T1",
        event: { ...mention, thread_ts: "1700000000.000001" },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 mentioned the app in channel C1, thread 1700000000.000001: Please review this.",
    });
  });

  test("in a canvas section", async () => {
    const client = new WebClient("test-token");
    const { appMention } = createMessageEvents(client, {} as IntegrationContext);
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Please summarize this plan." } }];

    const result = await appMention.execute({
      id: "Ev1",
      name: "app_mention",
      payload: {
        team_id: "T1",
        event: {
          ...mention,
          subtype: "document_mention",
          text: "The app was mentioned in a canvas.",
          document_mention: { file_id: "F1", section_id: "temp:C:section1", mentioning_user_ids: ["U1"] },
          blocks,
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:file:F1:section:temp:C:section1",
      content:
        'Slack user U1 mentioned the app in canvas F1, section temp:C:section1: The app was mentioned in a canvas.\nMention context: [{"type":"section","text":{"type":"mrkdwn","text":"Please summarize this plan."}}]',
    });
  });

  test("with a file and a search action token", async () => {
    const client = new WebClient("test-token");
    const { appMention } = createMessageEvents(client, {} as IntegrationContext);

    const result = await appMention.execute({
      id: "Ev1",
      name: "app_mention",
      payload: {
        team_id: "T1",
        event: {
          ...mention,
          subtype: "file_share",
          thread_ts: "1700000000.000001",
          files: [{ id: "F1", name: "build.log", title: "Build log", mimetype: "text/plain" }],
          action_token: "event-action-token",
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content:
        "Slack user U1 mentioned the app in channel C1, thread 1700000000.000001: Please review this.\nFiles: F1.\nSearch action token (do not share): event-action-token",
    });
  });
});

describe("message", () => {
  test("a public-channel thread reply", async () => {
    const client = new WebClient("test-token");
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: { team_id: "T1", event: { ...reply, channel_type: "channel" } },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 replied in channel C1, thread 1700000000.000001: The fix is ready.",
    });
  });

  test("a private-channel thread reply", async () => {
    const client = new WebClient("test-token");
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: { team_id: "T1", event: { ...reply, channel_type: "group" } },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 replied in channel C1, thread 1700000000.000001: The fix is ready.",
    });
  });

  test("a broadcast reply", async () => {
    const client = new WebClient("test-token");
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: {
        team_id: "T1",
        event: {
          ...reply,
          channel_type: "channel",
          subtype: "thread_broadcast",
          client_msg_id: "bd7cdd5d-1835-4cf0-a53b-5c72f71a1a2b",
          root: {
            type: "message",
            ts: reply.thread_ts,
            thread_ts: reply.thread_ts,
            user: "U2",
            text: "Please review the fix.",
            reply_count: 1,
            reply_users_count: 1,
            latest_reply: reply.ts,
            reply_users: ["U1"],
          },
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 replied in channel C1, thread 1700000000.000001: The fix is ready.",
    });
  });

  test("a reply with a file", async () => {
    const client = new WebClient("test-token");
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: {
        team_id: "T1",
        event: {
          ...reply,
          channel_type: "channel",
          subtype: "file_share",
          text: "Here is the build log.",
          files: [{ id: "F1", name: "build.log", title: "Build log", mimetype: "text/plain" }],
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 replied in channel C1, thread 1700000000.000001: Here is the build log.\nFiles: F1.",
    });
  });

  test("an edited reply without a channel type", async () => {
    const client = new WebClient("test-token");
    const info = mock(async (_args: ConversationsInfoArguments) => ({
      ok: true,
      channel: { id: "C1", is_private: true },
    }));
    client.conversations.info = info;
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: {
        team_id: "T1",
        event: {
          type: "message",
          subtype: "message_changed",
          channel: "C1",
          hidden: true,
          ts: "1700000002.000001",
          event_ts: "1700000002.000001",
          message: { ...reply, text: "The fix is merged.", edited: { user: "U1", ts: "1700000002.000001" } },
          previous_message: reply,
        },
      },
    });

    expect(info).toHaveBeenCalledWith({ channel: "C1" });
    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 edited a reply in channel C1, thread 1700000000.000001: The fix is merged.",
    });
  });

  test("an edit without content changes needs no channel lookup", async () => {
    const client = new WebClient("test-token");
    const info = mock(async (_args: ConversationsInfoArguments) => ({
      ok: true,
      channel: { id: "C1", is_private: true },
    }));
    client.conversations.info = info;
    const { message } = createMessageEvents(client, {} as IntegrationContext);

    const result = await message.execute({
      id: "Ev1",
      name: "message",
      payload: {
        team_id: "T1",
        event: {
          type: "message",
          subtype: "message_changed",
          channel: "C1",
          hidden: true,
          ts: "1700000002.000001",
          event_ts: "1700000002.000001",
          message: { ...reply, edited: { user: "U1", ts: "1700000002.000001" } },
          previous_message: reply,
        },
      },
    });

    expect(result).toBeUndefined();
    expect(info).not.toHaveBeenCalled();
  });
});
