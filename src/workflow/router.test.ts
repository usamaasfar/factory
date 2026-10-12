import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
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
