import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { type ExecutionEnv, getOrThrow } from "@earendil-works/pi-durable/env";
import { openDatabase } from "../database.ts";
import { LocalDockerSandboxProvider } from "../sandbox/docker/local.ts";
import { initializeCodingWorkspace, prepareCodingWorkspace } from "./initialize.ts";
import { WorkspaceLifecycle } from "./lifecycle.ts";
import { exportCodingWorkspaceChanges } from "./publish.ts";
import { SqliteWorkspaceStore } from "./sqlite-store.ts";
import { findRemoteBranchHead } from "./update.ts";

const IMAGE = process.env.FACTORY_CODING_TEST_IMAGE ?? "factory-coding:test";
const dockerTest = test.skipIf(!hasDockerImage(IMAGE));
const provider = new LocalDockerSandboxProvider({ image: IMAGE });
const workspaceKeys = new Set<string>();
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all([...workspaceKeys].map((key) => provider.destroy(key, BACKGROUND_CONTEXT)));
  await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
  workspaceKeys.clear();
  directories.clear();
}, 30_000);

describe("Docker coding workspace", () => {
  dockerTest(
    "initializes once and retains repository state across suspension",
    async () => {
      const key = `workspace-${crypto.randomUUID()}`;
      workspaceKeys.add(key);
      const source = await repository();
      const prepared = await prepareCodingWorkspace(source, BACKGROUND_CONTEXT);
      const store = new SqliteWorkspaceStore(openDatabase(":memory:"));
      const lifecycle = new WorkspaceLifecycle({ provider, store });
      let initializations = 0;

      const created = await lifecycle.create(
        key,
        async (env, context) => {
          initializations++;
          await initializeCodingWorkspace(
            env,
            prepared,
            { name: "Factory App", email: "factory-app@example.test" },
            context,
          );
        },
        BACKGROUND_CONTEXT,
      );

      expect(initializations).toBe(1);
      expect(await git(created, "rev-parse HEAD")).toBe(prepared.head);
      expect(await git(created, "config --local user.name")).toBe("Factory App");
      getOrThrow(await created.writeFile("README.md", "agent state\n", BACKGROUND_CONTEXT));

      await lifecycle.suspend(key, BACKGROUND_CONTEXT);
      expect((await store.get(key, BACKGROUND_CONTEXT))?.state).toBe("suspended");

      const resumed = await lifecycle.open(key, BACKGROUND_CONTEXT);
      expect(initializations).toBe(1);
      expect(getOrThrow(await resumed.readTextFile("README.md", BACKGROUND_CONTEXT))).toBe("agent state\n");
      expect(await git(resumed, "rev-parse HEAD")).toBe(prepared.head);
      expect(await findRemoteBranchHead(resumed, "new-branch", BACKGROUND_CONTEXT)).toBeUndefined();
      await git(resumed, "add README.md");
      await git(resumed, "commit -m 'Update README'");
      expect((await exportCodingWorkspaceChanges(resumed, prepared.head, BACKGROUND_CONTEXT)).length).toBeGreaterThan(
        0,
      );

      await lifecycle.destroy(key, BACKGROUND_CONTEXT);
      workspaceKeys.delete(key);
      expect(await store.get(key, BACKGROUND_CONTEXT)).toBeUndefined();
    },
    30_000,
  );
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factory-docker-workspace-"));
  directories.add(directory);
  await run(directory, "git", "init", "--initial-branch=main");
  await run(directory, "git", "config", "user.name", "Source Author");
  await run(directory, "git", "config", "user.email", "source@example.test");
  await writeFile(join(directory, "README.md"), "workspace\n");
  await run(directory, "git", "add", ".");
  await run(directory, "git", "commit", "-m", "initial");
  await run(directory, "git", "remote", "add", "origin", "https://github.com/example/project.git");
  return directory;
}

async function git(env: ExecutionEnv, command: string): Promise<string> {
  let output = "";
  const result = getOrThrow(
    await env.exec(`git ${command}`, { onOutput: (chunk) => (output += chunk) }, BACKGROUND_CONTEXT),
  );
  if (result.exitCode !== 0) throw new Error(`git ${command.split(" ")[0]} failed with exit ${result.exitCode}`);
  return output.trim();
}

async function run(directory: string, ...command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: directory, stdout: "ignore", stderr: "pipe" });
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr.trim()}`);
}

function hasDockerImage(image: string): boolean {
  try {
    return (
      Bun.spawnSync(["docker", "image", "inspect", image], {
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode === 0
    );
  } catch {
    return false;
  }
}
