import type { ProxyConfig } from "../types";

export type AppView = "profiles" | "proxies" | "logs" | "settings";

export const SYSTEM_PROXY_ID = "__system_proxy__";

export const splitList = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

export const joinList = (value: string[]) => value.join("\n");

export const fallbackTimezones = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export const timezoneOptions =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : fallbackTimezones;

export function proxyLabel(proxy?: ProxyConfig) {
  if (!proxy) return "Direct";
  if (proxy.scheme === "system") return "System proxy";
  return proxy.name;
}

export function proxyDetail(proxy?: ProxyConfig) {
  if (!proxy) return "Direct connection";
  if (proxy.scheme === "system") return "Use Windows system proxy settings";
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

export const viewTitles: Record<AppView, string> = {
  profiles: "Profile Manager",
  proxies: "Proxy Manager",
  logs: "Activity Logs",
  settings: "Application Settings",
};
