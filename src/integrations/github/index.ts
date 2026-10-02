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

export type GitHubRepositoryInfo = {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
};

export type GitHubBranch = {
  name: string;
  sha: string;
};

export type GitHubDirectoryEntry = {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
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

/** Authenticated API and Git access for one GitHub repository. */
export class GitHubRepository {
  readonly #owner: string;
  readonly #repository: string;
  readonly #url: string;
  readonly #authenticate: () => Promise<string>;

  constructor(options: {
    owner: string;
    repository: string;
    authenticate: () => Promise<string>;
  }) {
    this.#owner = options.owner;
    this.#repository = options.repository;
    this.#url = `https://github.com/${options.owner}/${options.repository}.git`;
    this.#authenticate = options.authenticate;
  }

  async info(): Promise<GitHubRepositoryInfo> {
    const response = await (await this.#client()).rest.repos.get({
      owner: this.#owner,
      repo: this.#repository,
    });

    return {
      id: response.data.id,
      owner: response.data.owner.login,
      name: response.data.name,
      defaultBranch: response.data.default_branch,
    };
  }

  async defaultBranch(): Promise<GitHubBranch> {
    const info = await this.info();
    const response = await (await this.#client()).rest.repos.getBranch({
      owner: this.#owner,
      repo: this.#repository,
      branch: info.defaultBranch,
    });
    return { name: info.defaultBranch, sha: response.data.commit.sha };
  }

  async listDirectory(path: string, revision: string): Promise<GitHubDirectoryEntry[]> {
    const response = await (await this.#client()).rest.repos.getContent({
      owner: this.#owner,
      repo: this.#repository,
      path,
      ref: revision,
    });
    if (!Array.isArray(response.data)) throw new Error(`${path} is not a directory`);

    return response.data.map(({ name, path, sha, size, type }) => ({ name, path, sha, size, type }));
  }

  async readFile(path: string, revision: string): Promise<string> {
    const response = await (await this.#client()).rest.repos.getContent({
      owner: this.#owner,
      repo: this.#repository,
      path,
      ref: revision,
    });
    if (Array.isArray(response.data) || response.data.type !== "file" || !("content" in response.data)) {
      throw new Error(`${path} is not a file`);
    }
    if (response.data.encoding !== "base64") throw new Error(`Unsupported encoding for ${path}`);
    return Buffer.from(response.data.content, "base64").toString("utf8");
  }

  async clone(directory: string, revision: string): Promise<void> {
    await (await this.#remote()).clone(directory, revision);
  }

  async publishBundle(options: PublishGitBundleOptions): Promise<string> {
    return (await this.#remote()).publishBundle(options);
  }

  async #client(): Promise<Octokit> {
    return new Octokit({ auth: await this.#authenticate() });
  }

  async #remote(): Promise<GitHttpRemote> {
    const token = await this.#authenticate();
    const authorization = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    return new GitHttpRemote(this.#url, { authorization });
  }
}

export type GitHubClient = Octokit;
