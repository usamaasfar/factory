import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./database-schema.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function openDatabase(path: string) {
  const sqlite = new Database(path, { create: true, strict: true });

  // Foreign keys are disabled by default for each SQLite connection.
  sqlite.run("PRAGMA foreign_keys = ON");

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder });
  return database;
}

export type FactoryDatabase = ReturnType<typeof openDatabase>;
