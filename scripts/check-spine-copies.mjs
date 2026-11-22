#!/usr/bin/env node
/**
 * The KENSAURUS spine is vendored twice here (yen-yen ADR 0014 / 0100):
 *   packages/marketing-ui/src/kensaurus/spine                  the "More from KENSAURUS" footer's copy
 *   packages/server/supabase/functions/_shared/kensaurus-spine the edge functions' copy (the
 *       deploy bundles supabase/functions only, so the mail kit must live inside)
 * Each copy's check-spine.mjs proves it matches its own lock; this proves the
 * two locks are the same, so the edge copy cannot fall behind silently.
 * Fix a failure by re-running, from kensaurus/yen-yen:
 *   node scripts/spine-sync.mjs --into <this checkout>
 *   node scripts/spine-sync.mjs --into <this checkout> --dir packages/server/supabase/functions/_shared/kensaurus-spine
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPIES = [
  "packages/marketing-ui/src/kensaurus/spine",
  "packages/server/supabase/functions/_shared/kensaurus-spine",
];

for (const dir of COPIES) {
  execFileSync(process.execPath, [path.join(root, dir, "check-spine.mjs")], { stdio: "inherit" });
}
const locks = COPIES.map((dir) =>
  readFileSync(path.join(root, dir, "spine.lock.json"), "utf8").replace(/\r\n/g, "\n"),
);
if (locks[0] !== locks[1]) {
  console.error(`check-spine-copies: ${COPIES[0]} and ${COPIES[1]} carry different spine locks; re-sync both from kensaurus/yen-yen.`);
  process.exit(1);
}
console.log("check-spine-copies: both vendored copies carry the same spine lock");
