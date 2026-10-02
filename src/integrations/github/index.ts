import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export type GitHubAppOptions = {
  appId: string;
  privateKey: string;
};

export type GitHubClientOptions = {
  installationId: number;
  repositoryId: number;
};

/** Authenticates a GitHub App and creates repository-scoped API clients. */
export class GitHubApp {
  readonly #auth: ReturnType<typeof createAppAuth>;

  constructor(options: GitHubAppOptions) {
    this.#auth = createAppAuth(options);
  }

  async client(options: GitHubClientOptions): Promise<Octokit> {
    const authentication = await this.#auth({
      type: "installation",
      installationId: options.installationId,
      repositoryIds: [options.repositoryId],
    });

    return new Octokit({ auth: authentication.token });
  }
}

export type GitHubClient = Octokit;
