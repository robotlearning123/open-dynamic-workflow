import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Worktree isolation for opts.isolation:'worktree' — the raw engine runs file-mutating parallel
// subagents in separate git worktrees so they don't collide. We reproduce that: provision a fresh
// detached worktree, run the agent with cwd there, then remove it. Opt-in and graceful — if the
// root isn't a git repo (or has no commit), we run in-place without isolation.

/** True only if `dir` is inside a git work tree that has at least one commit (HEAD resolvable). */
export function canWorktree(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `fn` in a fresh detached git worktree of `repoRoot`, always cleaning up afterwards.
 * Falls back to running `fn(repoRoot)` (no isolation) when `repoRoot` cannot host a worktree.
 */
export async function withWorktree<T>(repoRoot: string, fn: (dir: string) => Promise<T>): Promise<T> {
  if (!canWorktree(repoRoot)) {
    return fn(repoRoot);
  }
  const base = mkdtempSync(join(tmpdir(), "odw-wt-"));
  const wt = join(base, "wt");
  execFileSync("git", ["-C", repoRoot, "worktree", "add", "--detach", "-q", wt], { stdio: "pipe" });
  try {
    return await fn(wt);
  } finally {
    try {
      execFileSync("git", ["-C", repoRoot, "worktree", "remove", "--force", wt], { stdio: "pipe" });
    } catch {
      /* best-effort cleanup */
    }
    try {
      if (existsSync(base)) rmSync(base, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}
