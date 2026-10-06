import type { Context } from "@earendil-works/chord";
import { parseWorkflowDefinition, type WorkflowStore } from "../../workflow/index.ts";
import type { GitHubApp, GitHubDirectoryEntry, GitHubRepository } from "./index.ts";
import { type GitHubEvent, githubWorkflowEventNames } from "./webhooks.ts";

const workflowDirectory = ".factory/workflows";
const supportedEvents = new Set<string>(githubWorkflowEventNames);

type RepositoryTarget = {
  installationId: number;
  repositoryId: number;
  owner: string;
  repository: string;
};

/** Synchronizes workflow registrations affected by one verified GitHub event. */
export async function registerGitHubWorkflows(
  app: GitHubApp,
  store: WorkflowStore,
  event: GitHubEvent,
  context: Context,
): Promise<void> {
  if (event.name === "push") {
    const payload = event.payload;
    // Only the trusted default branch controls registered workflow definitions.
    if (payload.deleted || payload.ref !== `refs/heads/${payload.repository.default_branch}`) return;
    if (!payload.installation) {
      console.error(`Cannot register workflows for ${payload.repository.full_name}: missing installation`);
      return;
    }

    await synchronizeRepository(
      app,
      store,
      {
        installationId: payload.installation.id,
        repositoryId: payload.repository.id,
        owner: payload.repository.owner.login,
        repository: payload.repository.name,
      },
      context,
      payload.after,
    );
    return;
  }

  if (event.name !== "installation.created" && event.name !== "installation_repositories.added") return;

  const repositories =
    event.name === "installation.created" ? event.payload.repositories : event.payload.repositories_added;
  if (!repositories) {
    console.error(`Cannot register workflows for installation ${event.payload.installation.id}: missing repositories`);
    return;
  }

  for (const repository of repositories) {
    context.abortSignal?.throwIfAborted();
    const [owner, name] = repository.full_name.split("/");
    if (!owner || !name) {
      console.error(`Cannot register workflows for invalid repository name: ${repository.full_name}`);
      continue;
    }
    await synchronizeRepository(
      app,
      store,
      {
        installationId: event.payload.installation.id,
        repositoryId: repository.id,
        owner,
        repository: name,
      },
      context,
    );
  }
}

/** Builds and validates a complete repository snapshot before changing the store. */
async function synchronizeRepository(
  app: GitHubApp,
  store: WorkflowStore,
  target: RepositoryTarget,
  context: Context,
  expectedHead?: string,
): Promise<void> {
  const fullName = `${target.owner}/${target.repository}`;

  try {
    context.abortSignal?.throwIfAborted();
    const repository = app.repository(target);
    const branch = await repository.defaultBranch();

    // Older push deliveries must not replace a snapshot registered from a newer commit.
    if (expectedHead && branch.sha !== expectedHead) {
      console.info(`Ignored stale workflow registration for ${fullName} at ${expectedHead}`);
      return;
    }

    const entries = await listWorkflowFiles(repository, branch.sha);
    const registered = await Promise.all(
      entries.map(async ({ path }) => {
        const source = await repository.readFile(path, branch.sha);
        const definition = parseWorkflowDefinition(source);
        for (const event of Object.keys(definition.on)) {
          if (!supportedEvents.has(event)) throw new Error(`${path} uses unsupported event ${event}`);
        }
        return { path, source, definition };
      }),
    );

    await store.replaceSnapshot(
      {
        repository: { provider: "github", providerId: String(target.repositoryId) },
        revision: branch.sha,
        workflows: registered,
      },
      context,
    );
    console.info(`Registered ${registered.length} workflow(s) for ${fullName} at ${branch.sha}`);
  } catch (error) {
    if (context.abortSignal?.aborted) throw error;
    console.error(`Failed to register workflows for ${fullName}: ${message(error)}`);
  }
}

/** Lists direct YAML workflow files; nested directories are not part of the initial DSL. */
async function listWorkflowFiles(repository: GitHubRepository, revision: string): Promise<GitHubDirectoryEntry[]> {
  try {
    const entries = await repository.listDirectory(workflowDirectory, revision);
    return entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".yml")).sort(byPath);
  } catch (error) {
    if (status(error) === 404) return [];
    throw error;
  }
}

function byPath(left: GitHubDirectoryEntry, right: GitHubDirectoryEntry): number {
  return left.path.localeCompare(right.path);
}

function status(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
