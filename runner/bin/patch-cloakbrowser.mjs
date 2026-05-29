import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetArg = process.argv[2];
const downloadJsPath = targetArg
  ? path.resolve(targetArg)
  : path.resolve(__dirname, "..", "node_modules", "cloakbrowser", "dist", "download.js");

const source = readFileSync(downloadJsPath, "utf8");

const downloadAlreadyPatched = source.includes("DEFAULT_DOWNLOAD_TIMEOUT_MS");
if (downloadAlreadyPatched) {
  process.stdout.write(`[patch-cloakbrowser] download.js already patched: ${downloadJsPath}\n`);
}

const constantsNeedle = `const DOWNLOAD_TIMEOUT_MS = 600_000; // 10 minutes
const UPDATE_CHECK_INTERVAL_MS = 3_600_000; // 1 hour
`;
const constantsReplacement = `const DEFAULT_DOWNLOAD_TIMEOUT_MS = 1_800_000; // 30 minutes
const DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 120_000; // 2 minutes without progress
const UPDATE_CHECK_INTERVAL_MS = 3_600_000; // 1 hour
function getConfiguredTimeout(name, fallbackMs) {
    const raw = process.env[name];
    if (!raw)
        return fallbackMs;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallbackMs;
    return parsed;
}
function createDownloadAbortState(controller) {
    const totalTimeoutMs = getConfiguredTimeout("CLOAKBROWSER_DOWNLOAD_TIMEOUT_MS", DEFAULT_DOWNLOAD_TIMEOUT_MS);
    const inactivityTimeoutMs = getConfiguredTimeout("CLOAKBROWSER_DOWNLOAD_INACTIVITY_TIMEOUT_MS", DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    let totalTimer = setTimeout(() => controller.abort(new Error("CloakBrowser download timed out")), totalTimeoutMs);
    let inactivityTimer = setTimeout(() => controller.abort(new Error("CloakBrowser download stalled")), inactivityTimeoutMs);
    const resetInactivityTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(new Error("CloakBrowser download stalled")), inactivityTimeoutMs);
    };
    return {
        resetInactivityTimer,
        clear() {
            clearTimeout(totalTimer);
            clearTimeout(inactivityTimer);
        },
    };
}
`;

const legacyFunctionNeedle = `async function downloadFile(url, dest) {
    console.log(\`[cloakbrowser] Downloading from \${url}\`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    // Create file stream early so we can ensure cleanup on error
    const fileStream = createWriteStream(dest);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
        });
        if (!response.ok) {
            throw new Error(\`Download failed: HTTP \${response.status} \${response.statusText}\`);
        }
        if (!response.body) {
            throw new Error("Download failed: empty response body");
        }
        const total = Number(response.headers.get("content-length") || 0);
        let downloaded = 0;
        let lastLoggedPct = -1;
        const reader = response.body.getReader();
        // Stream chunks to file with progress logging
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            fileStream.write(value);
            downloaded += value.length;
            if (total > 0) {
                const pct = Math.floor((downloaded / total) * 100);
                if (pct >= lastLoggedPct + 10) {
                    lastLoggedPct = pct;
                    const dlMB = Math.floor(downloaded / (1024 * 1024));
                    const totalMB = Math.floor(total / (1024 * 1024));
                    console.log(\`[cloakbrowser] Download progress: \${pct}% (\${dlMB}/\${totalMB} MB)\`);
                }
            }
        }
        // Wait for file stream to fully close (not just finish)
        await new Promise((resolve, reject) => {
            fileStream.end();
            fileStream.on("close", () => resolve());
            fileStream.on("error", reject);
        });
        const sizeMB = Math.floor(fs.statSync(dest).size / (1024 * 1024));
        console.log(\`[cloakbrowser] Download complete: \${sizeMB} MB\`);
    }
    catch (err) {
        // Ensure file stream is destroyed on error to release the handle
        if (!fileStream.destroyed) {
            await new Promise((resolve) => {
                fileStream.destroy();
                fileStream.on("close", () => resolve());
                // Safety timeout in case close never fires
                setTimeout(resolve, 2000);
            });
        }
        throw err;
    }
    finally {
        clearTimeout(timeout);
    }
}
`;

