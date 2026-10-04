import type { Context } from "@earendil-works/chord";
import type { FactoryDatabase } from "../../database.ts";
import type { Durable } from "../../durable.ts";
import { registerGitHubWorkflows } from "../../workflow-registration.ts";
import { findRegisteredWorkflows } from "../../workflow-registry.ts";
import { openWorkflowConversation, submitWorkflowEvent } from "../../workflow-runner.ts";
import { findOrCreateWorkflowSession } from "../../workflow-sessions.ts";
import type { GitHubApp } from "./index.ts";
import { createGitHubTools } from "./tools/index.ts";
import { type GitHubEvent, getGitHubEventRoute } from "./webhooks.ts";
import { prepareGitHubWorkspace, resolveGitHubPullRequestTarget } from "./workflow.ts";

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
  const installationId = event.payload.installation?.id;
  if (!installationId) throw new Error("GitHub workflow event has no installation");
  const repositoryScope = { installationId, repositoryId: event.payload.repository.id };
  const target = await resolveGitHubPullRequestTarget(options.github, event);
  const [client, commitIdentity] = await Promise.all([
    options.github.client(repositoryScope),
    options.github.commitIdentity(repositoryScope),
  ]);

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

    let conversationId: Parameters<typeof options.durable.sandboxes.gitBundle>[0] | undefined;
    const extension = createGitHubTools(client, async (publishContext) => {
      if (conversationId === undefined) throw new Error("Workflow conversation is not ready");
      if (target.headRepositoryId !== target.repositoryId) {
        throw new Error("Publishing changes to fork pull requests is not supported");
      }
      const bundle = await options.durable.sandboxes.gitBundle(
        conversationId,
        target.revision,
        commitIdentity,
        publishContext,
      );
      return options.github.repository(target).publishBundle({
        branch: target.branch,
        expectedHead: target.revision,
        bundle,
      });
    });
    options.durable.install(extension);
    const conversation = await openWorkflowConversation(
      options.durable.harness,
      options.database,
      session,
      extension,
      context,
    );
    conversationId = conversation.id;
    await prepareGitHubWorkspace(options.github, options.durable.sandboxes, event, conversation.id, context, target);
    await options.durable.sandboxes.configureGitAuthor(conversation.id, commitIdentity, context);
    await submitWorkflowEvent(conversation, { id: `github:${event.deliveryId}`, prompt: event.prompt }, context);
  }
}
