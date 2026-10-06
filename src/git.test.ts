import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { GitHttpRemote } from "./git.ts";
import { exportCodingWorkspaceChanges } from "./workspace/publish.ts";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe("GitHttpRemote publication", () => {
  test("pushes a validated fast-forward bundle", async () => {
    const fixture = await remoteRepository();
    const workspace = await clone(fixture.remote);
    await writeFile(join(workspace, "change.txt"), "published\n");
    await run(workspace, "git", "add", ".");
    await run(workspace, "git", "commit", "-m", "Publish change");
    const head = await git(workspace, "rev-parse", "HEAD");
    const bundle = await exportCodingWorkspaceChanges(
      new NodeExecutionEnv({ cwd: workspace }),
      fixture.head,
      BACKGROUND_CONTEXT,
    );

    const published = await trustedRemote(fixture.remote).publishBundle({
      branch: "main",
      expectedHead: fixture.head,
      bundle,
    });

    expect(published).toBe(head);
    expect(await git(fixture.remote, "rev-parse", "refs/heads/main")).toBe(head);
    expect(
      await runWithExitCodes(fixture.remote, ["git", "config", "--local", "--get", "http.extraHeader"], [0, 1]),
    ).toBe("");
  });

  test("rejects a stale remote head", async () => {
    const fixture = await remoteRepository();
    const workspace = await clone(fixture.remote);
    await commitFile(workspace, "workspace.txt", "workspace\n");
    const bundle = await exportCodingWorkspaceChanges(
      new NodeExecutionEnv({ cwd: workspace }),
      fixture.head,
      BACKGROUND_CONTEXT,
    );

    await commitFile(fixture.seed, "remote.txt", "remote\n");
    await run(fixture.seed, "git", "push", "origin", "main");

    expect(
      trustedRemote(fixture.remote).publishBundle({ branch: "main", expectedHead: fixture.head, bundle }),
    ).rejects.toThrow("Remote branch changed");
  });

  test("rejects a bundle with no new commits", async () => {
    const fixture = await remoteRepository();
    const path = join(fixture.seed, "base.bundle");
    await run(fixture.seed, "git", "bundle", "create", path, "HEAD");

    expect(
      trustedRemote(fixture.remote).publishBundle({
        branch: "main",
        expectedHead: fixture.head,
        bundle: await Bun.file(path).bytes(),
      }),
    ).rejects.toThrow("no new commits");
  });

  test("rejects a non-fast-forward bundle", async () => {
    const fixture = await remoteRepository();
    const unrelated = await temporaryDirectory("factory-unrelated-");
    await run(unrelated, "git", "init", "--initial-branch=main");
    await configureIdentity(unrelated);
    await commitFile(unrelated, "unrelated.txt", "unrelated\n");
    const path = join(unrelated, "unrelated.bundle");
    await run(unrelated, "git", "bundle", "create", path, "HEAD");

    expect(
      trustedRemote(fixture.remote).publishBundle({
        branch: "main",
        expectedHead: fixture.head,
        bundle: await Bun.file(path).bytes(),
      }),
    ).rejects.toThrow("does not fast-forward");
    expect(await git(fixture.remote, "rev-parse", "refs/heads/main")).toBe(fixture.head);
  });
});

async function remoteRepository(): Promise<{ remote: string; seed: string; head: string }> {
  const remote = await temporaryDirectory("factory-remote-");
  await run(remote, "git", "init", "--bare");

  const seed = await temporaryDirectory("factory-seed-");
  await run(seed, "git", "init", "--initial-branch=main");
  await configureIdentity(seed);
  await commitFile(seed, "README.md", "initial\n");
  await run(seed, "git", "remote", "add", "origin", remote);
  await run(seed, "git", "push", "-u", "origin", "main");
  return { remote, seed, head: await git(seed, "rev-parse", "HEAD") };
}

async function clone(remote: string): Promise<string> {
  const directory = await temporaryDirectory("factory-clone-");
  await run(directory, "git", "clone", "--branch", "main", remote, ".");
  await configureIdentity(directory);
  return directory;
}

function trustedRemote(remote: string): GitHttpRemote {
  return new GitHttpRemote(remote, { authorization: "Authorization: Basic test-only" });
}

async function configureIdentity(directory: string): Promise<void> {
  await run(directory, "git", "config", "user.name", "Factory App");
  await run(directory, "git", "config", "user.email", "factory@example.test");
}

async function commitFile(directory: string, name: string, content: string): Promise<void> {
  await writeFile(join(directory, name), content);
  await run(directory, "git", "add", name);
  await run(directory, "git", "commit", "-m", `Add ${name}`);
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.add(directory);
  return directory;
}

async function git(directory: string, ...args: string[]): Promise<string> {
  return (await runWithExitCodes(directory, ["git", ...args], [0])).trim();
}

async function run(directory: string, ...command: string[]): Promise<string> {
  return runWithExitCodes(directory, command, [0]);
}

async function runWithExitCodes(directory: string, command: string[], acceptedExitCodes: number[]): Promise<string> {
  const child = Bun.spawn(command, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (!acceptedExitCodes.includes(exitCode)) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}