const functionReplacement = `async function downloadFile(url, dest) {
    console.log(\`[cloakbrowser] Downloading from \${url}\`);
    const controller = new AbortController();
    const abortState = createDownloadAbortState(controller);
    // Create file stream early so we can ensure cleanup on error
    const fileStream = createWriteStream(dest);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
        });
        abortState.resetInactivityTimer();
        if (!response.ok) {
            throw new Error(\`Download failed: HTTP \${response.status} \${response.statusText}\`);
        }
        if (!response.body) {
            throw new Error("Download failed: empty response body");
        }
        const total = Number(response.headers.get("content-length") || 0);
        let downloaded = 0;
        let lastLoggedPct = -1;
        const reader = response.body.getReader();
        // Stream chunks to file with progress logging
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            abortState.resetInactivityTimer();
            fileStream.write(value);
            downloaded += value.length;
            if (total > 0) {
                const pct = Math.floor((downloaded / total) * 100);
                if (pct >= lastLoggedPct + 10) {
                    lastLoggedPct = pct;
                    const dlMB = Math.floor(downloaded / (1024 * 1024));
                    const totalMB = Math.floor(total / (1024 * 1024));
                    console.log(\`[cloakbrowser] Download progress: \${pct}% (\${dlMB}/\${totalMB} MB)\`);
                }
            }
        }
        // Wait for file stream to fully close (not just finish)
        await new Promise((resolve, reject) => {
            fileStream.end();
            fileStream.on("close", () => resolve());
            fileStream.on("error", reject);
        });
        const sizeMB = Math.floor(fs.statSync(dest).size / (1024 * 1024));
        console.log(\`[cloakbrowser] Download complete: \${sizeMB} MB\`);
    }
    catch (err) {
        // Ensure file stream is destroyed on error to release the handle
        if (!fileStream.destroyed) {
            await new Promise((resolve) => {
                fileStream.destroy();
                fileStream.on("close", () => resolve());
                // Safety timeout in case close never fires
                setTimeout(resolve, 2000);
            });
        }
        throw err;
    }
    finally {
        abortState.clear();
    }
}
`;

if (!downloadAlreadyPatched) {
  let patched = source.replace(constantsNeedle, constantsReplacement);
  patched = patched.replace(legacyFunctionNeedle, functionReplacement);

  patched = patched.replace(
    /const UPDATE_CHECK_INTERVAL_MS = 3_600_000; \/\/ 1 hour\r?\nconst UPDATE_CHECK_INTERVAL_MS = 3_600_000; \/\/ 1 hour\r?\n/,
    "const UPDATE_CHECK_INTERVAL_MS = 3_600_000; // 1 hour\n",
  );

  if (patched === source) {
    throw new Error(`[patch-cloakbrowser] Failed to patch ${downloadJsPath}; upstream file shape changed.`);
  }

  writeFileSync(downloadJsPath, patched);
  process.stdout.write(`[patch-cloakbrowser] Patched ${downloadJsPath}\n`);
}

// ---------------------------------------------------------------------------
// Patch config.js: drop the default `--no-sandbox` flag.
//
// `--no-sandbox` is on Chrome's "bad flags" list, so launching with it shows the
// yellow "You are using an unsupported command-line flag: --no-sandbox" infobar.
// Removing it is the stealthiest fix — real Chrome runs sandboxed — and the flag
// cannot be overridden through the public `args` option (dedup is keyed and the
// flag is value-less). On a normal Windows desktop the sandbox works fine.
// ---------------------------------------------------------------------------
const configJsPath = path.resolve(downloadJsPath, "..", "config.js");
let configSource = readFileSync(configJsPath, "utf8");

if (configSource.includes('"--no-sandbox",')) {
  const configPatched = configSource.replace(
    /(\r?\n)\s*"--no-sandbox",(\r?\n)/,
    "$1",
  );
  if (configPatched === configSource) {
    throw new Error(`[patch-cloakbrowser] Failed to remove --no-sandbox in ${configJsPath}; upstream file shape changed.`);
  }
  writeFileSync(configJsPath, configPatched);
  configSource = configPatched;
  process.stdout.write(`[patch-cloakbrowser] Removed default --no-sandbox in ${configJsPath}\n`);
} else {
  process.stdout.write(`[patch-cloakbrowser] config.js already free of default --no-sandbox\n`);
}

const ignoreDefaultArgsNeedle =
  'export const IGNORE_DEFAULT_ARGS = ["--enable-automation", "--enable-unsafe-swiftshader"];';
const ignoreDefaultArgsReplacement =
  'export const IGNORE_DEFAULT_ARGS = ["--enable-automation", "--enable-unsafe-swiftshader", "--no-sandbox"];';

if (configSource.includes(ignoreDefaultArgsNeedle)) {
  const configPatched = configSource.replace(ignoreDefaultArgsNeedle, ignoreDefaultArgsReplacement);
  writeFileSync(configJsPath, configPatched);
  process.stdout.write(`[patch-cloakbrowser] Added --no-sandbox to Playwright ignored default args in ${configJsPath}\n`);
} else if (configSource.includes(ignoreDefaultArgsReplacement)) {
  process.stdout.write(`[patch-cloakbrowser] Playwright ignored default args already include --no-sandbox\n`);
} else {
  throw new Error(`[patch-cloakbrowser] Failed to patch IGNORE_DEFAULT_ARGS in ${configJsPath}; upstream file shape changed.`);
}
