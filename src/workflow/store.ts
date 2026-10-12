import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { parseWorkflowDefinition, type WorkflowDefinition } from "./definition.ts";

export const workflows = sqliteTable("workflows", {
  id: integer().primaryKey({ autoIncrement: true }),
  source: text().notNull(),
  definition: text("definition", { mode: "json" }).$type<WorkflowDefinition>().notNull(),
});

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

export type WorkflowStore = ReturnType<typeof createWorkflowStore>;
