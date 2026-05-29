import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import net from "node:net";
import { execFile } from "node:child_process";

interface LaunchPayload {
  profile: Profile;
  profileDataDir: string;
  proxy?: ProxyConfig | null;
}

interface Profile {
  id: string;
  name: string;
  settings: ProfileSettings;
}

interface ProfileSettings {
  fingerprintSeed: string;
  platform: string;
  userAgent: string;
  locale: string;
  timezone: string;
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
  humanizeEnabled: boolean;
  humanPreset: "default" | "careful";
  geoipEnabled: boolean;
  webrtcMode: "auto" | "disabled" | "explicit";
  webrtcIp: string;
  startupUrl: string;
  extensionPaths: string[];
  extraArgs: string[];
}

interface ProxyConfig {
  scheme: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypass?: string;
}

interface GeoResult {
  timezone?: string;
  locale?: string;
}

const IP_ECHO_URLS = ["https://api.ipify.org", "https://checkip.amazonaws.com", "https://ifconfig.me/ip"];
const GEOIP_URLS = ["https://ipapi.co/json/", "https://ipwho.is/", "https://get.geojs.io/v1/ip/geo.json"];

const COUNTRY_LOCALE_MAP: Record<string, string> = {
  US: "en-US",
  GB: "en-GB",
  AU: "en-AU",
  CA: "en-CA",
  NZ: "en-NZ",
  IE: "en-IE",
  ZA: "en-ZA",
  SG: "en-SG",
  DE: "de-DE",
  AT: "de-AT",
  CH: "de-CH",
  FR: "fr-FR",
  BE: "fr-BE",
  ES: "es-ES",
  MX: "es-MX",
  AR: "es-AR",
  CO: "es-CO",
  CL: "es-CL",
  BR: "pt-BR",
  PT: "pt-PT",
  IT: "it-IT",
  NL: "nl-NL",
  JP: "ja-JP",
  KR: "ko-KR",
  CN: "zh-CN",
  TW: "zh-TW",
  HK: "zh-HK",
  RU: "ru-RU",
  UA: "uk-UA",
  PL: "pl-PL",
  CZ: "cs-CZ",
  RO: "ro-RO",
  IL: "he-IL",
  TR: "tr-TR",
  SA: "ar-SA",
  AE: "ar-AE",
  EG: "ar-EG",
  IN: "hi-IN",
  ID: "id-ID",
  PH: "en-PH",
  TH: "th-TH",
  VN: "vi-VN",
  MY: "ms-MY",
  SE: "sv-SE",
  NO: "nb-NO",
  DK: "da-DK",
  FI: "fi-FI",
  GR: "el-GR",
  HU: "hu-HU",
  BG: "bg-BG",
};

function parseVersion(version: string) {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }

  return 0;
}

