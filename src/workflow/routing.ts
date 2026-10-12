import { createConversation } from "../durable.ts";
import { workflow, workflowSession } from "./store.ts";

export async function workflowRouter(event: { name: string; subject: string }): Promise<number[]> {
  const sessions = workflowSession
    .list()
    .filter((session) =>
      session.subjects.some((scope) => event.subject === scope || event.subject.startsWith(`${scope}:`)),
    );

  const triggers = workflow.findByEvent(event.name).map((id) => ({ id, definition: workflow.getDefinition(id) }));

  for (const { id, definition } of triggers) {
    if (sessions.some((session) => session.workflowId === id) || definition === undefined) continue;

    const conversationId = await createConversation(definition);
    sessions.push(
      workflowSession.create({
        workflowId: id,
        subjects: [event.subject],
        conversationId,
        definition,
      }),
    );
  }

  return sessions.map((session) => session.id);
}
