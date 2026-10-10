import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { WorkflowRuntime, WorkflowSession, WorkflowStore } from "../../workflow/index.ts";
import {
  exportCodingWorkspaceChanges,
  findRemoteBranchHead,
  importCodingWorkspaceChanges,
  updateRemoteBranchHead,
  type WorkspaceLifecycle,
} from "../../workspace/index.ts";
import type { GitHubApp, GitHubClient } from "./index.ts";
import { registerGitHubWorkflows } from "./registration.ts";
import { createGitHubTools } from "./tools/index.ts";
import { type GitHubEvent, getGitHubEventRoute } from "./webhooks.ts";
import { type GitHubPullRequestTarget, prepareGitHubWorkspace, resolveGitHubPullRequestTarget } from "./workspace.ts";

export interface GitHubEventHandlerOptions {
  github: GitHubApp;
  workflowStore: WorkflowStore;
  workflowRuntime: WorkflowRuntime;
  workspaces: WorkspaceLifecycle;
}

type GitHubActivationScope = {
  target: GitHubPullRequestTarget;
  client: GitHubClient;
  commitIdentity: { name: string; email: string };
};

/** Registers trusted definitions and translates one verified GitHub event into workflow work. */
export async function handleGitHubEvent(
  options: GitHubEventHandlerOptions,
  event: GitHubEvent,
  context: Context,
): Promise<void> {
  await registerGitHubWorkflows(options.github, options.workflowStore, event, context);
  if (!("prompt" in event)) return;
  if (isGitHubAppSender(event.payload.sender.login, options.github.login)) {
    console.info(`Ignored GitHub App workflow event ${event.name} (${event.deliveryId})`);
    return;
  }

  const route = getGitHubEventRoute(event);
  if (!route) return;
  const installationId = event.payload.installation?.id;
  if (!installationId) throw new Error("GitHub workflow event has no installation");

  let scope: Promise<GitHubActivationScope> | undefined;
  const activationScope = () => (scope ??= resolveActivationScope(options.github, event));
  const matches = await options.workflowRuntime.dispatch(
    {
      integration: "github",
      instance: String(installationId),
      id: event.deliveryId,
      name: event.name,
      scope: String(event.payload.repository.id),
      subject: route.subject,
      content: event.prompt,
    },
    async (session, activationContext) =>
      activateGitHubWorkflow(options, session, await activationScope(), activationContext),
    context,
  );

  if (matches > 0)
    console.info(`Dispatched GitHub event ${event.name} (${event.deliveryId}) to ${matches} workflow(s)`);
}

async function resolveActivationScope(github: GitHubApp, event: GitHubEvent): Promise<GitHubActivationScope> {
  const target = await resolveGitHubPullRequestTarget(github, event);
  const repositoryScope = { installationId: target.installationId, repositoryId: target.repositoryId };
  const [client, commitIdentity] = await Promise.all([
    github.client(repositoryScope),
    github.commitIdentity(repositoryScope),
  ]);
  return { target, client, commitIdentity };
}

async function activateGitHubWorkflow(
  options: GitHubEventHandlerOptions,
  session: WorkflowSession,
  scope: GitHubActivationScope,
  context: Context,
) {
  await prepareGitHubWorkspace(
    options.github,
    options.workspaces,
    session.id,
    scope.commitIdentity,
    scope.target,
    context,
  );

  const repository = options.github.repository(scope.target);
  const fetchBranch = async (env: ExecutionEnv, branch: string, fetchContext: Context) => {
    const knownHead = await findRemoteBranchHead(env, branch, fetchContext);
    const fetched = await repository.fetchBundle({ branch, ...(knownHead ? { exclude: knownHead } : {}) });
    if (fetched.bundle.length > 0) {
      await importCodingWorkspaceChanges(env, { branch, head: fetched.head, bundle: fetched.bundle }, fetchContext);
    }
    return fetched.head;
  };
  const pushBranch = async (env: ExecutionEnv, branch: string, pushContext: Context) => {
    const expectedHead = await findRemoteBranchHead(env, branch, pushContext);
    const bundle = await exportCodingWorkspaceChanges(env, expectedHead, pushContext);
    const head = await repository.publishBundle({ branch, ...(expectedHead ? { expectedHead } : {}), bundle });
    await updateRemoteBranchHead(env, branch, head, withoutAbortSignal(pushContext));
    return head;
  };

  return createGitHubTools(scope.client, { name: `github-${session.id}`, fetchBranch, pushBranch });
}

/** Identifies the App's bot account without suppressing a human with the same base login. */
export function isGitHubAppSender(sender: string, appLogin: string): boolean {
  const botLogin = appLogin.toLowerCase().endsWith("[bot]") ? appLogin : `${appLogin}[bot]`;
  return sender.toLowerCase() === botLogin.toLowerCase();
}