function canUseBinary(binaryPath: string) {
  try {
    accessSync(binaryPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findCachedCloakBrowserBinary() {
  const cacheDir = process.env.CLOAKBROWSER_CACHE_DIR || path.join(os.homedir(), ".cloakbrowser");
  if (!existsSync(cacheDir)) return undefined;

  const candidates = readdirSync(cacheDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium-"))
    .map((entry) => {
      const version = entry.name.slice("chromium-".length);
      const binaryPath = path.join(cacheDir, entry.name, "chrome.exe");
      return { version, binaryPath };
    })
    .filter((entry) => canUseBinary(entry.binaryPath))
    .sort((left, right) => compareVersions(right.version, left.version));

  return candidates[0]?.binaryPath;
}

function configureLocalBinaryOverride() {
  if (process.env.CLOAKBROWSER_BINARY_PATH && canUseBinary(process.env.CLOAKBROWSER_BINARY_PATH)) {
    return;
  }

  const cachedBinary = findCachedCloakBrowserBinary();
  if (!cachedBinary) return;

  process.env.CLOAKBROWSER_BINARY_PATH = cachedBinary;
  console.log(`[runner] Reusing cached CloakBrowser binary: ${cachedBinary}`);
}

function proxyUrl(proxy?: ProxyConfig | null) {
  if (!proxy || proxy.scheme === "system") return undefined;
  if (!proxy.host) return undefined;
  const auth =
    proxy.username && proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : "";
  return `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`;
}

function parseSystemProxyValue(value: string, bypass?: string) {
  const entries = value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidates = entries.length > 1 ? entries : [value.trim()];

  for (const candidate of candidates) {
    const [rawScheme, rawTarget] = candidate.includes("=") ? candidate.split("=", 2) : ["http", candidate];
    const scheme = rawScheme.trim().toLowerCase();
    const target = rawTarget.trim();
    if (!target) continue;

    const normalizedScheme = scheme === "socks" ? "socks5" : scheme === "https" ? "https" : "http";
    const withScheme = /^[a-z]+:\/\//i.test(target) ? target : `${normalizedScheme}://${target}`;

    try {
      const parsed = new URL(withScheme);
      const port =
        parsed.port ||
        (parsed.protocol === "https:" ? "443" : parsed.protocol.startsWith("socks") ? "1080" : "80");

      return {
        scheme: parsed.protocol.replace(":", ""),
        host: parsed.hostname,
        port: Number.parseInt(port, 10),
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        bypass,
      } satisfies ProxyConfig;
    } catch {
      continue;
    }
  }

  return undefined;
}

function buildArgs(settings: ProfileSettings, proxy?: ProxyConfig | null, disableProxy = false) {
  const args = [...settings.extraArgs];
  // Suppress the "restore pages?" bubble if a previous session ended uncleanly
  // (e.g. a forced kill). The graceful-shutdown path below normally prevents a
  // dirty exit, but this keeps the next launch looking like a normal Chrome.
  args.push("--hide-crash-restore-bubble");
  if (settings.fingerprintSeed) args.push(`--fingerprint=${settings.fingerprintSeed}`);
  if (settings.platform !== "auto") args.push(`--fingerprint-platform=${settings.platform}`);
  if (settings.screenWidth && settings.screenHeight) {
    args.push(`--window-size=${settings.screenWidth},${settings.screenHeight}`);
  }
  if (settings.webrtcMode === "auto") args.push("--fingerprint-webrtc-ip=auto");
  if (settings.webrtcMode === "explicit" && settings.webrtcIp) {
    args.push(`--fingerprint-webrtc-ip=${settings.webrtcIp}`);
  }
  if (settings.webrtcMode === "disabled") args.push("--disable-webrtc");
  if (disableProxy && !proxy) args.push("--no-proxy-server");
  return args;
}

function requestText(url: string) {
  return new Promise<string | null>((resolve) => {
    const request = https.request(url, { timeout: 5000 }, (response) => {
      let data = "";
      response.on("data", (chunk) => {
        data += chunk.toString();
      });
      response.on("end", () => {
        resolve(response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? data : null);
      });
    });
    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

function requestTextViaSystemProxy(url: string) {
  return new Promise<string | null>((resolve) => {
    const command =
      `$ProgressPreference='SilentlyContinue';` +
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` +
      `try {(Invoke-WebRequest -UseBasicParsing -Uri '${url}' -TimeoutSec 5).Content} catch {exit 1}`;

    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function runPowerShell(script: string) {
  return new Promise<{ stdout: string; stderr: string; error: Error | null }>((resolve) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: 7000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          error: error instanceof Error ? error : null,
        });
      },
    );
  });
}

function resolveSystemProxyFromWindows() {
  return new Promise<ProxyConfig | undefined>((resolve) => {
    const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
try {
  $props = Get-ItemProperty -Path $key
  if (-not $props.ProxyEnable -or [string]::IsNullOrWhiteSpace($props.ProxyServer)) { exit 0 }
  [pscustomobject]@{
    proxyServer = [string]$props.ProxyServer
    proxyOverride = if ($props.ProxyOverride) { [string]$props.ProxyOverride } else { '' }
    autoConfigUrl = if ($props.AutoConfigURL) { [string]$props.AutoConfigURL } else { '' }
  } | ConvertTo-Json -Compress
} catch {
  exit 1
}
`;

    runPowerShell(script).then(({ error, stdout }) => {
        if (error || !stdout.trim()) {
          resolve(undefined);
          return;
        }

        try {
          const data = JSON.parse(stdout) as { proxyServer?: string; proxyOverride?: string; autoConfigUrl?: string };
          const proxy = data.proxyServer ? parseSystemProxyValue(data.proxyServer, data.proxyOverride || undefined) : undefined;
          if (!proxy && data.autoConfigUrl) {
            console.warn(`[runner] System proxy uses PAC script ${data.autoConfigUrl}, which cannot be converted to an explicit proxy.`);
          }
          resolve(proxy);
        } catch {
          resolve(undefined);
        }
      });
  });
}

async function resolveDirectExitIp() {
  for (const url of IP_ECHO_URLS) {
    const body = (await requestText(url))?.trim();
    if (body && net.isIP(body)) return body;
  }
  return undefined;
}

async function resolveSystemProxyExitIp() {
  for (const url of IP_ECHO_URLS) {
    const body = (await requestTextViaSystemProxy(url))?.trim();
    if (body && net.isIP(body)) return body;
  }
  return undefined;
}

function parseGeoBody(body: string): GeoResult {
  const data = JSON.parse(body) as {
    timezone?: string | { id?: string };
    time_zone?: string;
    country_code?: string;
    countryCode?: string;
    country?: { iso_code?: string };
    success?: boolean;
  };
  if (data.success === false) return {};

  const timezone =
    typeof data.timezone === "string" ? data.timezone : data.timezone?.id || data.time_zone || undefined;
  const countryCode = (data.country_code || data.countryCode || data.country?.iso_code)?.toUpperCase();
  return {
    timezone,
    locale: countryCode ? COUNTRY_LOCALE_MAP[countryCode] : undefined,
  };
}

async function resolveGeo(requester: (url: string) => Promise<string | null>): Promise<GeoResult> {
  for (const url of GEOIP_URLS) {
    const body = await requester(url);
    if (!body) continue;

    try {
      const geo = parseGeoBody(body);
      if (geo.timezone || geo.locale) return geo;
    } catch {
      continue;
    }
  }

  return {};
}

async function resolveDirectGeo() {
  return resolveGeo(requestText);
}

async function resolveSystemProxyGeo() {
  return resolveGeo(requestTextViaSystemProxy);
}

async function launch(payloadPath: string) {
  configureLocalBinaryOverride();
  const { launchPersistentContext } = await import("cloakbrowser");
  const payload = JSON.parse(await readFile(payloadPath, "utf8")) as LaunchPayload;
  const settings = payload.profile.settings;
  const useGeoIpDetection = settings.geoipEnabled;
  const selectedSystemProxy = payload.proxy?.scheme === "system";
  const resolvedSystemProxy = selectedSystemProxy ? await resolveSystemProxyFromWindows() : undefined;
  const explicitProxy =
    selectedSystemProxy ? resolvedSystemProxy : payload.proxy && payload.proxy.scheme !== "system" ? payload.proxy : undefined;
  const directConnection = !payload.proxy;
  const currentNetworkFallback = selectedSystemProxy && !explicitProxy;
  let resolvedTimezone = useGeoIpDetection ? undefined : settings.timezone || undefined;
  let resolvedLocale = useGeoIpDetection ? undefined : settings.locale || undefined;
  let resolvedExitIp: string | undefined;
  let launchArgs = buildArgs(settings, explicitProxy, directConnection);

  if (useGeoIpDetection && directConnection) {
    const [geo, exitIp] = await Promise.all([resolveDirectGeo(), resolveDirectExitIp()]);
    resolvedTimezone = geo.timezone;
    resolvedLocale = geo.locale;
    resolvedExitIp = exitIp;
    if (exitIp && settings.webrtcMode === "auto" && !launchArgs.some((arg) => arg.startsWith("--fingerprint-webrtc-ip="))) {
      launchArgs = [...launchArgs, `--fingerprint-webrtc-ip=${exitIp}`];
    }
  }

  if (useGeoIpDetection && currentNetworkFallback) {
    const [geo, exitIp] = await Promise.all([resolveSystemProxyGeo(), resolveSystemProxyExitIp()]);
    resolvedTimezone = geo.timezone;
    resolvedLocale = geo.locale;
    resolvedExitIp = exitIp;
    if (exitIp && settings.webrtcMode === "auto" && !launchArgs.some((arg) => arg.startsWith("--fingerprint-webrtc-ip="))) {
      launchArgs = [...launchArgs, `--fingerprint-webrtc-ip=${exitIp}`];
    }
    console.warn(
      "[runner] System proxy selected but no explicit Windows proxy server could be resolved; using current network path geo resolution instead.",
    );
  }

  console.log(
    `[runner] Launch network path=${directConnection ? "direct" : currentNetworkFallback ? "system-network" : selectedSystemProxy ? "system-proxy" : "saved-proxy"} ` +
      `resolvedProxy=${proxyUrl(explicitProxy) ?? "none"} ` +
      `resolvedExitIp=${resolvedExitIp ?? "unset"} ` +
      `resolvedTimezone=${resolvedTimezone ?? "unset"} resolvedLocale=${resolvedLocale ?? "unset"}`,
  );

  const context = await launchPersistentContext({
    userDataDir: payload.profileDataDir,
    headless: false,
    proxy: proxyUrl(explicitProxy),
    args: launchArgs,
    timezone: useGeoIpDetection && !!explicitProxy ? undefined : resolvedTimezone,
    locale: useGeoIpDetection && !!explicitProxy ? undefined : resolvedLocale,
    userAgent: settings.userAgent || undefined,
    viewport: {
      width: settings.viewportWidth,
      height: settings.viewportHeight,
    },
    contextOptions: {
      deviceScaleFactor: settings.deviceScaleFactor,
    },
    humanize: settings.humanizeEnabled,
    humanPreset: settings.humanPreset === "default" ? undefined : settings.humanPreset,
    geoip: useGeoIpDetection && !!explicitProxy,
    extensionPaths: settings.extensionPaths.length ? settings.extensionPaths : undefined,
    launchOptions: {
      // Playwright defaults Chromium sandboxing to false and appends
      // --no-sandbox. CloakBrowser removes its own default flag, but without
      // this Playwright still triggers Chrome's unsupported-flag infobar.
      chromiumSandbox: true,
    },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  if (settings.startupUrl) {
    try {
      await page.goto(settings.startupUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch (error) {
      console.warn(
        `[runner] Startup navigation failed for ${settings.startupUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  process.stdout.write(
    JSON.stringify({
      type: "ready",
      profileId: payload.profile.id,
      message: "CloakBrowser profile launched",
    }) + "\n",
  );

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      await context.close();
    } catch {
      // Context may already be gone; exit cleanly regardless.
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  // Windows has no real SIGTERM, so the manager signals shutdown by closing the
  // runner's stdin. Treat stdin EOF (or an explicit "stop" line) as a request to
  // close the browser gracefully — this lets Chrome flush a clean exit_type and
  // avoids the "Chrome didn't shut down correctly" crash bubble on next launch.
  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    if (chunk.toString().includes("stop")) void close();
  });
  process.stdin.on("end", () => void close());
  process.stdin.on("close", () => void close());
}

async function main() {
  const [command, payloadPath] = process.argv.slice(2);
  if (command !== "launch" || !payloadPath) {
    throw new Error("Usage: node runner/dist/index.js launch <payload-json>");
  }
  await launch(payloadPath);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
