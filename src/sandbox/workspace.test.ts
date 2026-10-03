import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareWorkspace, type RepositoryCheckout } from "./workspace.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("prepareWorkspace", () => {
  test("creates a credential-free checkout and preserves descendant commits", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "source");
    await run(["git", "init", source]);
    await writeFile(join(source, "README.md"), "initial\n");
    await run(["git", "-C", source, "add", "."]);
    await commit(source, "initial");
    const revision = await output(["git", "-C", source, "rev-parse", "HEAD"]);
    const repository: RepositoryCheckout = {
      async clone(directory, requestedRevision) {
        await run(["git", "clone", source, directory]);
        await run(["git", "-C", directory, "checkout", "--detach", requestedRevision]);
        await run(["git", "-C", directory, "remote", "remove", "origin"]);
      },
    };

    const options = { root: join(root, "workspaces"), sessionId: "session-1", repository, revision };
    const workspace = await prepareWorkspace(options);
    expect(await output(["git", "-C", workspace.path, "remote"])).toBe("");

    await writeFile(join(workspace.path, "README.md"), "changed\n");
    await run(["git", "-C", workspace.path, "add", "."]);
    await commit(workspace.path, "agent change");
    expect(await prepareWorkspace(options)).toEqual(workspace);
  });

  test("rejects unsafe identifiers and revisions", async () => {
    const repository: RepositoryCheckout = { clone: async () => undefined };
    await expect(
      prepareWorkspace({ root: "/tmp", sessionId: "../escape", repository, revision: "a".repeat(40) }),
    ).rejects.toThrow("Invalid workflow session ID");
    await expect(prepareWorkspace({ root: "/tmp", sessionId: "safe", repository, revision: "main" })).rejects.toThrow(
      "Invalid Git commit",
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "factory-workspace-test-"));
  temporaryDirectories.push(path);
  return path;
}

async function commit(directory: string, message: string): Promise<void> {
  await run([
    "git",
    "-C",
    directory,
    "-c",
    "user.name=Factory Test",
    "-c",
    "user.email=factory@example.invalid",
    "commit",
    "--message",
    message,
  ]);
}

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(`${args.join(" ")} failed: ${stderr.trim()}`);
}

async function output(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${stderr.trim()}`);
  return stdout.trim();
}
