import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { parseWorkflowDefinition } from "./definition.ts";
import { createWorkflowStore, type WorkflowStore, workflows } from "./store.ts";

// Generate setup SQL from the actual table definition, not a second schema.
const statements = await generateSQLiteMigration(
  await generateSQLiteDrizzleJson({}),
  await generateSQLiteDrizzleJson({ workflows }),
);

let sqlite: Database;
let store: WorkflowStore;

beforeEach(() => {
  sqlite = new Database(":memory:");
  for (const statement of statements) sqlite.run(statement);
  store = createWorkflowStore(drizzle(sqlite));
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
