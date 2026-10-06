import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { exportCodingWorkspaceChanges } from "./publish.ts";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe("coding workspace publication", () => {
  test("exports commits descending from the expected head", async () => {
    const directory = await repository();
    const base = await git(directory, "rev-parse", "HEAD");
    await writeFile(join(directory, "change.txt"), "published\n");
    await run(directory, "git", "add", "change.txt");
    await run(directory, "git", "commit", "-m", "Publish change");
    const head = await git(directory, "rev-parse", "HEAD");

    const bundle = await exportCodingWorkspaceChanges(
      new NodeExecutionEnv({ cwd: directory }),
      base,
      BACKGROUND_CONTEXT,
    );
    const bundlePath = join(await temporaryDirectory("factory-bundle-"), "changes.bundle");
    await writeFile(bundlePath, bundle);

    const consumer = await temporaryDirectory("factory-consumer-");
    await run(consumer, "git", "init");
    await run(consumer, "git", "fetch", directory, base);
    await run(consumer, "git", "fetch", bundlePath, "HEAD");
    expect(await git(consumer, "rev-parse", "FETCH_HEAD")).toBe(head);
  });

  test("rejects uncommitted changes", async () => {
    const directory = await repository();
    const base = await git(directory, "rev-parse", "HEAD");
    await writeFile(join(directory, "change.txt"), "not committed\n");

    expect(
      exportCodingWorkspaceChanges(new NodeExecutionEnv({ cwd: directory }), base, BACKGROUND_CONTEXT),
    ).rejects.toThrow("uncommitted changes");
  });

  test("rejects a workspace with no new commits", async () => {
    const directory = await repository();
    const base = await git(directory, "rev-parse", "HEAD");

    expect(
      exportCodingWorkspaceChanges(new NodeExecutionEnv({ cwd: directory }), base, BACKGROUND_CONTEXT),
    ).rejects.toThrow("no new commits");
  });

  test("rejects commits that do not descend from the expected head", async () => {
    const directory = await repository();
    const base = await git(directory, "rev-parse", "HEAD");
    await run(directory, "git", "checkout", "--orphan", "unrelated");
    await run(directory, "git", "rm", "-rf", ".");
    await writeFile(join(directory, "unrelated.txt"), "unrelated\n");
    await run(directory, "git", "add", ".");
    await run(directory, "git", "commit", "-m", "Unrelated history");

    expect(
      exportCodingWorkspaceChanges(new NodeExecutionEnv({ cwd: directory }), base, BACKGROUND_CONTEXT),
    ).rejects.toThrow("do not fast-forward");
  });
});

async function repository(): Promise<string> {
  const directory = await temporaryDirectory("factory-publish-");
  await run(directory, "git", "init", "--initial-branch=main");
  await run(directory, "git", "config", "user.name", "Factory App");
  await run(directory, "git", "config", "user.email", "factory@example.test");
  await writeFile(join(directory, "README.md"), "initial\n");
  await run(directory, "git", "add", ".");
  await run(directory, "git", "commit", "-m", "Initial");
  return directory;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.add(directory);
  return directory;
}

async function git(directory: string, ...args: string[]): Promise<string> {
  return (await run(directory, "git", ...args)).trim();
}

async function run(directory: string, ...command: string[]): Promise<string> {
  const child = Bun.spawn(command, { cwd: directory, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}
