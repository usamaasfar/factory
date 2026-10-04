import type { Context } from "@earendil-works/chord";
import type { Conversation, ConversationId, Extension, Harness, Submission } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { FactoryDatabase } from "./database.ts";
import { assignWorkflowSessionConversation, type WorkflowSession } from "./workflow-sessions.ts";

export interface WorkflowEvent {
  id: string;
  prompt: string;
}

/** Opens the one Pi conversation owned by a workflow session. */
export async function openWorkflowConversation(
  harness: Harness,
  database: FactoryDatabase,
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
  const conversationId = assignWorkflowSessionConversation(database, session.id, String(created.id));
  return conversationId === String(created.id) ? created : requireConversation(harness, conversationId, context);
}

/** Submits one deduplicated factual event after its provider has prepared the conversation. */
export function submitWorkflowEvent(
  conversation: Conversation,
  event: WorkflowEvent,
  context: Context,
): Promise<Submission> {
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

async function requireConversation(harness: Harness, value: string, context: Context): Promise<Conversation> {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`Invalid Pi conversation ID: ${value}`);
  const conversation = await harness.conversation(id as ConversationId, context);
  if (!conversation) throw new Error(`Pi conversation does not exist: ${value}`);
  return conversation;
}
