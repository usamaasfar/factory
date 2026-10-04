import type { Context } from "@earendil-works/chord";
import type { Conversation, ConversationId, Harness, Submission } from "@earendil-works/pi-durable";
import type { FactoryDatabase } from "./database.ts";
import { assignWorkflowSessionConversation, type WorkflowSession } from "./workflow-sessions.ts";

export interface WorkflowEvent {
  id: string;
  prompt: string;
}

/** Durably submits an event to the workflow session's Pi conversation. */
export async function runWorkflowEvent(
  harness: Harness,
  database: FactoryDatabase,
  session: WorkflowSession,
  event: WorkflowEvent,
  context: Context,
): Promise<Submission> {
  const conversation = await workflowConversation(harness, database, session, context);
  return conversation.submit(
    {
      type: "input",
      content: event.prompt,
      requestId: event.id,
      whenBusy: "steer",
    },
    context,
  );
}

async function workflowConversation(
  harness: Harness,
  database: FactoryDatabase,
  session: WorkflowSession,
  context: Context,
): Promise<Conversation> {
  if (session.conversationId) return requireConversation(harness, session.conversationId, context);

  const workflow = session.workflowDefinition;
  const created = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: {
        model: { provider: workflow.agent.provider, modelId: workflow.agent.model },
        instructions: workflow.agent.instructions,
      },
    },
    context,
  );
  const conversationId = assignWorkflowSessionConversation(database, session.id, String(created.id));
  return conversationId === String(created.id) ? created : requireConversation(harness, conversationId, context);
}

async function requireConversation(harness: Harness, value: string, context: Context): Promise<Conversation> {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid Pi conversation ID: ${value}`);
  const conversation = await harness.conversation(id as ConversationId, context);
  if (!conversation) throw new Error(`Pi conversation does not exist: ${value}`);
  return conversation;
}
