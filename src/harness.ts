import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { AssistantEntry, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { DockerSandbox } from "./sandbox.ts";
import { SandboxExecutionEnv } from "./sandbox-environment.ts";

const DEFAULT_PROMPT =
  "Create hello.txt containing exactly 'hello from factory' followed by a newline. Read it back and report its content.";
const DEFAULT_DATABASE = ".factory/state/harness.sqlite";
const DEFAULT_IMAGE = "factory-sandbox:test";

export async function runHarness(prompt = DEFAULT_PROMPT): Promise<string> {
  const context = BACKGROUND_CONTEXT;
  const database = process.env.FACTORY_DATABASE ?? DEFAULT_DATABASE;
  const image = process.env.FACTORY_SANDBOX_IMAGE ?? DEFAULT_IMAGE;
  const modelId = process.env.FACTORY_MODEL ?? "deepseek-flash";

  await mkdir(dirname(database), { recursive: true });

  const sandbox = await DockerSandbox.start(image);
  const models = createModels();
  models.setProvider(deepseekProvider());

  const registry = createRegistry();
  registry.install(CodingTools);

  const storage = await openNodeSqliteStorage(database);
  const harness = await Harness.open(
    storage,
    {
      models,
      registry,
      env: ({ cwd, conversationId }) =>
        new SandboxExecutionEnv(sandbox, { id: `sandbox:${conversationId}`, cwd: cwd ?? "/workspace" }),
    },
    context,
  );

  try {
    const agent = {
      model: { provider: "deepseek", modelId },
      extensions: [CodingTools],
      instructions:
        "You are a software engineering agent running in an isolated sandbox. Use the provided tools to complete the request and verify your work.",
      cwd: "/workspace",
    } as const;
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent,
      },
      context,
    );

    const submission = await conversation.submit(
      { type: "input", content: prompt, requestId: crypto.randomUUID() },
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
    return text;
  } finally {
    await harness.close(context);
    await sandbox.stop();
  }
}

if (import.meta.main) {
  const prompt = process.argv.slice(2).join(" ") || DEFAULT_PROMPT;
  console.log(await runHarness(prompt));
}
