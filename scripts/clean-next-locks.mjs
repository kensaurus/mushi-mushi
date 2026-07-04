/**
 * Remove stale Next.js dev lock files when the recorded PID is no longer alive.
 * Without this, `next dev` refuses to start even after the port is free.
 *
 * USAGE: node scripts/clean-next-locks.mjs [app-dir ...]
 * Default dirs: apps/docs apps/testers
 */

import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = "\x1b[2m[clean-next-locks]\x1b[0m";

const defaultDirs = ["apps/docs", "apps/testers"];
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : defaultDirs;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the PID exists but is owned by another user — treat as
    // alive rather than deleting a live lock. ESRCH (or any other error)
    // means no such process.
    return err?.code === "EPERM";
  }
}

for (const rel of dirs) {
  const lockPath = resolve(root, rel, ".next/dev/lock");
  if (!existsSync(lockPath)) continue;
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const meta = JSON.parse(raw);
    const pid = Number(meta?.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      unlinkSync(lockPath);
      console.log(`${tag} removed invalid lock at ${rel}`);
      continue;
    }
    if (pidAlive(pid)) {
      console.log(`${tag} lock at ${rel} still owned by PID ${pid} — left in place`);
      continue;
    }
    unlinkSync(lockPath);
    console.log(`${tag} removed stale lock at ${rel} (dead PID ${pid})`);
  } catch (err) {
    try {
      unlinkSync(lockPath);
      console.log(`${tag} removed unreadable lock at ${rel}`);
    } catch {
      console.warn(`${tag} could not clean ${lockPath}:`, err);
    }
  }
}
