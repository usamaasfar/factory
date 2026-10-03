import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export type RepositoryCheckout = {
  clone(directory: string, revision: string): Promise<void>;
};

export type Workspace = {
  path: string;
  revision: string;
};

/** Creates or verifies the persistent, credential-free checkout owned by a workflow session. */
export async function prepareWorkspace(options: {
  root: string;
  sessionId: string;
  repository: RepositoryCheckout;
  revision: string;
}): Promise<Workspace> {
  assertName(options.sessionId, "workflow session ID");
  assertCommit(options.revision);

  const path = join(options.root, options.sessionId);
  if (await isDirectory(path)) {
    await verifyWorkspace(path, options.revision);
    return { path, revision: options.revision };
  }

  await mkdir(options.root, { recursive: true });
  const temporary = await mkdtemp(join(options.root, `.${options.sessionId}-`));

  try {
    await options.repository.clone(temporary, options.revision);
    await verifyWorkspace(temporary, options.revision);
    if (await gitOutput(temporary, ["status", "--short"])) throw new Error("New workspace is not clean");

    try {
      await rename(temporary, path);
    } catch (error) {
      // Concurrent delivery preparation may have installed the same workspace first.
      if (!isAlreadyExists(error) || !(await isDirectory(path))) throw error;
      await verifyWorkspace(path, options.revision);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  return { path, revision: options.revision };
}

async function verifyWorkspace(path: string, expectedRevision: string): Promise<void> {
  const head = await gitOutput(path, ["rev-parse", "HEAD"]);
  await gitOutput(path, ["merge-base", "--is-ancestor", expectedRevision, head]);

  const remotes = await gitOutput(path, ["remote"]);
  if (remotes) throw new Error(`Workspace retains Git remotes: ${remotes}`);

  // Installation credentials must remain ephemeral host process state.
  const credentials = await gitOutput(
    path,
    ["config", "--local", "--get-regexp", "^(http\\..*\\.extraheader|credential\\.)"],
    [0, 1],
  );
  if (credentials) throw new Error("Workspace contains credential-bearing Git configuration");
}

async function gitOutput(path: string, args: string[], allowedExitCodes = [0]): Promise<string> {
  const child = Bun.spawn(["git", "-C", path, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (!allowedExitCodes.includes(exitCode)) throw new Error(`git ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function assertName(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function assertCommit(revision: string): void {
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error(`Invalid Git commit: ${revision}`);
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY");
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
