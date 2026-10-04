import type { Context } from "@earendil-works/chord";
import type { FactoryDatabase } from "../../database.ts";
import type { Durable } from "../../durable.ts";
import { registerGitHubWorkflows } from "../../workflow-registration.ts";
import { findRegisteredWorkflows } from "../../workflow-registry.ts";
import { openWorkflowConversation, submitWorkflowEvent } from "../../workflow-runner.ts";
import { findOrCreateWorkflowSession } from "../../workflow-sessions.ts";
import type { GitHubApp } from "./index.ts";
import { type GitHubEvent, getGitHubEventRoute } from "./webhooks.ts";
import { prepareGitHubWorkspace } from "./workflow.ts";

export interface GitHubEventHandlerOptions {
  github: GitHubApp;
  database: FactoryDatabase;
  durable: Durable;
}

/** Applies one verified GitHub event to workflow registration and matching conversations. */
export async function handleGitHubEvent(
  options: GitHubEventHandlerOptions,
  event: GitHubEvent,
  context: Context,
): Promise<void> {
  await registerGitHubWorkflows(options.github, options.database, event);
  if (!("prompt" in event)) return;

  const trigger = `github.${event.name}`;
  const workflows = findRegisteredWorkflows(options.database, {
    provider: "github",
    repositoryId: String(event.payload.repository.id),
    event: trigger,
  });
  const route = getGitHubEventRoute(event);
  if (!route) return;

  console.info(`Received GitHub workflow event ${event.name} (${event.deliveryId})`);
  for (const workflow of workflows) {
    console.info(`Matched ${workflow.path} for ${trigger}`);
    const { session, created } = findOrCreateWorkflowSession(options.database, {
      repositoryId: workflow.repositoryId,
      workflowPath: workflow.path,
      workflowRevision: workflow.revision,
      workflowDefinition: workflow.definition,
      origin: route,
    });
    console.info(`${created ? "Created" : "Found"} workflow session ${session.id}`);

    const conversation = await openWorkflowConversation(options.durable.harness, options.database, session, context);
    await prepareGitHubWorkspace(options.github, options.durable.sandboxes, event, conversation.id, context);
    await submitWorkflowEvent(conversation, { id: `github:${event.deliveryId}`, prompt: event.prompt }, context);
  }
}
