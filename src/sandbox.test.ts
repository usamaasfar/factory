import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DockerSandbox } from "./sandbox.ts";

const image = "factory-sandbox:test";
let sandbox: DockerSandbox;

beforeAll(async () => {
  const build = Bun.spawn(["docker", "build", "--tag", image, "--file", "src/sandbox/Dockerfile", "."], {
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await build.exited).toBe(0);
  sandbox = await DockerSandbox.start(image);
}, 120_000);

afterAll(async () => {
  await sandbox?.stop();
});

describe("DockerSandbox", () => {
  test("executes commands and exchanges files", async () => {
    const process = await sandbox.exec("pwd");
    expect(process).toEqual({ exitCode: 0, stdout: "/workspace\n", stderr: "" });

    await sandbox.write("notes/hello.txt", "hello from factory\n");
    expect(await sandbox.read("notes/hello.txt")).toBe("hello from factory\n");

    const fromShell = await sandbox.exec("cat notes/hello.txt");
    expect(fromShell.stdout).toBe("hello from factory\n");
  });

  test("rejects file paths outside the workspace", async () => {
    expect(sandbox.read("../etc/passwd")).rejects.toThrow("Path is outside the workspace");
  });
});
