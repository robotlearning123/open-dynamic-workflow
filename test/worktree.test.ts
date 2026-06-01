import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withWorktree, canWorktree } from "../src/worktree.js";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "odw-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t.dev"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  writeFileSync(join(dir, "f.txt"), "hello");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
  return dir;
}

describe("withWorktree (opt-in isolation)", () => {
  it("runs fn in a fresh isolated worktree (with committed files) and cleans up", async () => {
    const repo = initRepo();
    expect(canWorktree(repo)).toBe(true);
    let seenDir = "";
    const out = await withWorktree(repo, async (dir) => {
      seenDir = dir;
      expect(dir).not.toBe(repo); // isolated path
      expect(existsSync(join(dir, "f.txt"))).toBe(true); // committed content present
      return "ok";
    });
    expect(out).toBe("ok");
    expect(existsSync(seenDir)).toBe(false); // worktree removed afterward
  });

  it("falls back to running in-place when the root is not a git repo", async () => {
    const plain = mkdtempSync(join(tmpdir(), "odw-plain-"));
    expect(canWorktree(plain)).toBe(false);
    const dir = await withWorktree(plain, async (d) => d);
    expect(dir).toBe(plain); // no isolation, ran in-place
  });
});
