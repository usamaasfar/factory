import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openDatabase } from "./database.ts";
import { openDurable } from "./durable.ts";
import { GitHubApp } from "./integrations/github/index.ts";
import { createServer } from "./server.ts";

const database = openDatabase(required(Bun.env.FACTORY_DATABASE_PATH as string));
const github = new GitHubApp({
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY"),
  login: required("GITHUB_APP_LOGIN"),
});

const models = createModels();
models.setProvider(deepseekProvider());
const durable = await openDurable(
  required(Bun.env.PI_DATABASE_PATH as string),
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
