import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { WorkflowDefinition } from "./definition.ts";

export const workflows = sqliteTable("workflows", {
  id: integer().primaryKey({ autoIncrement: true }),
  source: text().notNull(),
  definition: text({ mode: "json" }).$type<WorkflowDefinition>().notNull(),
});

export const workflowSessions = sqliteTable("workflow_sessions", {
  id: integer().primaryKey({ autoIncrement: true }),
  workflowId: integer("workflow_id").notNull(),
  subjects: text({ mode: "json" }).$type<string[]>().notNull(),
  conversationId: integer("conversation_id").notNull().unique(),
  definition: text({ mode: "json" }).$type<WorkflowDefinition>().notNull(),
});
