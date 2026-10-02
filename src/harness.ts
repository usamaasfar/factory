import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  AssistantEntry,
  type ConversationId,
  createRegistry,
  type Extension,
  Harness,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { DockerSandbox } from "./sandbox.ts";
import { SandboxExecutionEnv } from "./sandbox-environment.ts";

const DEFAULT_PROMPT =
  "Create hello.txt containing exactly 'hello from factory' followed by a newline. Read it back and report its content.";
const DEFAULT_DATABASE = ".factory/state/harness.sqlite";
const DEFAULT_IMAGE = "factory-sandbox:test";

export type AgentRunOptions = {
  sandbox: DockerSandbox;
  database: string;
  model: string;
  instructions: string;
  prompt: string;
  requestId: string;
  extensions?: Extension[];
  conversationId?: ConversationId;
};

export type AgentRunResult = { conversationId: ConversationId; text: string };

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const context = BACKGROUND_CONTEXT;
  await mkdir(dirname(options.database), { recursive: true });

  const models = createModels();
  models.setProvider(deepseekProvider());
  const extensions = [CodingTools, ...(options.extensions ?? [])];
  const registry = createRegistry();
  for (const extension of extensions) registry.install(extension);

  const storage = await openNodeSqliteStorage(options.database);
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: ({ cwd, conversationId }) =>
        new SandboxExecutionEnv(options.sandbox, {
          id: `sandbox:${conversationId}`,
          cwd: cwd ?? "/workspace",
        }),
    },
    context,
  );

  try {
    const conversation = options.conversationId
      ? await harness.conversation(options.conversationId, context)
      : await harness.createConversation(
          {
            ownership: { kind: "ownerless" },
            agent: {
              model: { provider: "deepseek", modelId: options.model },
              extensions,
              instructions: options.instructions,
              cwd: "/workspace",
            },
          },
          context,
        );
    if (!conversation) throw new Error(`Conversation not found: ${options.conversationId}`);
    const submission = await conversation.submit(
      { type: "input", content: options.prompt, requestId: options.requestId },
      context,
    );
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input") {
      throw new Error(`Harness submission did not complete: ${JSON.stringify(settled)}`);
    }

    const answer = await conversation.commit(
      (transaction) => transaction.entry(AssistantEntry, settled.answer),
      context,
    );
    const content = answer?.model?.[0]?.content;
    const text = Array.isArray(content)
      ? content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("")
      : content;
    if (!text) throw new Error("Harness completed without a text response");
    return { conversationId: conversation.id, text };
  } finally {
    await harness.close(context);
  }
}

export async function runHarness(prompt = DEFAULT_PROMPT): Promise<string> {
  const sandbox = await DockerSandbox.start(process.env.FACTORY_SANDBOX_IMAGE ?? DEFAULT_IMAGE);
  try {
    return (
      await runAgent({
        sandbox,
        database: process.env.FACTORY_DATABASE ?? DEFAULT_DATABASE,
        model: process.env.FACTORY_MODEL ?? "deepseek-flash",
        instructions:
          "You are a software engineering agent running in an isolated sandbox. Use the provided tools to complete the request and verify your work.",
        prompt,
        requestId: crypto.randomUUID(),
      })
    ).text;
  } finally {
    await sandbox.stop();
  }
}

if (import.meta.main) {
  console.log(await runHarness(process.argv.slice(2).join(" ") || DEFAULT_PROMPT));
}
