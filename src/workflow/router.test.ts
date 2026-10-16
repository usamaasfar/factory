import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { WebClient } from "@slack/web-api";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import type { IntegrationContext } from "factory-oss/integration";
import { createMessageEvents } from "../../integrations/slack/events/message.ts";
import { database } from "../database.ts";
import { workflowRouter } from "./router.ts";
import { workflow, workflowSession, workflowSessions, workflows } from "./store.ts";

const statements = await generateSQLiteMigration(
  await generateSQLiteDrizzleJson({}),
  await generateSQLiteDrizzleJson({ workflows, workflowSessions }),
);

const source = `
name: Review
on:
  github.pull_request.opened:
permissions: {}
agent:
  provider: openai
  model: test
  instructions: Review the change.
`;
const event = {
  name: "github.pull_request.opened",
  subject: "github:repository:123:pull_request:42",
};

beforeAll(() => {
  for (const statement of statements) {
    database.$client.run(statement.replace(/^CREATE (TABLE|UNIQUE INDEX) /, "CREATE $1 IF NOT EXISTS "));
  }
});

beforeEach(() => {
  workflow.register([source]);
});

afterEach(() => {
  database.delete(workflowSessions).run();
  database.delete(workflows).run();
});

describe("workflow routing", () => {
  test("reuses a thread session even when its first event is a reply", async () => {
    workflow.register([source.replace("github.pull_request.opened:", "slack.message:")]);
    const { message, appMention } = createMessageEvents(new WebClient("test-token"), {} as IntegrationContext);
    const reply = {
      type: "message",
      channel_type: "channel",
      channel: "C1",
      user: "U1",
      text: "Check the sandbox.",
      thread_ts: "1700000000.000001",
      ts: "1700000001.000001",
    };
    const first = await message.execute({
      id: "Ev1",
      name: "message",
      payload: { team_id: "T1", event: reply },
    });
    if (!first) throw new Error("Expected a resolved Slack reply");
    const ids = await workflowRouter({ name: "slack.message", subject: `slack:${first.subject}` });
    const session = workflowSession.list()[0];
    if (!session) throw new Error("Expected a workflow session");

    const followUp = await message.execute({
      id: "Ev2",
      name: "message",
      payload: { team_id: "T1", event: { ...reply, ts: "1700000002.000001" } },
    });
    if (!followUp) throw new Error("Expected a resolved Slack follow-up");
    expect(await workflowRouter({ name: "slack.message", subject: `slack:${followUp.subject}` })).toEqual(ids);
    expect(workflowSession.list()).toEqual([session]);

    const mention = await appMention.execute({
      id: "Ev3",
      name: "app_mention",
      payload: { team_id: "T1", event: { ...reply, type: "app_mention", ts: "1700000003.000001" } },
    });
    if (!mention) throw new Error("Expected a resolved Slack mention");
    expect(await workflowRouter({ name: "slack.app_mention", subject: `slack:${mention.subject}` })).toEqual(ids);

    const other = await message.execute({
      id: "Ev4",
      name: "message",
      payload: { team_id: "T1", event: { ...reply, thread_ts: "1700000010.000001", ts: "1700000011.000001" } },
    });
    if (!other) throw new Error("Expected a resolved reply in another thread");
    expect(await workflowRouter({ name: "slack.message", subject: `slack:${other.subject}` })).not.toEqual(ids);
    expect(workflowSession.list()).toHaveLength(2);
  });

  test("creates a session when no route exists", async () => {
    const ids = await workflowRouter(event);
    const sessions = workflowSession.list();

    expect(sessions).toHaveLength(1);
    expect(ids).toEqual(sessions.map((session) => session.id));
  });

  test("returns the existing session for a matching subject", async () => {
    const ids = await workflowRouter(event);
    const sessions = workflowSession.list();

    expect(
      await workflowRouter({
        name: "github.issue_comment.created",
        subject: `${event.subject}:comment:100`,
      }),
    ).toEqual(ids);
    expect(workflowSession.list()).toEqual(sessions);
  });
});
