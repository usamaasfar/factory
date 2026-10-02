import type { FactoryDatabase } from "./database.ts";
import type { GitHubApp, GitHubDirectoryEntry, GitHubRepository } from "./integrations/github/index.ts";
import { type GitHubEvent, githubWorkflowEventNames } from "./integrations/github/webhooks.ts";
import { replaceRegisteredWorkflows } from "./workflow-registry.ts";
import { parseWorkflow } from "./workflows.ts";

const workflowDirectory = ".factory/workflows";
const supportedEvents = new Set<string>(githubWorkflowEventNames);

type GitHubRegistrationEvent = Extract<
  GitHubEvent,
  { name: "push" | "installation.created" | "installation_repositories.added" }
>;

type RepositoryTarget = {
  installationId: number;
  repositoryId: number;
  owner: string;
  repository: string;
};

/** Synchronizes workflow registrations affected by one verified GitHub event. */
export async function registerGitHubWorkflows(
  app: GitHubApp,
  database: FactoryDatabase,
  event: GitHubRegistrationEvent,
): Promise<void> {
  if (event.name === "push") {
    const payload = event.payload;
    // Only the trusted default branch controls registered workflow definitions.
    if (payload.deleted || payload.ref !== `refs/heads/${payload.repository.default_branch}`) return;
    if (!payload.installation) {
      console.error(`Cannot register workflows for ${payload.repository.full_name}: missing installation`);
      return;
    }

    const target = {
      installationId: payload.installation.id,
      repositoryId: payload.repository.id,
      owner: payload.repository.owner.login,
      repository: payload.repository.name,
    };
    await synchronizeRepository(app, database, target, payload.after);
    return;
  }

  // Installation events bootstrap repositories before their next default-branch push.
  const repositories =
    event.name === "installation.created" ? event.payload.repositories : event.payload.repositories_added;
  if (!repositories) {
    console.error(`Cannot register workflows for installation ${event.payload.installation.id}: missing repositories`);
    return;
  }

  for (const repository of repositories) {
    const [owner, name] = repository.full_name.split("/");
    if (!owner || !name) {
      console.error(`Cannot register workflows for invalid repository name: ${repository.full_name}`);
      continue;
    }
    await synchronizeRepository(app, database, {
      installationId: event.payload.installation.id,
      repositoryId: repository.id,
      owner,
      repository: name,
    });
  }
}

/** Builds and validates a complete repository snapshot before changing the registry. */
async function synchronizeRepository(
  app: GitHubApp,
  database: FactoryDatabase,
  target: RepositoryTarget,
  expectedHead?: string,
): Promise<void> {
  const fullName = `${target.owner}/${target.repository}`;

  try {
    const repository = app.repository(target);
    const branch = await repository.defaultBranch();

    // Older push deliveries must not replace a snapshot registered from a newer commit.
    if (expectedHead && branch.sha !== expectedHead) {
      console.info(`Ignored stale workflow registration for ${fullName} at ${expectedHead}`);
      return;
    }

    const entries = await listWorkflowFiles(repository, branch.sha);

    // Promise.all must finish successfully before the atomic database replacement begins.
    const registered = await Promise.all(
      entries.map(async ({ path }) => {
        const source = await repository.readFile(path, branch.sha);
        const definition = parseWorkflow(source);
        for (const event of Object.keys(definition.on)) {
          if (!supportedEvents.has(event)) throw new Error(`${path} uses unsupported event ${event}`);
        }
        return { path, source, definition };
      }),
    );

    replaceRegisteredWorkflows(database, {
      repository: {
        provider: "github",
        providerId: String(target.repositoryId),
        installationId: String(target.installationId),
        owner: target.owner,
        name: target.repository,
        defaultBranch: branch.name,
      },
      revision: branch.sha,
      workflows: registered,
    });
    console.info(`Registered ${registered.length} workflow(s) for ${fullName} at ${branch.sha}`);
  } catch (error) {
    console.error(`Failed to register workflows for ${fullName}: ${message(error)}`);
  }
}

/** Lists direct YAML workflow files; nested directories are not part of the initial DSL. */
async function listWorkflowFiles(repository: GitHubRepository, revision: string): Promise<GitHubDirectoryEntry[]> {
  try {
    const entries = await repository.listDirectory(workflowDirectory, revision);
    return entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".yml")).sort(byPath);
  } catch (error) {
    // A repository without a workflow directory has a valid empty snapshot.
    if (status(error) === 404) return [];
    throw error;
  }
}

function byPath(left: GitHubDirectoryEntry, right: GitHubDirectoryEntry): number {
  return left.path.localeCompare(right.path);
}

/** Reads Octokit's HTTP status without coupling core registration to its error class. */
function status(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
