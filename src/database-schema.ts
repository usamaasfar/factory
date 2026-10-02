import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Workflow } from "./workflows.ts";

export const repositories = sqliteTable(
  "repositories",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    provider: text().notNull(),
    providerId: text("provider_id").notNull(),
    installationId: text("installation_id").notNull(),
    owner: text().notNull(),
    name: text().notNull(),
    defaultBranch: text("default_branch").notNull(),
    workflowRevision: text("workflow_revision").notNull(),
  },
  (table) => [uniqueIndex("repositories_provider_id").on(table.provider, table.providerId)],
);

export const workflows = sqliteTable(
  "workflows",
  {
    repositoryId: integer("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    path: text().notNull(),
    revision: text().notNull(),
    source: text().notNull(),
    // Keep validated JSON beside the original source so execution does not parse YAML again.
    definition: text({ mode: "json" }).$type<Workflow>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.repositoryId, table.path] })],
);
