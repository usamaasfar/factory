import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE_IMAGE = "debian@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251";
const IMAGE_FORMAT_VERSION = 2;
const IMAGE_LABEL = "com.factory.environment.digest";

/** Builds or reuses the OCI image for a trusted managed environment script. */
export async function buildEnvironmentImage(source: string): Promise<string> {
  const filesystem = await readFile(new URL("./filesystem.ts", import.meta.url), "utf8");
  const digest = createHash("sha256")
    .update(JSON.stringify({ baseImage: BASE_IMAGE, formatVersion: IMAGE_FORMAT_VERSION }))
    .update("\0")
    .update(source)
    .update("\0")
    .update(filesystem)
    .digest("hex");
  const image = `factory-environment:${digest}`;

  if ((await imageLabel(image, IMAGE_LABEL)) === digest) return image;

  const context = await mkdtemp(join(tmpdir(), "factory-environment-"));
  try {
    await writeFile(join(context, "environment"), source);
    await writeFile(join(context, "filesystem.ts"), filesystem);
    await writeFile(
      join(context, "Containerfile"),
      `FROM ${BASE_IMAGE}
COPY --chmod=755 environment /tmp/environment
RUN /tmp/environment && rm /tmp/environment
RUN command -v bash && command -v bun && command -v git
COPY filesystem.ts /usr/local/lib/factory/filesystem.ts
RUN useradd --create-home --uid 1000 factory && mkdir /workspace && chown factory:factory /workspace
USER factory
WORKDIR /workspace
CMD ["sleep", "infinity"]
`,
    );
    await run([
      "docker",
      "build",
      "--file",
      join(context, "Containerfile"),
      "--label",
      `${IMAGE_LABEL}=${digest}`,
      "--tag",
      image,
      context,
    ]);
    return image;
  } finally {
    await rm(context, { recursive: true, force: true });
  }
}

async function imageLabel(image: string, label: string): Promise<string | undefined> {
  const child = Bun.spawn(
    ["docker", "image", "inspect", "--format", `{{index .Config.Labels ${JSON.stringify(label)}}}`, image],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  const stdout = await new Response(child.stdout).text();
  return (await child.exited) === 0 ? stdout.trim() : undefined;
}

async function run(args: string[]): Promise<void> {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`${args[0]} ${args[1] ?? ""} failed`);
}
