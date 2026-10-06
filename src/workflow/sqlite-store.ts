import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { and, eq, isNull } from "drizzle-orm";
import type { FactoryDatabase } from "../database.ts";
import { repositories, workflowSessionRoutes, workflowSessions, workflows } from "../database-schema.ts";
import type {
  CreateWorkflowSession,
  WorkflowRegistration,
  WorkflowRoute,
  WorkflowSession,
  WorkflowSnapshot,
  WorkflowStore,
  WorkflowSubscription,
} from "./store.ts";

/** SQLite-backed workflow catalog and session identity store. */
export class SqliteWorkflowStore implements WorkflowStore {
  readonly #database: FactoryDatabase;

  constructor(database: FactoryDatabase) {
    this.#database = database;
  }

  async replaceSnapshot(snapshot: WorkflowSnapshot, context: Context): Promise<void> {
    context.abortSignal?.throwIfAborted();
    this.#database.transaction((transaction) => {
      const repository =
        transaction
          .insert(repositories)
          .values(snapshot.repository)
          .onConflictDoNothing()
          .returning({ id: repositories.id })
          .get() ??
        transaction
          .select({ id: repositories.id })
          .from(repositories)
          .where(
            and(
              eq(repositories.provider, snapshot.repository.provider),
              eq(repositories.providerId, snapshot.repository.providerId),
            ),
          )
          .get();
      if (!repository) throw new Error("Workflow repository conflict did not resolve to a persisted repository");

      transaction.delete(workflows).where(eq(workflows.repositoryId, repository.id)).run();
      if (snapshot.workflows.length > 0) {
        transaction
          .insert(workflows)
          .values(
            snapshot.workflows.map((workflow) => ({
              repositoryId: repository.id,
              path: workflow.path,
              revision: snapshot.revision,
              source: workflow.source,
              definition: workflow.definition,
            })),
          )
          .run();
      }
    });
  }

  async findRegistrations(subscription: WorkflowSubscription, context: Context): Promise<WorkflowRegistration[]> {
    context.abortSignal?.throwIfAborted();
    const registered = this.#database
      .select({
        repositoryId: repositories.id,
        path: workflows.path,
        revision: workflows.revision,
        definition: workflows.definition,
      })
      .from(workflows)
      .innerJoin(repositories, eq(workflows.repositoryId, repositories.id))
      .where(
        and(eq(repositories.provider, subscription.provider), eq(repositories.providerId, subscription.repositoryId)),
      )
      .all();

    return registered.filter((workflow) => Object.hasOwn(workflow.definition.on, subscription.event));
  }

  async findOrCreateSession(
    options: CreateWorkflowSession,
    context: Context,
  ): Promise<{ session: WorkflowSession; created: boolean }> {
    context.abortSignal?.throwIfAborted();
    return this.#database.transaction((transaction) => {
      const registration = options.registration;
      const inserted = transaction
        .insert(workflowSessions)
        .values({
          id: randomUUID(),
          repositoryId: registration.repositoryId,
          workflowPath: registration.path,
          workflowRevision: registration.revision,
          workflowDefinition: registration.definition,
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
              eq(workflowSessions.repositoryId, registration.repositoryId),
              eq(workflowSessions.workflowPath, registration.path),
              eq(workflowSessions.originProvider, options.origin.provider),
              eq(workflowSessions.originSubject, options.origin.subject),
            ),
          )
          .get();
      if (!session) throw new Error("Workflow session conflict did not resolve to a persisted session");

      transaction
        .insert(workflowSessionRoutes)
        .values({ sessionId: session.id, provider: options.origin.provider, subject: options.origin.subject })
        .onConflictDoNothing()
        .run();

      return { session, created: inserted !== undefined };
    });
  }

  async assignConversation(sessionId: string, conversationId: string, context: Context): Promise<string> {
    context.abortSignal?.throwIfAborted();
    const assigned = this.#database
      .update(workflowSessions)
      .set({ conversationId })
      .where(and(eq(workflowSessions.id, sessionId), isNull(workflowSessions.conversationId)))
      .returning({ conversationId: workflowSessions.conversationId })
      .get();
    if (assigned?.conversationId) return assigned.conversationId;

    const existing = this.#database
      .select({ conversationId: workflowSessions.conversationId })
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .get();
    if (!existing) throw new Error(`Workflow session does not exist: ${sessionId}`);
    if (!existing.conversationId) throw new Error(`Workflow session has no conversation: ${sessionId}`);
    return existing.conversationId;
  }

  async findSessionByConversation(conversationId: string, context: Context): Promise<WorkflowSession | undefined> {
    context.abortSignal?.throwIfAborted();
    return this.#database
      .select()
      .from(workflowSessions)
      .where(eq(workflowSessions.conversationId, conversationId))
      .get();
  }

  async addRoute(sessionId: string, route: WorkflowRoute, context: Context): Promise<void> {
    context.abortSignal?.throwIfAborted();
    this.#database
      .insert(workflowSessionRoutes)
      .values({ sessionId, provider: route.provider, subject: route.subject })
      .onConflictDoNothing()
      .run();
  }

  async findSessionsByRoute(route: WorkflowRoute, context: Context): Promise<WorkflowSession[]> {
    context.abortSignal?.throwIfAborted();
    return this.#database
      .select({ session: workflowSessions })
      .from(workflowSessionRoutes)
      .innerJoin(workflowSessions, eq(workflowSessionRoutes.sessionId, workflowSessions.id))
      .where(and(eq(workflowSessionRoutes.provider, route.provider), eq(workflowSessionRoutes.subject, route.subject)))
      .all()
      .map(({ session }) => session);
  }
}
