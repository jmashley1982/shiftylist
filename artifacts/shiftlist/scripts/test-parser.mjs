/**
 * Runs the homebaseCsv unit tests without adding a test framework dependency.
 *
 * Bundles src/lib/homebaseCsv.test.ts (and its import of homebaseCsv.ts) with
 * esbuild — already a devDependency for the Worker build — into a temp ESM
 * file, then executes it with Node's built-in test runner (`node:test`).
 *
 * Run via `pnpm --filter @workspace/shiftlist run test`.
 */
import { build as esbuild } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TEST_ENTRYPOINTS = ["src/lib/homebaseCsv.test.ts", "src/lib/employeeMatch.test.ts"];

async function run() {
  const outDir = await mkdtemp(path.join(tmpdir(), "shiftlist-test-"));

  try {
    const outFiles = [];
    for (const entry of TEST_ENTRYPOINTS) {
      const outFile = path.join(outDir, path.basename(entry).replace(/\.ts$/, ".mjs"));
      await esbuild({
        entryPoints: [path.resolve(artifactDir, entry)],
        platform: "node",
        bundle: true,
        format: "esm",
        outfile: outFile,
        logLevel: "info",
      });
      outFiles.push(outFile);
    }

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--test", ...outFiles], { stdio: "inherit" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tests failed (exit ${code})`))));
    });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
