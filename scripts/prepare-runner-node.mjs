import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const binDir = join(rootDir, "runner", "bin");
mkdirSync(binDir, { recursive: true });

if (process.platform === "win32") {
  copyFileSync(process.execPath, join(binDir, "node.exe"));
}
