import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openDatabase } from "./database.ts";
import { openDurable } from "./durable.ts";
import { GitHubApp } from "./integrations/github/index.ts";
import { createServer } from "./server.ts";

const databasePath = Bun.env.DATABASE_PATH ?? ".factory/state/factory.sqlite";
if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

const database = openDatabase(databasePath);
const github = new GitHubApp({
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY"),
});

const models = createModels();
models.setProvider(deepseekProvider());
const durable = await openDurable(
  Bun.env.PI_DATABASE_PATH ?? ".factory/state/pi.sqlite",
  { models, image: Bun.env.SANDBOX_IMAGE ?? "debian:bookworm-slim" },
  BACKGROUND_CONTEXT,
);

const app = createServer({
  github,
  database,
  durable,
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
