import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openDatabase } from "../database.ts";
import type { WorkflowDefinition } from "./definition.ts";
import { SqliteWorkflowStore } from "./sqlite-store.ts";

const definition: WorkflowDefinition = {
  name: "Review",
  on: { "github.pull_request.opened": {} },
  agent: {
    environment: "base.linux",
    resources: { cpu: 2, memory: 4 },
    provider: "openai",
    model: "test-model",
    instructions: "Review the change.",
  },
};

describe("SqliteWorkflowStore", () => {
  test("atomically replaces and matches repository snapshots", async () => {
    const store = workflowStore();
    await store.replaceSnapshot(snapshot("one", ["review.yml", "other.yml"]), BACKGROUND_CONTEXT);

    const matched = await store.findRegistrations(
      { provider: "github", repositoryId: "42", event: "github.pull_request.opened" },
      BACKGROUND_CONTEXT,
    );
    expect(matched.map(({ path }) => path).sort()).toEqual([
      ".factory/workflows/other.yml",
      ".factory/workflows/review.yml",
    ]);

    await store.replaceSnapshot(snapshot("two", ["review.yml"]), BACKGROUND_CONTEXT);
    const replaced = await store.findRegistrations(
      { provider: "github", repositoryId: "42", event: "github.pull_request.opened" },
      BACKGROUND_CONTEXT,
    );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ path: ".factory/workflows/review.yml", revision: "two" });
    expect(
      await store.findRegistrations(
        { provider: "github", repositoryId: "42", event: "github.issues.opened" },
        BACKGROUND_CONTEXT,
      ),
    ).toEqual([]);
  });

  test("keeps stable session identity and attaches one conversation", async () => {
    const store = workflowStore();
    await store.replaceSnapshot(snapshot("one", ["review.yml"]), BACKGROUND_CONTEXT);
    const [registration] = await store.findRegistrations(
      { provider: "github", repositoryId: "42", event: "github.pull_request.opened" },
      BACKGROUND_CONTEXT,
    );
    if (!registration) throw new Error("Missing registration");

    const options = {
      registration,
      origin: { provider: "github", subject: "repository:42:pull_request:7" },
    };
    const first = await store.findOrCreateSession(options, BACKGROUND_CONTEXT);
    const second = await store.findOrCreateSession(options, BACKGROUND_CONTEXT);
    expect(first.created).toBeTrue();
    expect(second.created).toBeFalse();
    expect(second.session.id).toBe(first.session.id);

    expect(await store.assignConversation(first.session.id, "10", BACKGROUND_CONTEXT)).toBe("10");
    expect(await store.assignConversation(first.session.id, "11", BACKGROUND_CONTEXT)).toBe("10");
    expect(await store.findSessionByConversation("10", BACKGROUND_CONTEXT)).toMatchObject({ id: first.session.id });
    expect((await store.findSessionsByRoute(options.origin, BACKGROUND_CONTEXT)).map(({ id }) => id)).toEqual([
      first.session.id,
    ]);
  });
});

function workflowStore(): SqliteWorkflowStore {
  return new SqliteWorkflowStore(openDatabase(":memory:"));
}

function snapshot(revision: string, paths: string[]) {
  return {
    repository: {
      provider: "github",
      providerId: "42",
    },
    revision,
    workflows: paths.map((path) => ({ path: `.factory/workflows/${path}`, source: path, definition })),
  };
}
