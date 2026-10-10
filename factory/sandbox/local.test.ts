import { afterEach, describe, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createLocalDockerSandboxProvider } from "./local.ts";

const IMAGE = process.env.FACTORY_SANDBOX_TEST_IMAGE ?? "factory-coding:test";
const dockerTest = test.skipIf(!hasDockerImage(IMAGE));
const provider = createLocalDockerSandboxProvider({ image: IMAGE });
const keys = new Set<string>();

afterEach(async () => {
  await Promise.all([...keys].map((key) => provider.destroy(key, BACKGROUND_CONTEXT)));
  keys.clear();
}, 30_000);

describe("local Docker Pi execution environment", () => {
  dockerTest(
    "implements Pi filesystem semantics",
    async () => {
      const env = await openEnvironment();

      expect(getOrThrow(await env.absolutePath("tree/file.txt", BACKGROUND_CONTEXT))).toBe("/workspace/tree/file.txt");
      expect(getOrThrow(await env.joinPath(["/workspace", "tree", "file.txt"], BACKGROUND_CONTEXT))).toBe(
        "/workspace/tree/file.txt",
      );

      getOrThrow(await env.createDir("tree/nested", undefined, BACKGROUND_CONTEXT));
      getOrThrow(await env.writeFile("tree/nested/data.bin", Uint8Array.from([0, 1, 2, 255]), BACKGROUND_CONTEXT));
      getOrThrow(await env.appendFile("tree/file.txt", "one\ntwo", BACKGROUND_CONTEXT));
      getOrThrow(await env.appendFile("tree/file.txt", "\nthree", BACKGROUND_CONTEXT));
      getOrThrow(await env.flushFile("tree/file.txt", BACKGROUND_CONTEXT));

      expect(getOrThrow(await env.readBinaryFile("tree/nested/data.bin", BACKGROUND_CONTEXT))).toEqual(
        Uint8Array.from([0, 1, 2, 255]),
      );
      expect(getOrThrow(await env.readTextFile("tree/file.txt", BACKGROUND_CONTEXT))).toBe("one\ntwo\nthree");
      expect(getOrThrow(await env.readTextLines("tree/file.txt", { maxLines: 2 }, BACKGROUND_CONTEXT))).toEqual([
        "one",
        "two",
      ]);

      const reader = getOrThrow(await env.openTextLineReader("tree/file.txt", BACKGROUND_CONTEXT));
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({ text: "one", terminated: true });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({ text: "two", terminated: true });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toEqual({ text: "three", terminated: false });
      expect(getOrThrow(await reader.readLine(BACKGROUND_CONTEXT))).toBeUndefined();
      await reader.close(BACKGROUND_CONTEXT);

      getOrThrow(await env.truncateFile("tree/file.txt", 3, BACKGROUND_CONTEXT));
      getOrThrow(await env.renameFile("tree/file.txt", "tree/renamed.txt", BACKGROUND_CONTEXT));
      expect(getOrThrow(await env.exists("tree/file.txt", BACKGROUND_CONTEXT))).toBeFalse();
      expect(getOrThrow(await env.exists("tree/renamed.txt", BACKGROUND_CONTEXT))).toBeTrue();
      expect(getOrThrow(await env.canonicalPath("tree/renamed.txt", BACKGROUND_CONTEXT))).toBe(
        "/workspace/tree/renamed.txt",
      );

      const info = getOrThrow(await env.fileInfo("tree/renamed.txt", BACKGROUND_CONTEXT));
      expect(info).toMatchObject({ name: "renamed.txt", path: "/workspace/tree/renamed.txt", kind: "file", size: 3 });
      expect(info.mtimeMs).toBeNumber();
      expect(
        getOrThrow(await env.listDir("tree", BACKGROUND_CONTEXT))
          .map(({ name }) => name)
          .sort(),
      ).toEqual(["nested", "renamed.txt"]);

      const temporaryDirectory = getOrThrow(await env.createTempDir("factory-", BACKGROUND_CONTEXT));
      const temporaryFile = getOrThrow(
        await env.createTempFile({ prefix: "factory-", suffix: ".tmp" }, BACKGROUND_CONTEXT),
      );
      expect(getOrThrow(await env.fileInfo(temporaryDirectory, BACKGROUND_CONTEXT)).kind).toBe("directory");
      expect(getOrThrow(await env.fileInfo(temporaryFile, BACKGROUND_CONTEXT)).kind).toBe("file");

      getOrThrow(await env.remove("tree", { recursive: true }, BACKGROUND_CONTEXT));
      expect(getOrThrow(await env.exists("tree", BACKGROUND_CONTEXT))).toBeFalse();
      const missing = await env.readTextFile("tree/renamed.txt", BACKGROUND_CONTEXT);
      expect(missing.ok).toBeFalse();
      if (missing.ok) throw new Error("Expected a missing-file error");
      expect(missing.error.code).toBe("not_found");
    },
    30_000,
  );

  dockerTest(
    "implements Pi shell semantics",
    async () => {
      const env = await openEnvironment();
      getOrThrow(await env.createDir("project", undefined, BACKGROUND_CONTEXT));

      let output = "";
      const executed = getOrThrow(
        await env.exec(
          'printf "out:%s:%s\\n" "$VALUE" "$PWD"; printf "err\\n" >&2; exit 7',
          {
            cwd: "project",
            env: { VALUE: "configured" },
            onOutput: (text) => {
              output += text;
            },
          },
          BACKGROUND_CONTEXT,
        ),
      );
      expect(executed.exitCode).toBe(7);
      expect(output).toContain("out:configured:/workspace/project");
      expect(output).toContain("err");

      const isolated = getOrThrow(
        await env.exec(
          'test "$VALUE" = configured && test -z "$HOME"',
          { env: { VALUE: "configured" }, inheritEnv: false },
          BACKGROUND_CONTEXT,
        ),
      );
      expect(isolated.exitCode).toBe(0);

      const spilled = getOrThrow(
        await env.exec("printf 123456", { spill: { afterBytes: 3, afterLines: 10 } }, BACKGROUND_CONTEXT),
      );
      expect(spilled.spillPath).toBeString();
      expect(getOrThrow(await env.readTextFile(spilled.spillPath ?? "", BACKGROUND_CONTEXT))).toBe("123456");

      const callbackFailure = await env.exec(
        "while true; do printf x; done",
        {
          onOutput: () => {
            throw new Error("stop output");
          },
        },
        BACKGROUND_CONTEXT,
      );
      expect(callbackFailure.ok).toBeFalse();
      if (callbackFailure.ok) throw new Error("Expected a callback error");
      expect(callbackFailure.error.code).toBe("callback_error");
    },
    30_000,
  );

  dockerTest(
    "suspends compute while preserving its namespace",
    async () => {
      const key = sandboxKey();
      const env: ExecutionEnv = await provider.open(key, BACKGROUND_CONTEXT);
      const identity = env.id.replace("docker:local:", "");
      getOrThrow(await env.writeFile("state.txt", "persistent", BACKGROUND_CONTEXT));

      await provider.suspend(key, BACKGROUND_CONTEXT);
      await provider.suspend(key, BACKGROUND_CONTEXT);
      expect(docker("container", "ls", "--all", "--quiet", "--filter", `label=com.factory.sandbox=${identity}`)).toBe(
        "",
      );
      expect(docker("volume", "ls", "--quiet", "--filter", `label=com.factory.sandbox=${identity}`)).not.toBe("");

      const resumed: ExecutionEnv = await createLocalDockerSandboxProvider({ image: IMAGE }).open(
        key,
        BACKGROUND_CONTEXT,
      );
      expect(resumed.id).toBe(env.id);
      expect(getOrThrow(await resumed.readTextFile("state.txt", BACKGROUND_CONTEXT))).toBe("persistent");

      await provider.destroy(key, BACKGROUND_CONTEXT);
      await provider.destroy(key, BACKGROUND_CONTEXT);
      expect(docker("volume", "ls", "--quiet", "--filter", `label=com.factory.sandbox=${identity}`)).toBe("");

      const replacement = await provider.open(key, BACKGROUND_CONTEXT);
      expect(getOrThrow(await replacement.exists("state.txt", BACKGROUND_CONTEXT))).toBeFalse();
    },
    30_000,
  );

  dockerTest(
    "honors cancellation and keeps cleanup non-destructive",
    async () => {
      const env = await openEnvironment();
      getOrThrow(await env.writeFile("state.txt", "keep", BACKGROUND_CONTEXT));

      const timeout = await env.exec("sleep 60", { timeout: 0.1 }, BACKGROUND_CONTEXT);
      expect(timeout.ok).toBeFalse();
      if (timeout.ok) throw new Error("Expected a timeout");
      expect(timeout.error.code).toBe("timeout");

      const controller = new AbortController();
      const cancelled = env.exec("sleep 60", undefined, withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
      await Bun.sleep(100);
      controller.abort();
      const cancellation = await cancelled;
      expect(cancellation.ok).toBeFalse();
      if (cancellation.ok) throw new Error("Expected cancellation");
      expect(cancellation.error.code).toBe("aborted");

      const active = env.exec("sleep 60", undefined, BACKGROUND_CONTEXT);
      await Bun.sleep(100);
      await env.cleanup(BACKGROUND_CONTEXT);
      const cleaned = await active;
      expect(cleaned.ok).toBeFalse();
      if (cleaned.ok) throw new Error("Expected cleanup cancellation");
      expect(cleaned.error.code).toBe("aborted");

      expect(getOrThrow(await env.readTextFile("state.txt", BACKGROUND_CONTEXT))).toBe("keep");
      expect(getOrThrow(await env.exec("true", undefined, BACKGROUND_CONTEXT)).exitCode).toBe(0);
    },
    30_000,
  );
});

async function openEnvironment(): Promise<ExecutionEnv> {
  return provider.open(sandboxKey(), BACKGROUND_CONTEXT);
}

function sandboxKey(): string {
  const key = `test-${crypto.randomUUID()}`;
  keys.add(key);
  return key;
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

function docker(...args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `docker ${args[0]} failed`);
  return result.stdout.toString().trim();
}
