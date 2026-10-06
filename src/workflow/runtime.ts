import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { Conversation, ConversationId, Extension, Harness, Submission } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { Durable } from "../durable.ts";
import type { WorkspaceLifecycle } from "../workspace/index.ts";
import type { WorkflowSession, WorkflowStore } from "./store.ts";

/** Provider-neutral event admitted to the workflow runtime. */
export interface WorkflowEvent {
  readonly id: string;
  readonly provider: string;
  readonly repositoryId: string;
  readonly name: string;
  readonly subject: string;
  readonly prompt: string;
}

export type ActivateWorkflow = (session: WorkflowSession, context: Context) => Promise<Extension>;

export interface WorkflowRuntimeOptions {
  readonly store: WorkflowStore;
  readonly durable: Durable;
  readonly workspaces: Pick<WorkspaceLifecycle, "suspend">;
}

/** Matches events, owns session/conversation identity, and admits agent work. */
export class WorkflowRuntime {
  readonly #store: WorkflowStore;
  readonly #durable: Durable;
  readonly #workspaces: Pick<WorkspaceLifecycle, "suspend">;
  readonly #sessionTails = new Map<string, Promise<void>>();

  constructor(options: WorkflowRuntimeOptions) {
    this.#store = options.store;
    this.#durable = options.durable;
    this.#workspaces = options.workspaces;
  }

  /** Dispatches an event to every matching workflow and returns the match count. */
  async dispatch(event: WorkflowEvent, activate: ActivateWorkflow, context: Context): Promise<number> {
    const registrations = await this.#store.findRegistrations(
      { provider: event.provider, repositoryId: event.repositoryId, event: event.name },
      context,
    );

    const results = await Promise.allSettled(
      registrations.map((registration) =>
        this.#exclusive(
          JSON.stringify([registration.repositoryId, registration.path, event.provider, event.subject]),
          async () => {
            const { session, created } = await this.#store.findOrCreateSession(
              { registration, origin: { provider: event.provider, subject: event.subject } },
              context,
            );
            console.info(`${created ? "Created" : "Found"} workflow session ${session.id} for ${registration.path}`);
            await this.#admit(session, event, activate, context);
          },
        ),
      ),
    );

    const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length > 0)
      throw new AggregateError(errors, `Failed to dispatch ${event.name} to ${errors.length} workflow(s)`);
    return registrations.length;
  }

  async #admit(
    session: WorkflowSession,
    event: WorkflowEvent,
    activate: ActivateWorkflow,
    context: Context,
  ): Promise<void> {
    const cleanupContext = withoutAbortSignal(context);
    try {
      const extension = await activate(session, context);
      this.#durable.install(extension);
      const conversation = await openConversation(this.#durable.harness, this.#store, session, extension, context);
      const submission = await conversation.submit(
        { type: "input", content: event.prompt, requestId: event.id, whenBusy: "steer" },
        context,
      );
      void suspendWorkspaceAfterSubmission(
        submission,
        conversation,
        this.#workspaces,
        session.id,
        cleanupContext,
      ).catch((error) => console.error(`Could not settle workflow session ${session.id}`, error));
    } catch (error) {
      try {
        await this.#workspaces.suspend(session.id, cleanupContext);
      } catch (suspendError) {
        throw new AggregateError([error, suspendError], `Could not suspend failed workflow session ${session.id}`);
      }
      throw error;
    }
  }

  /** Serializes conversation creation and admission for one session in this process. */
  async #exclusive<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#sessionTails.get(sessionKey) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#sessionTails.set(sessionKey, current);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.#sessionTails.get(sessionKey) === current) this.#sessionTails.delete(sessionKey);
    }
  }
}

async function openConversation(
  harness: Harness,
  store: WorkflowStore,
  session: WorkflowSession,
  extension: Extension,
  context: Context,
): Promise<Conversation> {
  if (session.conversationId) {
    const conversation = await requireConversation(harness, session.conversationId, context);
    await conversation.configure({ extensions: [CodingTools, extension] }, context);
    return conversation;
  }

  const workflow = session.workflowDefinition;
  const created = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: {
        model: { provider: workflow.agent.provider, modelId: workflow.agent.model },
        extensions: [CodingTools, extension],
        instructions: workflow.agent.instructions,
      },
    },
    context,
  );
  const conversationId = await store.assignConversation(session.id, String(created.id), context);
  return conversationId === String(created.id) ? created : requireConversation(harness, conversationId, context);
}

async function requireConversation(harness: Harness, value: string, context: Context): Promise<Conversation> {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid Pi conversation ID: ${value}`);
  const conversation = await harness.conversation(id as ConversationId, context);
  if (!conversation) throw new Error(`Pi conversation does not exist: ${value}`);
  return conversation;
}

/** Releases workflow compute after admitted work and its conversation become idle. */
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
