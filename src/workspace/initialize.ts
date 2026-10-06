import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { getOrThrow } from "@earendil-works/pi-durable/env";

export interface PreparedCodingWorkspace {
  /** Tar containing `.git` and tracked working-tree files, but no ignored files. */
  readonly archive: Uint8Array;
  /** Commit and symbolic ref captured before archiving and checked after extraction. */
  readonly head: string;
  readonly headRef?: string;
  /** Exact `git remote -v` output used to detect changed or removed remotes. */
  readonly remotes: string;
}

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/** Archives a clean, credential-free repository without changing its Git state. */
export async function prepareCodingWorkspace(directory: string, context: Context): Promise<PreparedCodingWorkspace> {
  const root = await realpath(directory);
  const topLevel = await hostGit(root, ["rev-parse", "--show-toplevel"], context);
  if ((await realpath(topLevel)) !== root) throw new Error("Workspace source must be the repository root");

  const gitDirectory = await hostGit(root, ["rev-parse", "--absolute-git-dir"], context);
  if ((await realpath(gitDirectory)) !== (await realpath(join(root, ".git")))) {
    throw new Error("Workspace source must have its Git directory at the repository root");
  }

  const status = await hostGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], context);
  if (status) throw new Error("Workspace source must be clean");

  const config = await hostGit(root, ["config", "--local", "--null", "--list"], context, false);
  assertCredentialFree(config);

  const head = await hostGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], context);
  // symbolic-ref exits 1 for a valid detached HEAD and prints no ref.
  const headRef = await hostGit(root, ["symbolic-ref", "--quiet", "HEAD"], context, true, [0, 1]);
  const remotes = await hostGit(root, ["remote", "-v"], context, false);
  if (!remotes.split("\n").some((line) => line.startsWith("origin\t"))) {
    throw new Error("Workspace source must have an origin remote");
  }

  // Tar recursively archives directory entries, so a gitlink could pull ignored
  // files from an initialized submodule across the credential boundary.
  const index = await hostGit(root, ["ls-files", "--stage"], context, false);
  if (/^160000 /m.test(index)) throw new Error("Workspace source submodules are not supported");

  // Archive Git metadata and tracked files only. Ignored files commonly contain
  // dependencies, caches, or credentials and must not cross the boundary.
  const tracked = await hostCommand(["git", "-C", root, "ls-files", "--cached", "-z"], context);
  const files = new Uint8Array(5 + tracked.length);
  files.set(new TextEncoder().encode(".git\0"));
  files.set(tracked, 5);
  const archive = await hostCommand(["tar", "-C", root, "--null", "-T", "-", "-cf", "-"], context, [0], files);
  return { archive, head, ...(headRef ? { headRef } : {}), remotes };
}

/** Extracts a prepared repository and configures its repository-local Git identity. */
export async function initializeCodingWorkspace(
  env: ExecutionEnv,
  prepared: PreparedCodingWorkspace,
  identity: GitIdentity,
  context: Context,
): Promise<void> {
  validateIdentity(identity);
  if (prepared.archive.length === 0) throw new Error("Workspace archive is empty");

  const archive = getOrThrow(await env.createTempFile({ prefix: "factory-workspace-", suffix: ".tar" }, context));
  try {
    getOrThrow(await env.writeFile(archive, prepared.archive, context));
    // Refuse to merge with unknown persistent state. Tar keeps modes and
    // symlinks while discarding host ownership, which is meaningless remotely.
    await exec(
      env,
      'test -z "$(find . -mindepth 1 -maxdepth 1 -print -quit)" || exit 64\n' +
        'tar --extract --file "$FACTORY_WORKSPACE_ARCHIVE" --directory . --no-same-owner --same-permissions',
      { FACTORY_WORKSPACE_ARCHIVE: archive },
      context,
      "Workspace extraction failed",
    );

    const head = await gitOutput(env, "rev-parse --verify 'HEAD^{commit}'", context);
    if (head !== prepared.head) throw new Error(`Workspace HEAD changed from ${prepared.head} to ${head}`);

    // Exit 1 means detached HEAD; the empty output must match an absent source ref.
    const headRef = await gitOutput(env, "symbolic-ref --quiet HEAD", context, true, [0, 1]);
    if (headRef !== (prepared.headRef ?? "")) throw new Error("Workspace branch state changed during transfer");

    const remotes = await gitOutput(env, "remote -v", context, false);
    if (remotes !== prepared.remotes) throw new Error("Workspace remotes changed during transfer");

    const config = await gitOutput(env, "config --local --null --list", context, false);
    assertCredentialFree(config);

    // Values travel through the environment rather than shell interpolation.
    // --local ensures neither the image nor another workspace is modified.
    await exec(
      env,
      'git config --local user.name "$FACTORY_GIT_NAME"\n' + 'git config --local user.email "$FACTORY_GIT_EMAIL"',
      { FACTORY_GIT_NAME: identity.name, FACTORY_GIT_EMAIL: identity.email },
      context,
      "Could not configure workspace Git identity",
    );

    const status = await gitOutput(env, "status --porcelain=v1 --untracked-files=all", context, false);
    if (status) throw new Error("Initialized workspace is not clean");
  } finally {
    await env.remove(archive, { force: true }, withoutAbortSignal(context));
  }
}

