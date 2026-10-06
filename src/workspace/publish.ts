import type { Context } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import { getOrThrow } from "@earendil-works/pi-durable/env";

/** Exports clean commits, optionally requiring them to descend from an expected head. */
export async function exportCodingWorkspaceChanges(
  env: ExecutionEnv,
  expectedHead: string | undefined,
  context: Context,
): Promise<Uint8Array> {
  const base = expectedHead ? commitId(expectedHead) : undefined;
  const status = await gitOutput(env, "status --porcelain=v1 --untracked-files=all", context);
  if (status) throw new Error("Workspace has uncommitted changes");

  const head = await gitOutput(env, "rev-parse --verify 'HEAD^{commit}'", context);
  if (head === base) throw new Error("Workspace has no new commits");

  const path = getOrThrow(await env.createTempFile({ prefix: "factory-changes-", suffix: ".bundle" }, context));
  try {
    const result = getOrThrow(
      await env.exec(
        base
          ? 'git merge-base --is-ancestor "$FACTORY_EXPECTED_HEAD" HEAD || exit 64\n' +
              'git bundle create "$FACTORY_BUNDLE" HEAD "^$FACTORY_EXPECTED_HEAD"'
          : 'git bundle create "$FACTORY_BUNDLE" HEAD',
        { env: { ...(base ? { FACTORY_EXPECTED_HEAD: base } : {}), FACTORY_BUNDLE: path } },
        context,
      ),
    );
    if (base && result.exitCode === 64) {
      throw new Error("Workspace commits do not fast-forward the expected branch head");
    }
    if (result.exitCode !== 0) throw new Error(`Could not create workspace Git bundle (exit ${result.exitCode})`);

    const bundle = getOrThrow(await env.readBinaryFile(path, context));
    if (bundle.length === 0) throw new Error("Workspace Git bundle is empty");
    return bundle;
  } finally {
    await env.remove(path, { force: true }, withoutAbortSignal(context));
  }
}

async function gitOutput(env: ExecutionEnv, command: string, context: Context): Promise<string> {
  let output = "";
  const result = getOrThrow(await env.exec(`git ${command}`, { onOutput: (chunk) => (output += chunk) }, context));
  if (result.exitCode !== 0) throw new Error(`git ${command.split(" ")[0]} failed with exit ${result.exitCode}`);
  return output.trim();
}

function commitId(value: string): string {
  if (!/^[0-9a-f]{40,64}$/i.test(value)) throw new TypeError("Expected head must be a full Git commit ID");
  return value.toLowerCase();
}
