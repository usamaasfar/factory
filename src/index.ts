import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "./database.ts";
import { GitHubApp } from "./integrations/github/index.ts";
import { createServer } from "./server.ts";

const databasePath = Bun.env.DATABASE_PATH ?? ".factory/state/factory.sqlite";
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

const github = new GitHubApp({
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY"),
});

const app = createServer({
  github,
  database: openDatabase(databasePath),
  githubWebhookSecret: required("GITHUB_WEBHOOK_SECRET"),
});

/** Fails startup immediately when required deployment configuration is absent. */
function required(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// Bun serves objects exposing the standard Fetch API handler.
export default {
  port: Bun.env.PORT ?? 8080,
  fetch: app.fetch,
};
