import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FactoryDatabase } from "./database.ts";
import { workflowSessionRoutes, workflowSessions } from "./database-schema.ts";
import type { Workflow } from "./workflows.ts";

export type WorkflowSession = typeof workflowSessions.$inferSelect;

export type WorkflowSessionRoute = {
  provider: string;
  subject: string;
};

export type CreateWorkflowSession = {
  repositoryId: number;
  workflowPath: string;
  workflowRevision: string;
  workflowDefinition: Workflow;
  origin: WorkflowSessionRoute;
};

/** Finds the durable session for a workflow and subject, creating it when absent. */
export function findOrCreateWorkflowSession(
  database: FactoryDatabase,
  options: CreateWorkflowSession,
): { session: WorkflowSession; created: boolean } {
  return database.transaction((transaction) => {
    const inserted = transaction
      .insert(workflowSessions)
      .values({
        id: randomUUID(),
        repositoryId: options.repositoryId,
        workflowPath: options.workflowPath,
        workflowRevision: options.workflowRevision,
        workflowDefinition: options.workflowDefinition,
        originProvider: options.origin.provider,
        originSubject: options.origin.subject,
      })
      .onConflictDoNothing()
      .returning()
      .get();

    const session =
      inserted ??
      transaction
        .select()
        .from(workflowSessions)
        .where(
          and(
            eq(workflowSessions.repositoryId, options.repositoryId),
            eq(workflowSessions.workflowPath, options.workflowPath),
            eq(workflowSessions.originProvider, options.origin.provider),
            eq(workflowSessions.originSubject, options.origin.subject),
          ),
        )
        .get();
    if (!session) throw new Error("Workflow session conflict did not resolve to a persisted session");

    // The origin is also the session's first routable external address.
    transaction
      .insert(workflowSessionRoutes)
      .values({
        sessionId: session.id,
        provider: options.origin.provider,
        subject: options.origin.subject,
      })
      .onConflictDoNothing()
      .run();

    return { session, created: Boolean(inserted) };
  });
}

/** Attaches the first Pi conversation created for a workflow session. */
export function assignWorkflowSessionConversation(
  database: FactoryDatabase,
  sessionId: string,
  conversationId: string,
): string {
  const assigned = database
    .update(workflowSessions)
    .set({ conversationId })
    .where(and(eq(workflowSessions.id, sessionId), isNull(workflowSessions.conversationId)))
    .returning({ conversationId: workflowSessions.conversationId })
    .get();
  if (assigned?.conversationId) return assigned.conversationId;

  const existing = database
    .select({ conversationId: workflowSessions.conversationId })
    .from(workflowSessions)
    .where(eq(workflowSessions.id, sessionId))
    .get();
  if (!existing) throw new Error(`Workflow session does not exist: ${sessionId}`);
  if (!existing.conversationId) throw new Error(`Workflow session has no conversation: ${sessionId}`);
  return existing.conversationId;
}

/** Adds another provider address, such as a Slack thread, to an existing session. */
export function addWorkflowSessionRoute(
  database: FactoryDatabase,
  sessionId: string,
  route: WorkflowSessionRoute,
): void {
  database
    .insert(workflowSessionRoutes)
    .values({ sessionId, provider: route.provider, subject: route.subject })
    .onConflictDoNothing()
    .run();
}

/** Finds every workflow session subscribed to an external provider address. */
export function findWorkflowSessionsByRoute(database: FactoryDatabase, route: WorkflowSessionRoute): WorkflowSession[] {
  return database
    .select({ session: workflowSessions })
    .from(workflowSessionRoutes)
    .innerJoin(workflowSessions, eq(workflowSessionRoutes.sessionId, workflowSessions.id))
    .where(and(eq(workflowSessionRoutes.provider, route.provider), eq(workflowSessionRoutes.subject, route.subject)))
    .all()
    .map(({ session }) => session);
}
