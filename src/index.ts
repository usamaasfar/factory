import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openDatabase } from "./database.ts";
import { openDurable } from "./durable.ts";
import { GitHubApp } from "./integrations/github/index.ts";
import { LocalDockerSandboxProvider } from "./sandbox/index.ts";
import { createServer } from "./server.ts";
import { SqliteWorkflowStore, WorkflowRuntime } from "./workflow/index.ts";
import { SqliteWorkspaceStore, WorkspaceLifecycle } from "./workspace/index.ts";

const database = openDatabase(required("FACTORY_DATABASE_PATH"));
const github = new GitHubApp({
  appId: required("GITHUB_APP_ID"),
  privateKey: required("GITHUB_PRIVATE_KEY"),
  login: required("GITHUB_APP_LOGIN"),
});

const models = createModels();
models.setProvider(deepseekProvider());

const workspaces = new WorkspaceLifecycle({
  provider: new LocalDockerSandboxProvider({ image: Bun.env.SANDBOX_IMAGE ?? "factory-coding:test" }),
  store: new SqliteWorkspaceStore(database),
});
const workflowStore = new SqliteWorkflowStore(database);
await workspaces.sweep(BACKGROUND_CONTEXT);

const durable = await openDurable(
  required("PI_DATABASE_PATH"),
  {
    models,
    environment: async (conversationId, context) => {
      const session = await workflowStore.findSessionByConversation(conversationId, context);
      if (!session) throw new Error(`No workflow session owns Pi conversation ${conversationId}`);
      return workspaces.open(session.id, context);
    },
  },
  BACKGROUND_CONTEXT,
);

const workflowRuntime = new WorkflowRuntime({ store: workflowStore, durable, workspaces });
const app = createServer({
  github,
  workflowStore,
  workflowRuntime,
  workspaces,
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