async function hostGit(
  directory: string,
  args: string[],
  context: Context,
  trim = true,
  acceptedExitCodes: number[] = [0],
): Promise<string> {
  const output = await hostCommand(["git", "-C", directory, ...args], context, acceptedExitCodes);
  const text = new TextDecoder().decode(output);
  return trim ? text.trim() : text.replace(/\n$/, "");
}

async function hostCommand(
  command: string[],
  context: Context,
  acceptedExitCodes: number[] = [0],
  stdin?: Uint8Array,
): Promise<Uint8Array> {
  context.abortSignal?.throwIfAborted();
  const child = Bun.spawn(command, {
    stdin: stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: context.abortSignal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  context.abortSignal?.throwIfAborted();
  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error(`${command[0]} ${command[1] ?? ""} failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }
  return stdout;
}

async function gitOutput(
  env: ExecutionEnv,
  command: string,
  context: Context,
  trim = true,
  acceptedExitCodes: number[] = [0],
): Promise<string> {
  // Commands passed here are fixed internal snippets. Dynamic values are passed
  // as environment variables by exec() instead of being added to this string.
  let output = "";
  const result = await env.exec(`git ${command}`, { onOutput: (chunk) => (output += chunk) }, context);
  if (!result.ok) throw result.error;
  if (!acceptedExitCodes.includes(result.value.exitCode)) {
    throw new Error(`git ${command.split(" ")[0]} failed with exit code ${result.value.exitCode}`);
  }
  return trim ? output.trim() : output.replace(/\n$/, "");
}

async function exec(
  env: ExecutionEnv,
  command: string,
  variables: Record<string, string>,
  context: Context,
  message: string,
): Promise<void> {
  const result = await env.exec(command, { env: variables }, context);
  if (!result.ok) throw result.error;
  if (result.value.exitCode !== 0) throw new Error(`${message} (exit ${result.value.exitCode})`);
}

function assertCredentialFree(config: string): void {
  // `git config --null --list` emits `key\nvalue\0`, preserving whitespace in values.
  for (const entry of config.split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("\n");
    const key = (separator === -1 ? entry : entry.slice(0, separator)).toLowerCase();
    const value = separator === -1 ? "" : entry.slice(separator + 1);
    if (key.startsWith("credential.") || key === "http.extraheader" || /^http\..+\.extraheader$/.test(key)) {
      throw new Error(`Workspace Git configuration contains credential setting: ${key}`);
    }
    if ((key.endsWith(".url") || key.endsWith(".pushurl")) && /^https?:\/\/[^/@]+@/i.test(value)) {
      throw new Error(`Workspace Git remote contains embedded credentials: ${key}`);
    }
  }
}

function validateIdentity(identity: GitIdentity): void {
  if (!identity.name || identity.name.includes("\0")) throw new TypeError("Git identity name is required");
  if (!identity.email || identity.email.includes("\0")) throw new TypeError("Git identity email is required");
}
