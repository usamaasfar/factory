import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationId } from "@earendil-works/pi-durable";

export type GitHubInstance = {
  repositoryId: number;
  pullRequestNumber: number;
  workflowPath: string;
  conversationId: ConversationId;
  volume: string;
  image: string;
  model: string;
  instructions: string;
  headSha: string;
  headRef: string;
};

export class GitHubInstanceStore {
  readonly #database: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new Database(path, { create: true });
    this.#database.run(`
      CREATE TABLE IF NOT EXISTS github_instances (
        repository_id INTEGER NOT NULL,
        pull_request_number INTEGER NOT NULL,
        workflow_path TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        volume TEXT NOT NULL,
        image TEXT NOT NULL,
        model TEXT NOT NULL,
        instructions TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        head_ref TEXT NOT NULL,
        PRIMARY KEY (repository_id, pull_request_number, workflow_path)
      )
    `);
    const columns = this.#database.query("PRAGMA table_info(github_instances)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "head_ref")) {
      this.#database.run("ALTER TABLE github_instances ADD COLUMN head_ref TEXT NOT NULL DEFAULT ''");
    }
  }

  save(instance: GitHubInstance): void {
    this.#database
      .query(`INSERT OR REPLACE INTO github_instances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        instance.repositoryId,
        instance.pullRequestNumber,
        instance.workflowPath,
        instance.conversationId,
        instance.volume,
        instance.image,
        instance.model,
        instance.instructions,
        instance.headSha,
        instance.headRef,
      );
  }

  updateHead(repositoryId: number, pullRequestNumber: number, workflowPath: string, headSha: string): void {
    this.#database
      .query(
        "UPDATE github_instances SET head_sha = ? WHERE repository_id = ? AND pull_request_number = ? AND workflow_path = ?",
      )
      .run(headSha, repositoryId, pullRequestNumber, workflowPath);
  }

  find(repositoryId: number, pullRequestNumber: number): GitHubInstance[] {
    return this.#database
      .query(`SELECT repository_id repositoryId, pull_request_number pullRequestNumber,
        workflow_path workflowPath, conversation_id conversationId, volume, image, model, instructions,
        head_sha headSha, head_ref headRef FROM github_instances WHERE repository_id = ? AND pull_request_number = ?`)
      .all(repositoryId, pullRequestNumber) as GitHubInstance[];
  }
}
