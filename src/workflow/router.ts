import { createConversation } from "../durable.ts";
import { getIntegrationTools } from "../integration.ts";
import { workflow, workflowSession } from "./store.ts";

export async function workflowRouter(event: { name: string; subject: string }): Promise<number[]> {
  const sessions = workflowSession
    .list()
    .filter((session) =>
      session.subjects.some((scope) => event.subject === scope || event.subject.startsWith(`${scope}:`)),
    );

  const triggers = workflow.findByEvent(event.name).map((id) => ({ id, definition: workflow.getDefinition(id) }));
  console.debug(
    `Workflow routes: ${event.name} (${event.subject}) matched ${triggers.length} workflow(s) and ${sessions.length} existing session(s)`,
  );

  for (const { id, definition } of triggers) {
    if (sessions.some((session) => session.workflowId === id) || definition === undefined) continue;

    const tools = Object.entries(definition.permissions).flatMap(([name, permissions]) =>
      getIntegrationTools(name, permissions),
    );

    const conversationId = await createConversation(definition, tools);
    const session = workflowSession.create({
      workflowId: id,
      subjects: [event.subject],
      conversationId,
      definition,
    });
    sessions.push(session);
    console.debug(`Workflow session created: ${session.id} (conversation ${conversationId})`);
  }

  return sessions.map((session) => session.id);
}
