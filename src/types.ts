export type ProfileStatus = "stopped" | "running" | "unknown";

export type ProxyScheme = "http" | "https" | "socks5" | "system";

export type Platform = "auto" | "windows" | "macos" | "linux";

export type WebRtcMode = "auto" | "disabled" | "explicit";

export interface ProxyConfig {
  id: string;
  name: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypass?: string;
  lastTestStatus?: string;
  lastTestAt?: string;
}

export interface ProfileSettings {
  fingerprintSeed: string;
  platform: Platform;
  userAgent: string;
  locale: string;
  timezone: string;
  screenWidth: number;
  screenHeight: number;
  humanizeEnabled: boolean;
  humanPreset: "default" | "careful";
  geoipEnabled: boolean;
  webrtcMode: WebRtcMode;
  webrtcIp: string;
  startupUrl: string;
  extensionPaths: string[];
  extraArgs: string[];
}

export interface Profile {
  id: string;
  name: string;
  groupName: string;
  tags: string[];
  notes: string;
  proxyId?: string;
  status: ProfileStatus;
  cdpUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastLaunchedAt?: string;
  settings: ProfileSettings;
}

export interface LaunchEvent {
  profileId: string;
  status: ProfileStatus;
  message: string;
  cdpUrl?: string;
  at: string;
}

export const defaultSettings: ProfileSettings = {
  fingerprintSeed: "",
  platform: "auto",
  userAgent: "",
  locale: "en-US",
  timezone: "America/New_York",
  screenWidth: 1366,
  screenHeight: 768,
  humanizeEnabled: true,
  humanPreset: "default",
  geoipEnabled: false,
  webrtcMode: "auto",
  webrtcIp: "",
  startupUrl: "https://browserleaks.com/client-hints",
  extensionPaths: [],
  extraArgs: [],
};

export interface SystemInfo {
  dbPath: string;
  logsPath: string;
  profilesPath: string;
  runnerScriptExists: boolean;
  bundledNodeExists: boolean;
  cachedChromeExists: boolean;
  cachedChromePath?: string;
}
