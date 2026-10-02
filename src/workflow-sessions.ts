import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FactoryDatabase } from "./database.ts";
import { workflowSessionRoutes, workflowSessions } from "./database-schema.ts";
import type { Workflow } from "./workflows.ts";

export type WorkflowSession = typeof workflowSessions.$inferSelect;

export type WorkflowSessionOrigin = {
  provider: string;
  subject: string;
};

export type CreateWorkflowSession = {
  repositoryId: number;
  workflowPath: string;
  workflowRevision: string;
  workflowDefinition: Workflow;
  origin: WorkflowSessionOrigin;
};

/** Finds the durable session for a workflow and subject, creating it when absent. */
export function findOrCreateWorkflowSession(
  database: FactoryDatabase,
  options: CreateWorkflowSession,
): { session: WorkflowSession; created: boolean } {
  return database.transaction((transaction) => {
    const existing = transaction
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
    if (existing) return { session: existing, created: false };

    const session = transaction
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
      .returning()
      .get();

    // The origin is also the session's first routable external address.
    transaction
      .insert(workflowSessionRoutes)
      .values({
        sessionId: session.id,
        provider: options.origin.provider,
        subject: options.origin.subject,
      })
      .run();

    return { session, created: true };
  });
}

/** Adds another provider address, such as a Slack thread, to an existing session. */
export function addWorkflowSessionRoute(
  database: FactoryDatabase,
  sessionId: string,
  route: WorkflowSessionOrigin,
): void {
  database
    .insert(workflowSessionRoutes)
    .values({ sessionId, provider: route.provider, subject: route.subject })
    .onConflictDoNothing()
    .run();
}

/** Finds every workflow session subscribed to an external provider address. */
export function findWorkflowSessionsByRoute(
  database: FactoryDatabase,
  route: WorkflowSessionOrigin,
): WorkflowSession[] {
  return database
    .select({ session: workflowSessions })
    .from(workflowSessionRoutes)
    .innerJoin(workflowSessions, eq(workflowSessionRoutes.sessionId, workflowSessions.id))
    .where(and(eq(workflowSessionRoutes.provider, route.provider), eq(workflowSessionRoutes.subject, route.subject)))
    .all()
    .map(({ session }) => session);
}
