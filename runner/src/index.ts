import { readFile } from "node:fs/promises";
import process from "node:process";
import { launchPersistentContext } from "cloakbrowser";

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

function proxyUrl(proxy?: ProxyConfig | null) {
  if (!proxy || !proxy.host) return undefined;
  const auth =
    proxy.username && proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : "";
  return `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`;
}

function buildArgs(settings: ProfileSettings) {
  const args = [...settings.extraArgs];
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
  return args;
}

async function launch(payloadPath: string) {
  const payload = JSON.parse(await readFile(payloadPath, "utf8")) as LaunchPayload;
  const settings = payload.profile.settings;
  const context = await launchPersistentContext({
    userDataDir: payload.profileDataDir,
    headless: false,
    proxy: proxyUrl(payload.proxy),
    args: buildArgs(settings),
    timezone: settings.timezone || undefined,
    locale: settings.locale || undefined,
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
    geoip: settings.geoipEnabled,
    extensionPaths: settings.extensionPaths.length ? settings.extensionPaths : undefined,
  });

  const page = context.pages()[0] ?? (await context.newPage());
  if (settings.startupUrl) await page.goto(settings.startupUrl);

  process.stdout.write(
    JSON.stringify({
      type: "ready",
      profileId: payload.profile.id,
      message: "CloakBrowser profile launched",
    }) + "\n",
  );

  const close = async () => {
    try {
      await context.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", close);
  process.on("SIGTERM", close);
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
