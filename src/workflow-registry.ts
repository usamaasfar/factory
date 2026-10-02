import { eq } from "drizzle-orm";
import type { FactoryDatabase } from "./database.ts";
import { repositories, workflows } from "./database-schema.ts";
import type { Workflow } from "./workflows.ts";

export type WorkflowSnapshot = {
  repository: {
    provider: string;
    providerId: string;
    installationId: string;
    owner: string;
    name: string;
    defaultBranch: string;
  };
  revision: string;
  workflows: Array<{
    path: string;
    source: string;
    definition: Workflow;
  }>;
};

/**
 * Replaces a repository's workflow registry with one complete, validated snapshot.
 * Deleting and reinserting inside one transaction also removes files absent from
 * the new revision; a failed insert rolls the deletion back.
 */
export function replaceRegisteredWorkflows(database: FactoryDatabase, snapshot: WorkflowSnapshot): void {
  database.transaction((transaction) => {
    const repository = transaction
      .insert(repositories)
      .values({
        ...snapshot.repository,
        workflowRevision: snapshot.revision,
      })
      .onConflictDoUpdate({
        target: [repositories.provider, repositories.providerId],
        set: {
          installationId: snapshot.repository.installationId,
          owner: snapshot.repository.owner,
          name: snapshot.repository.name,
          defaultBranch: snapshot.repository.defaultBranch,
          workflowRevision: snapshot.revision,
        },
      })
      .returning({ id: repositories.id })
      .get();

    // Readers observe either the previous snapshot or the complete replacement.
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
