/**
 * FILE: scripts/kill-port.mjs
 * PURPOSE: Cross-platform port killer — finds and terminates any process
 *          listening on the given port(s) so dev servers start clean.
 *
 * USAGE:
 *   node scripts/kill-port.mjs 6464
 *   node scripts/kill-port.mjs 6464 3000 5173
 */

import { execSync } from "node:child_process";

const ports = process.argv.slice(2).map(Number).filter(Boolean);

const tag = "\x1b[2m[kill-port]\x1b[0m";

if (ports.length === 0) {
  console.log(`${tag} no ports specified, nothing to do`);
  process.exit(0);
}

const isWin = process.platform === "win32";

for (const port of ports) {
  try {
    if (isWin) {
      const out = execSync(`netstat -aon | findstr :${port} | findstr LISTENING`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pids = [
        ...new Set(
          out
            .split("\n")
            .map((l) => l.trim().split(/\s+/).pop())
            .filter((p) => p && /^\d+$/.test(p))
        ),
      ];
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          console.log(`${tag} killed PID \x1b[33m${pid}\x1b[0m on port \x1b[36m${port}\x1b[0m`);
        } catch {}
      }
    } else {
      const pids = execSync(`lsof -ti:${port}`, { encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: "ignore" });
          console.log(`${tag} killed PID \x1b[33m${pid}\x1b[0m on port \x1b[36m${port}\x1b[0m`);
        } catch {}
      }
    }
  } catch {
    console.log(`${tag} port \x1b[36m${port}\x1b[0m is free`);
  }
}
