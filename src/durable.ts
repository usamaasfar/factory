import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  type ConversationId,
  createRegistry,
  defineExtension,
  type Extension,
  Harness,
  MemoryStorage,
  type SubmissionId,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { createSandboxAssignment, resolveSandboxEnv, SandboxDoc } from "./sandbox.ts";
import type { WorkflowDefinition } from "./workflow/definition.ts";

export const models = createModels();
models.setProvider(deepseekProvider());

export const registry = createRegistry();
registry.install(CodingTools);

const registeredTools = new Map<string, ToolRegistration>();
let toolsExtension: Extension | undefined;

export const harness = await Harness.open(
  new MemoryStorage(),
  {
    models,
    registry,
    settings: { extensions: [] },
    env: resolveSandboxEnv,
    onReport: (error) => console.error("[durable] Runtime report", error),
  },
  BACKGROUND_CONTEXT,
);

export async function createConversation(
  definition: WorkflowDefinition,
  tools: readonly ToolRegistration[],
): Promise<ConversationId> {
  const sandbox = definition.sandbox ? createSandboxAssignment(definition.sandbox) : undefined;
  const extension = registerTools(tools);
  const extensions: Extension[] = extension ? [extension] : [];
  if (sandbox) extensions.push(CodingTools);
  const conversationTools = sandbox ? [...tools, ...(CodingTools.tools ?? [])] : tools;
  const conversation = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: {
        model: { provider: definition.agent.provider, modelId: definition.agent.model },
        instructions: definition.agent.instructions,
        extensions,
        tools: conversationTools,
      },
      init: async (tx, conversationId) => {
        if (sandbox) (await tx.doc(SandboxDoc, conversationId)).sandbox = sandbox;
      },
    },
    BACKGROUND_CONTEXT,
  );

  if (sandbox) {
    console.debug(
      `Sandbox assigned: ${definition.name} (conversation ${conversation.id}, key ${sandbox.key}, image ${sandbox.image})`,
    );
  }
  console.debug(
    `Conversation ${conversation.id} tools: ${conversationTools.map((tool) => tool.name).join(", ") || "none"}`,
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
  const context = { conversationId, submissionId: submission.id, requestId: input.requestId };

  // Admission is enough to acknowledge a webhook; execution settles independently.
  void submission
    .wait(BACKGROUND_CONTEXT)
    .then((result) => {
      if (result.status === "unanswered") {
        console.error("[durable] Input unanswered", { ...context, reason: result.reason, detail: result.detail });
      } else {
        console.info("[durable] Input completed", context);
      }
    })
    .catch((error) => console.error("[durable] Could not observe input outcome", context, error));

  return submission.id;
}

function registerTools(tools: readonly ToolRegistration[]): Extension | undefined {
  if (tools.length === 0) return undefined;

  let changed = false;
  for (const tool of tools) {
    const registered = registeredTools.get(tool.name);
    if (registered && registered !== tool) throw new Error(`Duplicate tool: ${tool.name}`);
    if (!registered) {
      registeredTools.set(tool.name, tool);
      changed = true;
    }
  }

  if (changed) {
    toolsExtension = defineExtension({ name: "integrations", tools: [...registeredTools.values()] });
    registry.install(toolsExtension);
  }
  return toolsExtension;
}
