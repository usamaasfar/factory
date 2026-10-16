import { describe, expect, mock, test } from "bun:test";
import { type ReactionsGetArguments, WebClient } from "@slack/web-api";
import type { IntegrationContext } from "factory-oss/integration";
import { createReactionEvents } from "./reactions.ts";

const reaction = {
  user: "U1",
  reaction: "eyes",
  item_user: "U2",
  event_ts: "1700000002.000001",
};

describe("reaction_added", () => {
  test("on a thread reply", async () => {
    const client = new WebClient("test-token");
    const getReaction = mock(async (_args: ReactionsGetArguments) => ({
      ok: true,
      type: "message",
      message: { ts: "1700000001.000001", thread_ts: "1700000000.000001" },
    }));
    client.reactions.get = getReaction;
    const { added } = createReactionEvents(client, {} as IntegrationContext);

    const result = await added.execute({
      id: "Ev1",
      name: "reaction_added",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_added",
          item: { type: "message", channel: "C1", ts: "1700000001.000001" },
        },
      },
    });

    expect(getReaction).toHaveBeenCalledWith({ channel: "C1", timestamp: "1700000001.000001" });
    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 added :eyes: to message 1700000001.000001.",
    });
  });

  test("on a file", async () => {
    const client = new WebClient("test-token");
    const { added } = createReactionEvents(client, {} as IntegrationContext);

    const result = await added.execute({
      id: "Ev1",
      name: "reaction_added",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_added",
          item: { type: "file", file: "F1" },
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:file:F1",
      content: "Slack user U1 added :eyes: to file F1.",
    });
  });

  test("on a file comment", async () => {
    const client = new WebClient("test-token");
    const { added } = createReactionEvents(client, {} as IntegrationContext);

    const result = await added.execute({
      id: "Ev1",
      name: "reaction_added",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_added",
          item: { type: "file_comment", file: "F1", file_comment: "Fc1" },
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:file:F1:comment:Fc1",
      content: "Slack user U1 added :eyes: to file comment Fc1.",
    });
  });
});

describe("reaction_removed", () => {
  test("on a thread reply", async () => {
    const client = new WebClient("test-token");
    const getReaction = mock(async (_args: ReactionsGetArguments) => ({
      ok: true,
      type: "message",
      message: { ts: "1700000001.000001", thread_ts: "1700000000.000001" },
    }));
    client.reactions.get = getReaction;
    const { removed } = createReactionEvents(client, {} as IntegrationContext);

    const result = await removed.execute({
      id: "Ev1",
      name: "reaction_removed",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_removed",
          item: { type: "message", channel: "C1", ts: "1700000001.000001" },
        },
      },
    });

    expect(getReaction).toHaveBeenCalledWith({ channel: "C1", timestamp: "1700000001.000001" });
    expect(result).toEqual({
      subject: "workspace:T1:channel:C1:thread:1700000000.000001",
      content: "Slack user U1 removed :eyes: from message 1700000001.000001.",
    });
  });

  test("on a file", async () => {
    const client = new WebClient("test-token");
    const { removed } = createReactionEvents(client, {} as IntegrationContext);

    const result = await removed.execute({
      id: "Ev1",
      name: "reaction_removed",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_removed",
          item: { type: "file", file: "F1" },
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:file:F1",
      content: "Slack user U1 removed :eyes: from file F1.",
    });
  });

  test("on a file comment", async () => {
    const client = new WebClient("test-token");
    const { removed } = createReactionEvents(client, {} as IntegrationContext);

    const result = await removed.execute({
      id: "Ev1",
      name: "reaction_removed",
      payload: {
        team_id: "T1",
        event: {
          ...reaction,
          type: "reaction_removed",
          item: { type: "file_comment", file: "F1", file_comment: "Fc1" },
        },
      },
    });

    expect(result).toEqual({
      subject: "workspace:T1:file:F1:comment:Fc1",
      content: "Slack user U1 removed :eyes: from file comment Fc1.",
    });
  });
});
