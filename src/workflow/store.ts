import type { Context } from "@earendil-works/chord";
import type { WorkflowDefinition } from "./definition.ts";

/** A repository whose trusted workflow snapshot has been registered. */
export interface WorkflowRepository {
  readonly provider: string;
  readonly providerId: string;
}

export interface WorkflowSource {
  readonly path: string;
  readonly source: string;
  readonly definition: WorkflowDefinition;
}

/** One complete, validated repository snapshot. */
export interface WorkflowSnapshot {
  readonly repository: WorkflowRepository;
  readonly revision: string;
  readonly workflows: readonly WorkflowSource[];
}

/** A registered workflow selected for an incoming event. */
export interface WorkflowRegistration {
  readonly repositoryId: number;
  readonly path: string;
  readonly revision: string;
  readonly definition: WorkflowDefinition;
}

export interface WorkflowSubscription {
  readonly provider: string;
  readonly repositoryId: string;
  readonly event: string;
}

export interface WorkflowRoute {
  readonly provider: string;
  readonly subject: string;
}

/** Durable execution identity for one workflow and external subject. */
export interface WorkflowSession {
  readonly id: string;
  readonly repositoryId: number;
  readonly workflowPath: string;
  readonly workflowRevision: string;
  readonly workflowDefinition: WorkflowDefinition;
  readonly originProvider: string;
  readonly originSubject: string;
  readonly conversationId: string | null;
}

export interface CreateWorkflowSession {
  readonly registration: WorkflowRegistration;
  readonly origin: WorkflowRoute;
}

/** Atomic persistence boundary for workflow registration and execution identity. */
export interface WorkflowStore {
  /** Replaces all registrations for a repository with one validated snapshot. */
  replaceSnapshot(snapshot: WorkflowSnapshot, context: Context): Promise<void>;
  findRegistrations(subscription: WorkflowSubscription, context: Context): Promise<WorkflowRegistration[]>;
  /** Finds the stable session for a registration and subject, creating it when absent. */
  findOrCreateSession(
    options: CreateWorkflowSession,
    context: Context,
  ): Promise<{ session: WorkflowSession; created: boolean }>;
  /** Attaches the first conversation and returns the winning conversation ID. */
  assignConversation(sessionId: string, conversationId: string, context: Context): Promise<string>;
  findSessionByConversation(conversationId: string, context: Context): Promise<WorkflowSession | undefined>;
  addRoute(sessionId: string, route: WorkflowRoute, context: Context): Promise<void>;
  findSessionsByRoute(route: WorkflowRoute, context: Context): Promise<WorkflowSession[]>;
}
