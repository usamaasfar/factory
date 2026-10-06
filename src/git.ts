import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GitHttpRemoteOptions = {
  authorization: string;
};

export type PublishGitBundleOptions = {
  branch: string;
  expectedHead: string;
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

  async publishBundle(options: PublishGitBundleOptions): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "factory-git-"));

    try {
      await runGit(["clone", "--branch", options.branch, "--single-branch", this.#url, directory], this.#environment);

      // Reject stale work before importing or pushing anything.
      const remoteHead = await gitOutput(["-C", directory, "rev-parse", "HEAD"]);
      if (remoteHead !== options.expectedHead) {
        throw new Error(`Remote branch changed from ${options.expectedHead} to ${remoteHead}`);
      }

      // A bundle transfers the exact commit objects created in the isolated workspace.
      const bundle = join(directory, ".factory.bundle");
      await writeFile(bundle, options.bundle);
      await runGit(["-C", directory, "bundle", "verify", bundle]);
      await runGit(["-C", directory, "fetch", bundle, "HEAD"]);

      const proposedHead = await gitOutput(["-C", directory, "rev-parse", "FETCH_HEAD"]);
      if (proposedHead === options.expectedHead) throw new Error("The bundle contains no new commits");

      // Require a fast-forward relationship; the following push deliberately does not force.
      if (!(await isAncestor(directory, options.expectedHead, proposedHead))) {
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

async function runGit(args: string[], env: Record<string, string | undefined> = process.env): Promise<void> {
  const child = Bun.spawn(["git", ...args], { env, stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
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
