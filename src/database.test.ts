import { expect, test } from "bun:test";
import { openDatabase } from "./database.ts";

test("opens an in-memory database with the current schema", () => {
  const database = openDatabase(":memory:");

  try {
    const tables = database.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tables.map(({ name }) => name)).toEqual(["__drizzle_migrations", "repositories", "workflows"]);
  } finally {
    database.$client.close();
  }
});
