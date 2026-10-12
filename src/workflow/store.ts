import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { database } from "../database.ts";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./definition.ts";

export const workflows = sqliteTable("workflows", {
  id: integer().primaryKey({ autoIncrement: true }),
  source: text().notNull(),
  definition: text({ mode: "json" }).$type<WorkflowDefinition>().notNull(),
});

export const workflowSessions = sqliteTable("workflow_sessions", {
  id: integer().primaryKey({ autoIncrement: true }),
  workflowId: integer("workflow_id").notNull(),
  subjects: text({ mode: "json" }).$type<string[]>().notNull(),
  conversationId: text("conversation_id").notNull().unique(),
  definition: text({ mode: "json" }).$type<WorkflowDefinition>().notNull(),
});

export type WorkflowSession = typeof workflowSessions.$inferSelect;

export function createWorkflowStore<TSchema extends Record<string, unknown>>(database: BunSQLiteDatabase<TSchema>) {
  return {
    register(sources: readonly string[]): void {
      // Validate everything before touching the current registry.
      const rows = sources.map((source) => ({ source, definition: parseWorkflowDefinition(source) }));

      database.transaction((transaction) => {
        transaction.delete(workflows).run();
        if (rows.length > 0) transaction.insert(workflows).values(rows).run();
      });
    },

    findByEvent(event: string): number[] {
      return database
        .select({
          id: workflows.id,
          definition: workflows.definition,
        })
        .from(workflows)
        .all()
        .filter(({ definition }) => Object.hasOwn(definition.on, event))
        .map(({ id }) => id);
    },

    getDefinition(id: number): WorkflowDefinition | undefined {
      return database.select({ definition: workflows.definition }).from(workflows).where(eq(workflows.id, id)).get()
        ?.definition;
    },
  };
}

export function createWorkflowSessionStore<TSchema extends Record<string, unknown>>(
  database: BunSQLiteDatabase<TSchema>,
) {
  return {
    create(session: Omit<WorkflowSession, "id">): WorkflowSession {
      return database.insert(workflowSessions).values(session).returning().get();
    },

    get(id: number): WorkflowSession | undefined {
      return database.select().from(workflowSessions).where(eq(workflowSessions.id, id)).get();
    },

    list(): WorkflowSession[] {
      return database.select().from(workflowSessions).orderBy(workflowSessions.id).all();
    },
  };
}

export const workflow = createWorkflowStore(database);
export const workflowSession = createWorkflowSessionStore(database);

export type WorkflowStore = ReturnType<typeof createWorkflowStore>;
export type WorkflowSessionStore = ReturnType<typeof createWorkflowSessionStore>;
