import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const repoRoot = resolve(pkgRoot, "..", "..");

const copies = [
  {
    from: resolve(repoRoot, "packages/android/src/main/kotlin"),
    to: resolve(pkgRoot, "android/mushi-android/src/main/kotlin"),
  },
  {
    from: resolve(repoRoot, "packages/android/consumer-rules.pro"),
    to: resolve(pkgRoot, "android/mushi-android/consumer-rules.pro"),
  },
  {
    from: resolve(repoRoot, "packages/ios/Sources/MushiMushi"),
    to: resolve(pkgRoot, "ios/MushiMushi/Sources/MushiMushi"),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    throw new Error(`Native source path does not exist: ${from}`);
  }

  rmSync(to, { recursive: true, force: true });
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}
