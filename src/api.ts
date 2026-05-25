import { invoke } from "@tauri-apps/api/core";
import { defaultSettings, type LaunchEvent, type Profile, type ProxyConfig, type SystemInfo } from "./types";

const profilesKey = "cloak-local-manager.profiles";
const proxiesKey = "cloak-local-manager.proxies";
const eventsKey = "cloak-local-manager.events";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

export async function listProfiles(): Promise<Profile[]> {
  if (isTauri()) return invoke("list_profiles");
  return read<Profile[]>(profilesKey, []);
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  if (isTauri()) return invoke("save_profile", { profile });
  const profiles = read<Profile[]>(profilesKey, []);
  const existing = profiles.findIndex((item) => item.id === profile.id);
  const next = { ...profile, updatedAt: now() };
  if (existing >= 0) profiles[existing] = next;
  else profiles.unshift(next);
  write(profilesKey, profiles);
  return next;
}

export async function createProfile(): Promise<Profile> {
  return {
    id: id(),
    name: "New profile",
    groupName: "",
    tags: [],
    notes: "",
    status: "stopped",
    createdAt: now(),
    updatedAt: now(),
    settings: { ...defaultSettings, fingerprintSeed: String(Math.floor(Math.random() * 1_000_000_000)) },
  };
}

export async function deleteProfile(profileId: string, removeData: boolean): Promise<void> {
  if (isTauri()) return invoke("delete_profile", { profileId, removeData });
  write(
    profilesKey,
    read<Profile[]>(profilesKey, []).filter((profile) => profile.id !== profileId),
  );
}

export async function duplicateProfile(profile: Profile): Promise<Profile> {
  const copy: Profile = {
    ...profile,
    id: id(),
    name: `${profile.name} copy`,
    status: "stopped",
    cdpUrl: undefined,
    createdAt: now(),
    updatedAt: now(),
    lastLaunchedAt: undefined,
  };
  return saveProfile(copy);
}

export async function listProxies(): Promise<ProxyConfig[]> {
  if (isTauri()) return invoke("list_proxies");
  return read<ProxyConfig[]>(proxiesKey, []);
}

export async function saveProxy(proxy: ProxyConfig): Promise<ProxyConfig> {
  if (isTauri()) return invoke("save_proxy", { proxy });
  const proxies = read<ProxyConfig[]>(proxiesKey, []);
  const existing = proxies.findIndex((item) => item.id === proxy.id);
  if (existing >= 0) proxies[existing] = proxy;
  else proxies.unshift(proxy);
  write(proxiesKey, proxies);
  return proxy;
}

export async function createProxy(): Promise<ProxyConfig> {
  return { id: id(), name: "New proxy", scheme: "http", host: "", port: 8080 };
}

export async function launchProfile(profileId: string): Promise<LaunchEvent> {
  if (isTauri()) return invoke("launch_profile", { profileId });
  const event: LaunchEvent = {
    profileId,
    status: "running",
    message: "Mock launch in web preview. Build the Tauri app to launch CloakBrowser.",
    cdpUrl: "http://127.0.0.1:0/devtools/browser/mock",
    at: now(),
  };
  const profiles = read<Profile[]>(profilesKey, []).map((profile) =>
    profile.id === profileId
      ? { ...profile, status: "running" as const, cdpUrl: event.cdpUrl, lastLaunchedAt: event.at }
      : profile,
  );
  write(profilesKey, profiles);
  write(eventsKey, [event, ...read<LaunchEvent[]>(eventsKey, [])].slice(0, 100));
  return event;
}

export async function stopProfile(profileId: string): Promise<LaunchEvent> {
  if (isTauri()) return invoke("stop_profile", { profileId });
  const event: LaunchEvent = {
    profileId,
    status: "stopped",
    message: "Mock profile stopped.",
    at: now(),
  };
  const profiles = read<Profile[]>(profilesKey, []).map((profile) =>
    profile.id === profileId ? { ...profile, status: "stopped" as const, cdpUrl: undefined } : profile,
  );
  write(profilesKey, profiles);
  write(eventsKey, [event, ...read<LaunchEvent[]>(eventsKey, [])].slice(0, 100));
  return event;
}

export async function listEvents(): Promise<LaunchEvent[]> {
  if (isTauri()) return invoke("list_launch_events");
  return read<LaunchEvent[]>(eventsKey, []);
}

export async function openProfileFolder(profileId: string): Promise<void> {
  if (isTauri()) return invoke("open_profile_folder", { profileId });
  console.info("Open profile folder is only available in the desktop app.", profileId);
}

export async function testProxy(proxy: ProxyConfig): Promise<ProxyConfig> {
  if (isTauri()) return invoke("test_proxy", { proxy });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const next = {
    ...proxy,
    lastTestStatus: `Success (IP: ${proxy.host || "192.168.1.1"}, Latency: ${Math.floor(Math.random() * 120) + 40}ms)`,
    lastTestAt: now(),
  };
  const proxies = read<ProxyConfig[]>(proxiesKey, []);
  const idx = proxies.findIndex((p) => p.id === proxy.id);
  if (idx >= 0) proxies[idx] = next;
  write(proxiesKey, proxies);
  return next;
}

export async function clearProfileData(profileId: string): Promise<void> {
  if (isTauri()) return invoke("clear_profile_data", { profileId });
  
  const event: LaunchEvent = {
    profileId,
    status: "stopped",
    message: "Mock profile browser cache, cookies, and local data cleared.",
    at: now(),
  };
  write(eventsKey, [event, ...read<LaunchEvent[]>(eventsKey, [])].slice(0, 100));
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (isTauri()) return invoke("get_system_info");
  return {
    dbPath: "C:\\Users\\MockUser\\AppData\\Local\\CloakBrowser\\CloakBrowserLocalManager\\manager.db",
    logsPath: "C:\\Users\\MockUser\\AppData\\Local\\CloakBrowser\\CloakBrowserLocalManager\\logs",
    profilesPath: "C:\\Users\\MockUser\\AppData\\Local\\CloakBrowser\\CloakBrowserLocalManager\\profiles",
    runnerScriptExists: true,
    bundledNodeExists: false,
    cachedChromeExists: true,
    cachedChromePath: "C:\\Users\\MockUser\\.cloakbrowser\\chromium-115.0.0\\chrome.exe",
  };
}

export async function clearLaunchEvents(): Promise<void> {
  if (isTauri()) return invoke("clear_launch_events");
  write(eventsKey, []);
}
