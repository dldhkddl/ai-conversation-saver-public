import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const releaseDir = join(root, "release", "ai-conversation-saver");
const bundledMain = join(releaseDir, "main.js");

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: bundledMain,
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "browser",
  target: "es2018",
  sourcemap: false,
  logLevel: "info"
});

await cp(bundledMain, join(root, "main.js"), { force: true });
await cp(join(root, "src", "styles.css"), join(root, "styles.css"), { force: true });
await cp(join(root, "src", "styles.css"), join(releaseDir, "styles.css"), { force: true });
await cp(join(root, "manifest.json"), join(releaseDir, "manifest.json"), { force: true });
