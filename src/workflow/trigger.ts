import { submitInput } from "../durable.ts";
import { workflowRouter } from "./router.ts";
import { workflowSession } from "./store.ts";

export async function workflowTrigger(event: { id: string; name: string; subject: string; content: string }) {
  const sessionIds = await workflowRouter(event);
  const submissions = [];

  for (const sessionId of sessionIds) {
    const session = workflowSession.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const submissionId = await submitInput(session.conversationId, { content: event.content, requestId: event.id });
    submissions.push({ sessionId, submissionId });
  }

  return submissions;
}
