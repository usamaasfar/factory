import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { parseWorkflowDefinition } from "./definition.ts";
import {
  createWorkflowSessionStore,
  createWorkflowStore,
  type WorkflowSessionStore,
  type WorkflowStore,
  workflowSessions,
  workflows,
} from "./store.ts";

const statements = await generateSQLiteMigration(
  await generateSQLiteDrizzleJson({}),
  await generateSQLiteDrizzleJson({ workflows, workflowSessions }),
);

let sqlite: Database;
let store: WorkflowStore;
let sessions: WorkflowSessionStore;

beforeEach(() => {
  sqlite = new Database(":memory:");
  for (const statement of statements) sqlite.run(statement);
  const database = drizzle(sqlite);
  store = createWorkflowStore(database);
  sessions = createWorkflowSessionStore(database);
});

afterEach(() => {
  sqlite.close();
});

function workflow(name: string, event: string): string {
  return `
name: ${name}
on:
  ${event}:
permissions: {}
sandbox:
  provider: local
  environment: base.linux
agent:
  provider: openai
  model: test
  instructions: Do the work.
`;
}

describe("workflows", () => {
  test("registers and retrieves a workflow definition", () => {
    const source = workflow("Review", "github.pull_request.opened");
    store.register([source]);

    const ids = store.findByEvent("github.pull_request.opened");
    expect(ids).toHaveLength(1);
    const id = ids[0];
    if (id === undefined) throw new Error("Expected a registered workflow");
    expect(store.getDefinition(id)).toEqual(parseWorkflowDefinition(source));
    expect(store.getDefinition(-1)).toBeUndefined();
  });

  test("finds all workflows subscribed to an event", () => {
    store.register([
      workflow("Review", "github.pull_request.opened"),
      workflow("Check", "github.pull_request.opened"),
      workflow("Triage", "linear.issue.created"),
    ]);

    expect(store.findByEvent("github.pull_request.opened")).toHaveLength(2);
    expect(store.findByEvent("linear.issue.created")).toHaveLength(1);
    expect(store.findByEvent("slack.app_mention")).toEqual([]);
  });

  test("replaces the registry, including with an empty snapshot", () => {
    store.register([workflow("Review", "github.pull_request.opened")]);
    store.register([workflow("Triage", "linear.issue.created")]);

    expect(store.findByEvent("github.pull_request.opened")).toEqual([]);
    expect(store.findByEvent("linear.issue.created")).toHaveLength(1);

    store.register([]);

    expect(store.findByEvent("linear.issue.created")).toEqual([]);
  });

  test("preserves the registry when any definition is invalid", () => {
    store.register([workflow("Review", "github.pull_request.opened")]);
    const ids = store.findByEvent("github.pull_request.opened");

    expect(() => store.register([workflow("Triage", "linear.issue.created"), "name: Invalid"])).toThrow();

    expect(store.findByEvent("github.pull_request.opened")).toEqual(ids);
    expect(store.findByEvent("linear.issue.created")).toEqual([]);
  });
});

describe("workflow sessions", () => {
  const input = {
    workflowId: 1,
    subjects: ["github:repository:123:pull_request:42", "linear:issue:abc123"],
    conversationId: "conversation-1",
    definition: parseWorkflowDefinition(workflow("Review", "github.pull_request.opened")),
  };

  test("creates and retrieves a session", () => {
    const session = sessions.create(input);

    expect(session).toEqual({ ...input, id: expect.any(Number) });
    expect(sessions.get(session.id)).toEqual(session);
    expect(sessions.get(-1)).toBeUndefined();
  });

  test("lists sessions in creation order", () => {
    expect(sessions.list()).toEqual([]);

    const first = sessions.create(input);
    const second = sessions.create({ ...input, conversationId: "conversation-2" });

    expect(sessions.list()).toEqual([first, second]);
  });
});
