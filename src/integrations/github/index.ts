import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { GitHttpRemote, type PublishGitBundleOptions } from "../../git.ts";

export type GitHubAppOptions = {
  appId: string;
  privateKey: string;
};

export type GitHubClientOptions = {
  installationId: number;
  repositoryId: number;
};

export type GitHubRepositoryOptions = GitHubClientOptions & {
  owner: string;
  repository: string;
};

/** Authenticates a GitHub App and creates repository-scoped clients. */
export class GitHubApp {
  readonly #auth: ReturnType<typeof createAppAuth>;

  constructor(options: GitHubAppOptions) {
    this.#auth = createAppAuth(options);
  }

  async client(options: GitHubClientOptions): Promise<Octokit> {
    return new Octokit({ auth: await this.#token(options) });
  }

  repository(options: GitHubRepositoryOptions): GitHubRepository {
    return new GitHubRepository({
      owner: options.owner,
      repository: options.repository,
      authenticate: () => this.#token(options),
    });
  }

  // Request authentication when it is needed so long-lived workflows do not retain expired tokens.
  async #token(options: GitHubClientOptions): Promise<string> {
    const authentication = await this.#auth({
      type: "installation",
      installationId: options.installationId,
      repositoryIds: [options.repositoryId],
    });
    return authentication.token;
  }
}

/** Authenticated Git transport for one GitHub repository. */
export class GitHubRepository {
  readonly #url: string;
  readonly #authenticate: () => Promise<string>;

  constructor(options: {
    owner: string;
    repository: string;
    authenticate: () => Promise<string>;
  }) {
    this.#url = `https://github.com/${options.owner}/${options.repository}.git`;
    this.#authenticate = options.authenticate;
  }

  async clone(directory: string, revision: string): Promise<void> {
    await (await this.#remote()).clone(directory, revision);
  }

  async publishBundle(options: PublishGitBundleOptions): Promise<string> {
    return (await this.#remote()).publishBundle(options);
  }

  async #remote(): Promise<GitHttpRemote> {
    const token = await this.#authenticate();
    const authorization = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    return new GitHttpRemote(this.#url, { authorization });
  }
}

export type GitHubClient = Octokit;
