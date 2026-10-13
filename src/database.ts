import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export function openDatabase(path = ":memory:") {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  return drizzle({ client: sqlite });
}

export function initializeDatabase(database: FactoryDatabase): void {
  migrate(database, { migrationsFolder: "drizzle" });
}

export const database = openDatabase();

export type FactoryDatabase = ReturnType<typeof openDatabase>;
