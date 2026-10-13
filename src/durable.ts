import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type ConversationId,
  createRegistry,
  Harness,
  MemoryStorage,
  type SubmissionId,
} from "@earendil-works/pi-durable";
import type { WorkflowDefinition } from "./workflow/definition.ts";

export const models = createModels();

export const harness = await Harness.open(
  new MemoryStorage(),
  {
    models,
    registry: createRegistry(),
    settings: { extensions: [] },
  },
  BACKGROUND_CONTEXT,
);

export async function createConversation(definition: WorkflowDefinition): Promise<ConversationId> {
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: {
        model: { provider: definition.agent.provider, modelId: definition.agent.model },
        instructions: definition.agent.instructions,
        tools: [],
      },
    },
    BACKGROUND_CONTEXT,
  );

  return conversation.id;
}

export async function submitInput(
  conversationId: number,
  input: { content: string; requestId: string },
): Promise<SubmissionId> {
  const conversation = await harness.conversation(conversationId as ConversationId, BACKGROUND_CONTEXT);
  if (!conversation) throw new Error(`Conversation ${conversationId} not found`);

  const submission = await conversation.submit({ type: "input", ...input, whenBusy: "steer" }, BACKGROUND_CONTEXT);
  return submission.id;
}
