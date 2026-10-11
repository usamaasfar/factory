import { expect, test } from "bun:test";
import { createCommandSandboxEnvironment } from "./environment.ts";

test("rejects invalid sandbox identity and working directory", () => {
  const run = async () => ({ exitCode: 0 });
  expect(() => createCommandSandboxEnvironment({ id: "", cwd: "/workspace", run })).toThrow("Sandbox id");
  expect(() => createCommandSandboxEnvironment({ id: "test", cwd: "relative", run })).toThrow("absolute POSIX");
});
