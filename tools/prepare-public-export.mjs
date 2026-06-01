#!/usr/bin/env node
// Create a clean working-tree export for publishing to a fresh public repo.
// This intentionally copies the current tree only, not git history.

import { copyFileSync, existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";

function usage() {
  console.error("Usage: node tools/prepare-public-export.mjs <empty-destination-dir>");
  process.exit(2);
}

const destArg = process.argv[2];
if (!destArg || process.argv.length > 3) usage();

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const dest = resolve(destArg);
const relDest = relative(root, dest);
if (!relDest.startsWith("..") && relDest !== "") {
  throw new Error("destination must be outside the repository working tree");
}
if (existsSync(dest) && readdirSync(dest).length > 0) {
  throw new Error("destination already exists and is not empty: " + dest);
}
mkdirSync(dest, { recursive: true });

const fileList = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "buffer",
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .filter((path) => !path.startsWith(".git/"));

for (const file of fileList) {
  const from = resolve(root, file);
  const to = resolve(dest, file);
  mkdirSync(dirname(to), { recursive: true });
  const stat = lstatSync(from);
  if (stat.isSymbolicLink()) {
    symlinkSync(readlinkSync(from), to);
  } else if (stat.isFile()) {
    copyFileSync(from, to);
  }
}

const manifest = {
  purpose: "Fresh public repository seed generated from the sanitized working tree only.",
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceBranch: execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(),
  fileCount: fileList.length,
  excludesHistory: true,
};
writeFileSync(resolve(dest, "PUBLIC_EXPORT_MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(JSON.stringify({ destination: dest, fileCount: fileList.length, manifest: "PUBLIC_EXPORT_MANIFEST.json" }, null, 2));
