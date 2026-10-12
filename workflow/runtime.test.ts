import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type Conversation, defineExtension, type Harness } from "@earendil-works/pi-durable";
import type { Durable } from "../durable.ts";
import type { WorkflowDefinition } from "./definition.ts";
import { WorkflowRuntime } from "./runtime.ts";
import type {
  WorkflowRegistration,
  WorkflowRoute,
  WorkflowSession,
  WorkflowStore,
  WorkflowSubscription,
} from "./store.ts";

const definition: WorkflowDefinition = {
  name: "Review",
  on: { "github.pull_request.opened": {} },
  agent: {
    environment: "base.linux",
    resources: { cpu: 2, memory: 4 },
    provider: "openai",
    model: "test-model",
    instructions: "Review the change.",
  },
};

const registration: WorkflowRegistration = {
  repositoryId: 1,
  path: ".factory/workflows/review.yml",
  revision: "revision",
  definition,
};

test("concurrent deliveries for one subject create one conversation", async () => {
  let conversationId: string | null = null;
  let createdSession = false;
  let conversationsCreated = 0;
  let matchedSubscription: WorkflowSubscription | undefined;
  let createdRoute: WorkflowRoute | undefined;
  let submittedRequestId: string | undefined;
  const installed: string[] = [];

  const session = (): WorkflowSession => ({
    id: "session-1",
    repositoryId: 1,
    workflowPath: registration.path,
    workflowRevision: registration.revision,
    workflowDefinition: definition,
    originProvider: "github",
    originSubject: "repository:1:pull_request:2",
    conversationId,
  });
  const store: WorkflowStore = {
    replaceSnapshot: async () => undefined,
    findRegistrations: async (subscription) => {
      matchedSubscription = subscription;
      return [registration];
    },
    findOrCreateSession: async (options) => {
      createdRoute = options.origin;
      const created = !createdSession;
      createdSession = true;
      return { session: session(), created };
    },
    assignConversation: async (_sessionId, assigned) => {
      conversationId ??= assigned;
      return conversationId;
    },
    findSessionByConversation: async () => session(),
    addRoute: async () => undefined,
    findSessionsByRoute: async () => [session()],
  };

  const conversation = {
    id: 1,
    configure: async () => undefined,
    submit: async (input: { requestId?: string }) => {
      submittedRequestId = input.requestId;
      return { wait: async () => undefined };
    },
    waitForIdle: async () => undefined,
  } as unknown as Conversation;
  const harness = {
    createConversation: async () => {
      conversationsCreated += 1;
      return conversation;
    },
    conversation: async () => conversation,
  } as unknown as Harness;
  const durable = {
    harness,
    install: (extension) => installed.push(extension.name),
  } satisfies Durable;
  const runtime = new WorkflowRuntime({
    store,
    durable,
    workspaces: { suspend: async () => undefined },
  });
  const event = {
    integration: "github",
    instance: "10",
    id: "delivery",
    name: "pull_request.opened",
    scope: "1",
    subject: "repository:1:pull_request:2",
    content: "Pull request opened.",
  };

  await Promise.all([
    runtime.dispatch(event, async () => defineExtension({ name: "github-session-1", tools: [] }), BACKGROUND_CONTEXT),
    runtime.dispatch(event, async () => defineExtension({ name: "github-session-1", tools: [] }), BACKGROUND_CONTEXT),
  ]);

  expect(conversationsCreated).toBe(1);
  expect(session().conversationId).toBe("1");
  expect(matchedSubscription).toEqual({
    provider: "github",
    repositoryId: "1",
    event: "github.pull_request.opened",
  });
  expect(createdRoute).toEqual({
    provider: "github",
    subject: '["10","1","repository:1:pull_request:2"]',
  });
  expect(submittedRequestId).toBe('["github","10","delivery"]');
  expect(installed).toEqual(["github-session-1", "github-session-1"]);
});
