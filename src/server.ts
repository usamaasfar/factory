import { Hono } from "hono";
import type { FactoryDatabase } from "./database.ts";
import type { GitHubApp } from "./integrations/github/index.ts";
import { receiveGitHubWebhook } from "./integrations/github/webhooks.ts";
import { registerGitHubWorkflows } from "./workflow-registration.ts";

export type ServerOptions = {
  github: GitHubApp;
  database: FactoryDatabase;
  githubWebhookSecret: string;
};

/** Creates Factory's HTTP boundary without owning provider or workflow logic. */
export function createServer(options: ServerOptions): Hono {
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok" }));

  app.post("/webhooks/github", async (context) => {
    // Signature verification must consume the original request body.
    const event = await receiveGitHubWebhook(context.req.raw, options.githubWebhookSecret);
    if (!event) return context.body(null, 204);

    await registerGitHubWorkflows(options.github, options.database, event);
    if ("prompt" in event) console.info(`Received GitHub workflow event ${event.name} (${event.deliveryId})`);

    return context.body(null, 202);
  });

  app.onError((error, context) => {
    console.error("HTTP request failed", error);
    return context.json({ error: "Internal server error" }, 500);
  });

  return app;
}
