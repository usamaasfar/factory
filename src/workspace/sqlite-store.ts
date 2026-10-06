import type { Context } from "@earendil-works/chord";
import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import type { FactoryDatabase } from "../database.ts";
import { workspaces } from "../database-schema.ts";
import type { WorkspaceRecord, WorkspaceStore } from "./store.ts";

const TRANSITIONAL_STATES = ["initializing", "resuming", "suspending", "destroying"] as const;

/** SQLite-backed workspace metadata with optimistic version checks. */
export class SqliteWorkspaceStore implements WorkspaceStore {
  readonly #database: FactoryDatabase;

  constructor(database: FactoryDatabase) {
    this.#database = database;
  }

  async create(record: WorkspaceRecord, context: Context): Promise<boolean> {
    context.abortSignal?.throwIfAborted();
    const inserted = this.#database
      .insert(workspaces)
      .values(toRow(record))
      .onConflictDoNothing()
      .returning({ id: workspaces.id })
      .get();
    return inserted !== undefined;
  }

  async get(id: string, context: Context): Promise<WorkspaceRecord | undefined> {
    context.abortSignal?.throwIfAborted();
    const row = this.#database.select().from(workspaces).where(eq(workspaces.id, id)).get();
    return row ? fromRow(row) : undefined;
  }

  async replace(record: WorkspaceRecord, expectedVersion: number, context: Context): Promise<boolean> {
    context.abortSignal?.throwIfAborted();
    const updated = this.#database
      .update(workspaces)
      .set(toRow(record))
      .where(and(eq(workspaces.id, record.id), eq(workspaces.version, expectedVersion)))
      .returning({ id: workspaces.id })
      .get();
    return updated !== undefined;
  }

  async delete(id: string, expectedVersion: number, context: Context): Promise<boolean> {
    context.abortSignal?.throwIfAborted();
    const deleted = this.#database
      .delete(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.version, expectedVersion)))
      .returning({ id: workspaces.id })
      .get();
    return deleted !== undefined;
  }

  async findDue(now: Date, staleBefore: Date, limit: number, context: Context): Promise<WorkspaceRecord[]> {
    context.abortSignal?.throwIfAborted();
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError("Workspace query limit must be positive");

    return this.#database
      .select()
      .from(workspaces)
      .where(
        or(
          lte(workspaces.expiresAt, now),
          and(eq(workspaces.state, "active"), lte(workspaces.suspendAt, now)),
          and(inArray(workspaces.state, TRANSITIONAL_STATES), lte(workspaces.stateChangedAt, staleBefore)),
        ),
      )
      .orderBy(asc(workspaces.expiresAt), asc(workspaces.id))
      .limit(limit)
      .all()
      .map(fromRow);
  }
}

function toRow(record: WorkspaceRecord): typeof workspaces.$inferInsert {
  return {
    ...record,
    initializedAt: record.initializedAt ?? null,
  };
}

function fromRow(row: typeof workspaces.$inferSelect): WorkspaceRecord {
  return {
    ...row,
    initializedAt: row.initializedAt ?? undefined,
  };
}
