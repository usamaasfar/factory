import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GitHttpRemoteOptions = {
  authorization: string;
};

export type FetchGitBundleOptions = {
  branch: string;
  exclude?: string;
};

export type FetchedGitBundle = {
  head: string;
  bundle: Uint8Array;
};

export type PublishGitBundleOptions = {
  branch: string;
  expectedHead?: string;
  bundle: Uint8Array;
};

/** Trusted-host Git access for an HTTPS remote. Credentials are never persisted. */
export class GitHttpRemote {
  readonly #url: string;
  readonly #environment: Record<string, string | undefined>;

  constructor(url: string, options: GitHttpRemoteOptions) {
    this.#url = url;
    this.#environment = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraHeader",
      GIT_CONFIG_VALUE_0: options.authorization,
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  async clone(directory: string, revision: string): Promise<void> {
    await runGit(["clone", this.#url, directory], this.#environment);
    await runGit(["-C", directory, "checkout", "--detach", revision], this.#environment);
  }

  /** Downloads a branch as a bundle, excluding known history when possible. */
  async fetchBundle(options: FetchGitBundleOptions): Promise<FetchedGitBundle> {
    await validateBranch(options.branch);
    if (options.exclude) assertCommitId(options.exclude);
    const directory = await mkdtemp(join(tmpdir(), "factory-git-"));

    try {
      await runGit(["clone", "--branch", options.branch, "--single-branch", this.#url, directory], this.#environment);
      const head = await gitOutput(["-C", directory, "rev-parse", "HEAD"]);
      if (options.exclude === head) return { head, bundle: new Uint8Array() };

      const bundle = join(directory, ".factory.bundle");
      const revisions = ["HEAD"];
      if (
        options.exclude &&
        options.exclude !== head &&
        (await hasCommit(directory, options.exclude)) &&
        (await isAncestor(directory, options.exclude, head))
      ) {
        revisions.push(`^${options.exclude}`);
      }
      await runGit(["-C", directory, "bundle", "create", bundle, ...revisions]);
      return { head, bundle: await readFile(bundle) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async publishBundle(options: PublishGitBundleOptions): Promise<string> {
    await validateBranch(options.branch);
    if (options.expectedHead) assertCommitId(options.expectedHead);
    const directory = await mkdtemp(join(tmpdir(), "factory-git-"));

    try {
      await runGit(["clone", this.#url, directory], this.#environment);

      // Existing branches require an exact observed head. A missing expected
      // head means the caller intends to create a new branch.
      const remoteRef = `refs/remotes/origin/${options.branch}`;
      const remoteHead = await gitOutputIfExists(["-C", directory, "rev-parse", "--verify", remoteRef]);
      if (options.expectedHead && remoteHead !== options.expectedHead) {
        throw new Error(`Remote branch changed from ${options.expectedHead} to ${remoteHead ?? "missing"}`);
      }
      if (!options.expectedHead && remoteHead) {
        throw new Error(`Remote branch already exists at ${remoteHead}`);
      }

      // A bundle transfers the exact commit objects created in the isolated workspace.
      const bundle = join(directory, ".factory.bundle");
      await writeFile(bundle, options.bundle);
      await runGit(["-C", directory, "bundle", "verify", bundle]);
      await runGit(["-C", directory, "fetch", bundle, "HEAD"]);

      const proposedHead = await gitOutput(["-C", directory, "rev-parse", "FETCH_HEAD"]);
      if (proposedHead === options.expectedHead) throw new Error("The bundle contains no new commits");

      // Existing branches must fast-forward. The push is never forced, so a
      // concurrent branch creation or update is rejected by the remote.
      if (options.expectedHead && !(await isAncestor(directory, options.expectedHead, proposedHead))) {
        throw new Error("The bundle does not fast-forward the remote branch");
      }
      await runGit(
        ["-C", directory, "push", "origin", `${proposedHead}:refs/heads/${options.branch}`],
        this.#environment,
      );

      return proposedHead;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function validateBranch(branch: string): Promise<void> {
  await runGit(["check-ref-format", `refs/heads/${branch}`]);
}

function assertCommitId(value: string): void {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) throw new TypeError("Expected a full Git commit ID");
}

async function runGit(args: string[], env: Record<string, string | undefined> = process.env): Promise<void> {
  const child = Bun.spawn(["git", ...args], { env, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
}

async function hasCommit(directory: string, revision: string): Promise<boolean> {
  const child = Bun.spawn(["git", "-C", directory, "cat-file", "-e", `${revision}^{commit}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await child.exited) === 0;
}

async function isAncestor(directory: string, ancestor: string, descendant: string): Promise<boolean> {
  const child = Bun.spawn(["git", "-C", directory, "merge-base", "--is-ancestor", ancestor, descendant], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode === 0) return true;
  if (exitCode === 1) return false;
  throw new Error(`git merge-base failed: ${stderr.trim()}`);
}

async function gitOutputIfExists(args: string[]): Promise<string | undefined> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exitCode === 0) return stdout.trim();
  if (exitCode === 128) return undefined;
  throw new Error(`git ${args[0]} failed with exit ${exitCode}`);
}

async function gitOutput(args: string[]): Promise<string> {
  const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}
