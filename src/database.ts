import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

export function openDatabase(path = ":memory:") {
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  return drizzle(sqlite);
}

export const database = openDatabase();

export type FactoryDatabase = ReturnType<typeof openDatabase>;
