import { describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openDatabase } from "../database.ts";
import { SqliteWorkspaceStore } from "./sqlite-store.ts";
import type { WorkspaceRecord } from "./store.ts";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const MINUTE = 60 * 1_000;

describe("SqliteWorkspaceStore", () => {
  test("persists workspace records and rejects duplicate IDs", async () => {
    const store = workspaceStore();
    const record = workspaceRecord("workflow-1");

    expect(await store.create(record, BACKGROUND_CONTEXT)).toBeTrue();
    expect(await store.create(record, BACKGROUND_CONTEXT)).toBeFalse();
    expect(await store.get(record.id, BACKGROUND_CONTEXT)).toEqual(record);
    expect(await store.get("missing", BACKGROUND_CONTEXT)).toBeUndefined();
  });

  test("replaces and deletes only the expected version", async () => {
    const store = workspaceStore();
    const record = workspaceRecord("workflow-1");
    await store.create(record, BACKGROUND_CONTEXT);
    const suspended: WorkspaceRecord = {
      ...record,
      state: "suspended",
      stateChangedAt: after(NOW, MINUTE),
      version: 1,
    };

    expect(await store.replace(suspended, 7, BACKGROUND_CONTEXT)).toBeFalse();
    expect(await store.replace(suspended, 0, BACKGROUND_CONTEXT)).toBeTrue();
    expect(await store.get(record.id, BACKGROUND_CONTEXT)).toEqual(suspended);

    expect(await store.delete(record.id, 0, BACKGROUND_CONTEXT)).toBeFalse();
    expect(await store.delete(record.id, 1, BACKGROUND_CONTEXT)).toBeTrue();
    expect(await store.get(record.id, BACKGROUND_CONTEXT)).toBeUndefined();
  });

  test("finds expired, idle, and abandoned workspaces", async () => {
    const store = workspaceStore();
    const staleBefore = after(NOW, -30 * MINUTE);
    const records = [
      workspaceRecord("expired", { state: "suspended", expiresAt: NOW }),
      workspaceRecord("idle", { suspendAt: NOW }),
      workspaceRecord("abandoned", { state: "resuming", stateChangedAt: staleBefore }),
      workspaceRecord("active"),
      workspaceRecord("resuming", { state: "resuming", stateChangedAt: after(staleBefore, 1) }),
      workspaceRecord("suspended", { state: "suspended" }),
    ];
    for (const record of records) await store.create(record, BACKGROUND_CONTEXT);

    const due = await store.findDue(NOW, staleBefore, 10, BACKGROUND_CONTEXT);
    expect(due.map(({ id }) => id).sort()).toEqual(["abandoned", "expired", "idle"]);
    expect(await store.findDue(NOW, staleBefore, 2, BACKGROUND_CONTEXT)).toHaveLength(2);
  });
});

function workspaceStore(): SqliteWorkspaceStore {
  return new SqliteWorkspaceStore(openDatabase(":memory:"));
}

function workspaceRecord(id: string, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id,
    state: "active",
    stateChangedAt: NOW,
    createdAt: NOW,
    initializedAt: NOW,
    lastActiveAt: NOW,
    suspendAt: after(NOW, 5 * MINUTE),
    expiresAt: after(NOW, 7 * 24 * 60 * MINUTE),
    version: 0,
    ...overrides,
  };
}

function after(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
