import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { Conversation, Submission } from "@earendil-works/pi-durable";
import type { FactoryDatabase } from "../../database.ts";
import type { Durable } from "../../durable.ts";
import { registerGitHubWorkflows } from "../../workflow-registration.ts";
import { findRegisteredWorkflows } from "../../workflow-registry.ts";
import { openWorkflowConversation, submitWorkflowEvent } from "../../workflow-runner.ts";
import { findOrCreateWorkflowSession } from "../../workflow-sessions.ts";
import type { WorkspaceLifecycle } from "../../workspace/index.ts";
import type { GitHubApp } from "./index.ts";
import { createGitHubTools } from "./tools/index.ts";
import { type GitHubEvent, getGitHubEventRoute } from "./webhooks.ts";
import { prepareGitHubWorkspace, resolveGitHubPullRequestTarget } from "./workflow.ts";

export interface GitHubEventHandlerOptions {
  github: GitHubApp;
  database: FactoryDatabase;
  durable: Durable;
  workspaces: WorkspaceLifecycle;
}

/** Applies one verified GitHub event to workflow registration and matching conversations. */
export async function handleGitHubEvent(
  options: GitHubEventHandlerOptions,
  event: GitHubEvent,
  context: Context,
): Promise<void> {
  await registerGitHubWorkflows(options.github, options.database, event);
  if (!("prompt" in event)) return;
  if (isGitHubAppSender(event.payload.sender.login, options.github.login)) {
    console.info(`Ignored GitHub App workflow event ${event.name} (${event.deliveryId})`);
    return;
  }

  const trigger = `github.${event.name}`;
  const workflows = findRegisteredWorkflows(options.database, {
    provider: "github",
    repositoryId: String(event.payload.repository.id),
    event: trigger,
  });
  if (workflows.length === 0) return;

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

    await prepareGitHubWorkspace(options.github, options.workspaces, session.id, commitIdentity, target, context);

    // Each session gets a stable extension identity so concurrent workflows
    // cannot replace one another's authenticated GitHub client in the registry.
    const extension = createGitHubTools(client, { name: `github-${session.id}` });
    options.durable.install(extension);
    const cleanupContext = withoutAbortSignal(context);

    try {
      const conversation = await openWorkflowConversation(
        options.durable.harness,
        options.database,
        session,
        extension,
        context,
      );
      const submission = await submitWorkflowEvent(
        conversation,
        { id: `github:${event.deliveryId}`, prompt: event.prompt },
        context,
      );
      void suspendWorkspaceAfterSubmission(
        submission,
        conversation,
        options.workspaces,
        session.id,
        cleanupContext,
      ).catch((error) => console.error(`Could not settle workflow session ${session.id}`, error));
    } catch (error) {
      try {
        await options.workspaces.suspend(session.id, cleanupContext);
      } catch (suspendError) {
        throw new AggregateError([error, suspendError], `Could not suspend failed workflow session ${session.id}`);
      }
      throw error;
    }
  }
}

/** Identifies the App's bot account without suppressing a human with the same base login. */
export function isGitHubAppSender(sender: string, appLogin: string): boolean {
  const botLogin = appLogin.toLowerCase().endsWith("[bot]") ? appLogin : `${appLogin}[bot]`;
  return sender.toLowerCase() === botLogin.toLowerCase();
}

/** Releases workflow compute after the submission settles and its conversation becomes idle. */
export async function suspendWorkspaceAfterSubmission(
  submission: Pick<Submission, "wait">,
  conversation: Pick<Conversation, "waitForIdle">,
  workspaces: Pick<WorkspaceLifecycle, "suspend">,
  workspaceId: string,
  context: Context,
): Promise<void> {
  await submission.wait(context);
  await conversation.waitForIdle(context);
  await workspaces.suspend(workspaceId, context);
}
