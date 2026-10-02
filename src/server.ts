import { Hono } from "hono";
import type { FactoryDatabase } from "./database.ts";
import type { GitHubApp } from "./integrations/github/index.ts";
import { getGitHubEventRoute, receiveGitHubWebhook } from "./integrations/github/webhooks.ts";
import { registerGitHubWorkflows } from "./workflow-registration.ts";
import { findRegisteredWorkflows } from "./workflow-registry.ts";
import { findOrCreateWorkflowSession } from "./workflow-sessions.ts";

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

    if ("prompt" in event) {
      const trigger = `github.${event.name}`;
      const matched = findRegisteredWorkflows(options.database, {
        provider: "github",
        repositoryId: String(event.payload.repository.id),
        event: trigger,
      });

      console.info(`Received GitHub workflow event ${event.name} (${event.deliveryId})`);
      const route = getGitHubEventRoute(event);
      for (const workflow of matched) {
        console.info(`Matched ${workflow.path} for ${trigger}`);
        if (!route) continue;

        const result = findOrCreateWorkflowSession(options.database, {
          repositoryId: workflow.repositoryId,
          workflowPath: workflow.path,
          workflowRevision: workflow.revision,
          workflowDefinition: workflow.definition,
          origin: route,
        });
        console.info(`${result.created ? "Created" : "Found"} workflow session ${result.session.id}`);
      }
    }

    return context.body(null, 202);
  });

  app.onError((error, context) => {
    console.error("HTTP request failed", error);
    return context.json({ error: "Internal server error" }, 500);
  });

  return app;
}
