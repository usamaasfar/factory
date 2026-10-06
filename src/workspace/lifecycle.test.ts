import { describe, expect, test } from "bun:test";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { FactorySandbox } from "../sandbox/factory-sandbox.ts";
import type { SandboxProvider } from "../sandbox/provider.ts";
import { WorkspaceLifecycle } from "./lifecycle.ts";
import type { WorkspaceRecord, WorkspaceStore } from "./store.ts";

const IDLE_TIMEOUT = 5 * 60 * 1_000;
const OPERATION_TIMEOUT = 30 * 60 * 1_000;
const RETENTION = 7 * 24 * 60 * 60 * 1_000;

describe("WorkspaceLifecycle", () => {
  test("initializes a new workspace exactly once", async () => {
    const fixture = workspaceFixture();
    let initializations = 0;

    const env = await fixture.lifecycle.create(
      "workflow-1",
      async () => {
        initializations += 1;
      },
      BACKGROUND_CONTEXT,
    );

    expect(env.id).toBe("test:workflow-1");
    expect(initializations).toBe(1);
    expect(fixture.provider.hasCompute("workflow-1")).toBeTrue();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
    expect(fixture.store.record("workflow-1")).toMatchObject({
      state: "active",
      stateChangedAt: fixture.now(),
      createdAt: fixture.now(),
      initializedAt: fixture.now(),
      lastActiveAt: fixture.now(),
      suspendAt: after(fixture.now(), IDLE_TIMEOUT),
      expiresAt: after(fixture.now(), RETENTION),
    });

    expect(
      fixture.lifecycle.create(
        "workflow-1",
        async () => {
          initializations += 1;
        },
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("Workspace already exists");
    expect(initializations).toBe(1);
  });

  test("ensures initialization once and retries after a failed attempt", async () => {
    const fixture = workspaceFixture();
    let attempts = 0;
    const initialize = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("invalid checkout");
    };

    expect(fixture.lifecycle.ensure("workflow-1", initialize, BACKGROUND_CONTEXT)).rejects.toThrow("invalid checkout");
    await fixture.lifecycle.ensure("workflow-1", initialize, BACKGROUND_CONTEXT);
    await fixture.lifecycle.ensure("workflow-1", initialize, BACKGROUND_CONTEXT);
    await fixture.lifecycle.suspend("workflow-1", BACKGROUND_CONTEXT);
    await fixture.lifecycle.ensure("workflow-1", initialize, BACKGROUND_CONTEXT);

    expect(attempts).toBe(2);
    expect(fixture.store.required("workflow-1").state).toBe("suspended");
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
  });

  test("releases compute and resumes the same persistent workspace", async () => {
    const fixture = workspaceFixture();
    let initializations = 0;
    await fixture.lifecycle.create(
      "workflow-1",
      async () => {
        initializations += 1;
      },
      BACKGROUND_CONTEXT,
    );
    const originalExpiration = fixture.store.required("workflow-1").expiresAt;

    await fixture.lifecycle.suspend("workflow-1", BACKGROUND_CONTEXT);
    await fixture.lifecycle.suspend("workflow-1", BACKGROUND_CONTEXT);
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
    expect(fixture.store.required("workflow-1")).toMatchObject({
      state: "suspended",
      expiresAt: originalExpiration,
    });

    fixture.advance(60 * 60 * 1_000);
    const resumed = await fixture.lifecycle.open("workflow-1", BACKGROUND_CONTEXT);
    expect(resumed.id).toBe("test:workflow-1");
    expect(initializations).toBe(1);
    expect(fixture.provider.hasCompute("workflow-1")).toBeTrue();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
    expect(fixture.store.required("workflow-1")).toMatchObject({
      state: "active",
      lastActiveAt: fixture.now(),
      suspendAt: after(fixture.now(), IDLE_TIMEOUT),
      expiresAt: after(fixture.now(), RETENTION),
    });

    fixture.advance(60_000);
    await fixture.lifecycle.touch("workflow-1", BACKGROUND_CONTEXT);
    expect(fixture.store.required("workflow-1")).toMatchObject({
      lastActiveAt: fixture.now(),
      suspendAt: after(fixture.now(), IDLE_TIMEOUT),
      expiresAt: after(fixture.now(), RETENTION),
    });
  });

  test("removes partial resources when initialization fails", async () => {
    const fixture = workspaceFixture();

    expect(
      fixture.lifecycle.create(
        "workflow-1",
        async () => {
          throw new Error("invalid checkout");
        },
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("invalid checkout");

    expect(fixture.store.record("workflow-1")).toBeUndefined();
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeFalse();
  });

  test("returns a failed resume to a suspended state", async () => {
    const fixture = workspaceFixture();
    await fixture.lifecycle.create("workflow-1", async () => {}, BACKGROUND_CONTEXT);
    await fixture.lifecycle.suspend("workflow-1", BACKGROUND_CONTEXT);

    fixture.provider.failNextOpen = true;
    expect(fixture.lifecycle.open("workflow-1", BACKGROUND_CONTEXT)).rejects.toThrow("compute unavailable");

    expect(fixture.store.required("workflow-1").state).toBe("suspended");
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
  });

  test("sweeps idle compute and expired storage", async () => {
    const fixture = workspaceFixture();
    await fixture.lifecycle.create("workflow-1", async () => {}, BACKGROUND_CONTEXT);

    await fixture.lifecycle.sweep(BACKGROUND_CONTEXT);
    expect(fixture.store.required("workflow-1").state).toBe("active");

    fixture.advance(IDLE_TIMEOUT);
    await fixture.lifecycle.sweep(BACKGROUND_CONTEXT);
    expect(fixture.store.required("workflow-1").state).toBe("suspended");
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();

    fixture.advance(RETENTION - IDLE_TIMEOUT);
    await fixture.lifecycle.sweep(BACKGROUND_CONTEXT);
    expect(fixture.store.record("workflow-1")).toBeUndefined();
    expect(fixture.provider.hasStorage("workflow-1")).toBeFalse();
  });

  test("recovers an abandoned resume by suspending its compute", async () => {
    const fixture = workspaceFixture();
    await fixture.lifecycle.create("workflow-1", async () => {}, BACKGROUND_CONTEXT);
    await fixture.lifecycle.suspend("workflow-1", BACKGROUND_CONTEXT);

    const suspended = fixture.store.required("workflow-1");
    await fixture.store.replace(
      {
        ...suspended,
        state: "resuming",
        stateChangedAt: fixture.now(),
        version: suspended.version + 1,
      },
      suspended.version,
      BACKGROUND_CONTEXT,
    );
    await fixture.provider.open("workflow-1", BACKGROUND_CONTEXT);

    fixture.advance(OPERATION_TIMEOUT);
    await fixture.lifecycle.sweep(BACKGROUND_CONTEXT);
    expect(fixture.store.required("workflow-1").state).toBe("suspended");
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeTrue();
  });

  test("permanently destroys compute, storage, and lifecycle state", async () => {
    const fixture = workspaceFixture();
    await fixture.lifecycle.create("workflow-1", async () => {}, BACKGROUND_CONTEXT);

    await fixture.lifecycle.destroy("workflow-1", BACKGROUND_CONTEXT);
    await fixture.lifecycle.destroy("workflow-1", BACKGROUND_CONTEXT);

    expect(fixture.store.record("workflow-1")).toBeUndefined();
    expect(fixture.provider.hasCompute("workflow-1")).toBeFalse();
    expect(fixture.provider.hasStorage("workflow-1")).toBeFalse();
  });
});

function workspaceFixture() {
  const provider = new FakeSandboxProvider();
  const store = new InMemoryWorkspaceStore();
  let currentTime = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(currentTime);

  return {
    provider,
    store,
    now,
    advance(milliseconds: number) {
      currentTime = after(currentTime, milliseconds);
    },
    lifecycle: new WorkspaceLifecycle({
      provider,
      store,
      idleTimeoutMs: IDLE_TIMEOUT,
      operationTimeoutMs: OPERATION_TIMEOUT,
      retentionMs: RETENTION,
      now,
    }),
  };
}

class InMemoryWorkspaceStore implements WorkspaceStore {
  readonly #records = new Map<string, WorkspaceRecord>();

  async create(record: WorkspaceRecord, _context: Context): Promise<boolean> {
    if (this.#records.has(record.id)) return false;
    this.#records.set(record.id, record);
    return true;
  }

  async get(id: string, _context: Context): Promise<WorkspaceRecord | undefined> {
    return this.#records.get(id);
  }

  async replace(record: WorkspaceRecord, expectedVersion: number, _context: Context): Promise<boolean> {
    const current = this.#records.get(record.id);
    if (!current || current.version !== expectedVersion) return false;
    this.#records.set(record.id, record);
    return true;
  }

  async delete(id: string, expectedVersion: number, _context: Context): Promise<boolean> {
    const current = this.#records.get(id);
    if (!current || current.version !== expectedVersion) return false;
    return this.#records.delete(id);
  }

  async findDue(now: Date, staleBefore: Date, limit: number, _context: Context): Promise<WorkspaceRecord[]> {
    return [...this.#records.values()]
      .filter(
        (record) =>
          record.expiresAt <= now ||
          (record.state === "active" && record.suspendAt <= now) ||
          (isTransition(record.state) && record.stateChangedAt <= staleBefore),
      )
      .slice(0, limit);
  }

  record(id: string): WorkspaceRecord | undefined {
    return this.#records.get(id);
  }

  required(id: string): WorkspaceRecord {
    const record = this.record(id);
    if (!record) throw new Error(`Missing test workspace: ${id}`);
    return record;
  }
}

class FakeSandboxProvider implements SandboxProvider {
  readonly #compute = new Set<string>();
  readonly #storage = new Set<string>();
  failNextOpen = false;

  async open(key: string, _context: Context): Promise<FactorySandbox> {
    this.#storage.add(key);
    this.#compute.add(key);
    if (this.failNextOpen) {
      this.failNextOpen = false;
      throw new Error("compute unavailable");
    }
    return new FactorySandbox({
      id: `test:${key}`,
      cwd: "/workspace",
      run: async () => ({ exitCode: 0 }),
    });
  }

  async suspend(key: string, _context: Context): Promise<void> {
    this.#compute.delete(key);
  }

  async destroy(key: string, _context: Context): Promise<void> {
    this.#compute.delete(key);
    this.#storage.delete(key);
  }

  hasCompute(key: string): boolean {
    return this.#compute.has(key);
  }

  hasStorage(key: string): boolean {
    return this.#storage.has(key);
  }
}

function after(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function isTransition(state: WorkspaceRecord["state"]): boolean {
  return state === "initializing" || state === "resuming" || state === "suspending" || state === "destroying";
}
