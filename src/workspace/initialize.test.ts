import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { initializeCodingWorkspace, prepareCodingWorkspace } from "./initialize.ts";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
  directories.clear();
});

describe("coding workspace initialization", () => {
  test("transfers repository state and configures the GitHub App identity", async () => {
    const source = await repository();
    const destination = await temporaryDirectory("factory-workspace-");
    const prepared = await prepareCodingWorkspace(source, BACKGROUND_CONTEXT);
    const env = new NodeExecutionEnv({ cwd: destination });

    await initializeCodingWorkspace(
      env,
      prepared,
      { name: "Factory App", email: "factory-app@example.test" },
      BACKGROUND_CONTEXT,
    );

    expect(await readFile(join(destination, "README.md"), "utf8")).toBe("workspace\n");
    expect((await lstat(join(destination, "readme-link"))).isSymbolicLink()).toBeTrue();
    expect((await lstat(join(destination, "run.sh"))).mode & 0o111).not.toBe(0);
    expect(await Bun.file(join(destination, ".env")).exists()).toBeFalse();

    expect(await git(destination, "rev-parse", "HEAD")).toBe(prepared.head);
    expect(prepared.headRef).toBe("refs/heads/main");
    expect(await git(destination, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(await git(destination, "show-ref", "--hash", "refs/heads/preserved-ref")).toBe(prepared.head);
    expect(await git(destination, "remote", "get-url", "origin")).toBe("https://github.com/example/project.git");
    expect(await git(destination, "config", "--local", "user.name")).toBe("Factory App");
    expect(await git(destination, "config", "--local", "user.email")).toBe("factory-app@example.test");
    expect(await git(destination, "status", "--porcelain=v1", "--untracked-files=all")).toBe("");
  });

  test("preserves a detached HEAD", async () => {
    const source = await repository();
    const destination = await temporaryDirectory("factory-workspace-");
    await run(source, "git", "checkout", "--detach");
    const prepared = await prepareCodingWorkspace(source, BACKGROUND_CONTEXT);

    await initializeCodingWorkspace(
      new NodeExecutionEnv({ cwd: destination }),
      prepared,
      { name: "Factory App", email: "factory-app@example.test" },
      BACKGROUND_CONTEXT,
    );

    expect(prepared.headRef).toBeUndefined();
    expect(await git(destination, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(await git(destination, "rev-parse", "HEAD")).toBe(prepared.head);
  });

  test("rejects repository-local credentials", async () => {
    const source = await repository();
    await run(source, "git", "config", "--local", "http.https://github.com/.extraheader", "authorization: secret");

    expect(prepareCodingWorkspace(source, BACKGROUND_CONTEXT)).rejects.toThrow(
      "contains credential setting: http.https://github.com/.extraheader",
    );
  });

  test("refuses to merge a repository into a nonempty workspace", async () => {
    const source = await repository();
    const destination = await temporaryDirectory("factory-workspace-");
    await writeFile(join(destination, "existing.txt"), "keep");
    const prepared = await prepareCodingWorkspace(source, BACKGROUND_CONTEXT);
    const env = new NodeExecutionEnv({ cwd: destination });

    expect(
      initializeCodingWorkspace(
        env,
        prepared,
        { name: "Factory App", email: "factory-app@example.test" },
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("Workspace extraction failed");
    expect(await readFile(join(destination, "existing.txt"), "utf8")).toBe("keep");
  });
});

async function repository(): Promise<string> {
  const directory = await temporaryDirectory("factory-source-");
  await run(directory, "git", "init", "--initial-branch=main");
  await run(directory, "git", "config", "user.name", "Source Author");
  await run(directory, "git", "config", "user.email", "source@example.test");
  await writeFile(join(directory, ".gitignore"), ".env\n");
  await writeFile(join(directory, ".env"), "SECRET=do-not-transfer\n");
  await writeFile(join(directory, "README.md"), "workspace\n");
  await writeFile(join(directory, "run.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(join(directory, "run.sh"), 0o755);
  await symlink("README.md", join(directory, "readme-link"));
  await run(directory, "git", "add", ".");
  await run(directory, "git", "commit", "-m", "initial");
  await run(directory, "git", "branch", "preserved-ref");
  await run(directory, "git", "remote", "add", "origin", "https://github.com/example/project.git");
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
