import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { AssistantEntry, type SubmissionId } from "@earendil-works/pi-durable";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { database } from "../database.ts";
import { harness, models } from "../durable.ts";
import { workflow, workflowSession, workflowSessions, workflows } from "./store.ts";
import { workflowTrigger } from "./trigger.ts";

const source = `
name: Test conversation
on:
  test.message.created:
permissions: {}
agent:
  provider: deepseek
  model: deepseek-flash
  instructions: Answer briefly. Remember information from earlier messages.
`;

beforeAll(async () => {
  if (!Bun.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is required");
  models.setProvider(deepseekProvider());

  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson({ workflows, workflowSessions }),
  );
  for (const statement of statements) {
    database.$client.run(statement.replace(/^CREATE (TABLE|UNIQUE INDEX) /, "CREATE $1 IF NOT EXISTS "));
  }
});

beforeEach(() => {
  workflow.register([source]);
});

afterEach(() => {
  database.delete(workflowSessions).run();
  database.delete(workflows).run();
});

async function waitForAnswer(submissionId: SubmissionId) {
  const submission = await harness.submission(submissionId, BACKGROUND_CONTEXT);
  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  const result = await submission.wait(BACKGROUND_CONTEXT);
  if (result.status !== "done" || result.type !== "input") {
    throw new Error(`Input was not answered: ${JSON.stringify(result)}`);
  }

  const entry = await harness.commit((tx) => tx.entry(AssistantEntry, result.answer), BACKGROUND_CONTEXT);
  const message = entry?.model?.[0];
  if (message?.role !== "assistant") throw new Error("Expected an assistant answer");

  return {
    conversationId: result.conversationId,
    text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
  };
}

// Calls the real DeepSeek model using DEEPSEEK_API_KEY from .env.
test("starts an agent and continues the same conversation", async () => {
  const subject = "test:thread:42";
  const started = await workflowTrigger({
    id: "test:delivery:1",
    name: "test.message.created",
    subject,
    content: "Remember this code: amber-42. Acknowledge briefly.",
  });
  expect(started).toHaveLength(1);
  const first = started[0];
  if (!first) throw new Error("Expected a submission");
  const initialAnswer = await waitForAnswer(first.submissionId);
  expect(initialAnswer.text.trim()).not.toBe("");

  const continued = await workflowTrigger({
    id: "test:delivery:2",
    name: "test.message.updated",
    subject,
    content: "What code did I give you? Reply with only the code.",
  });
  expect(continued).toHaveLength(1);
  const second = continued[0];
  if (!second) throw new Error("Expected a submission");
  const followUpAnswer = await waitForAnswer(second.submissionId);

  expect(second.sessionId).toBe(first.sessionId);
  expect(followUpAnswer.conversationId).toBe(initialAnswer.conversationId);
  expect(followUpAnswer.text).toContain("amber-42");
  expect(workflowSession.list()).toHaveLength(1);
}, 120_000);
