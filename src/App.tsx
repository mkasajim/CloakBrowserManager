import {
  Activity,
  Copy,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe,
  Monitor,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  SquarePen,
  Terminal,
  Trash2,
  User,
  Users,
  AlertTriangle,
  CheckCircle2,
  HelpCircle
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import {
  clearLaunchEvents,
  clearProfileData,
  createProfile,
  createProxy,
  deleteProfile,
  duplicateProfile,
  getSystemInfo,
  launchProfile,
  listEvents,
  listProfiles,
  listProxies,
  openProfileFolder,
  saveProfile,
  saveProxy,
  stopProfile,
  testProxy,
} from "./api";
import type { LaunchEvent, Profile, ProxyConfig, SystemInfo } from "./types";

const splitList = (value: string) => value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
const joinList = (value: string[]) => value.join("\n");

const fallbackTimezones = [
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

const timezoneOptions = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : fallbackTimezones;

const SYSTEM_PROXY_ID = "__system_proxy__";

type AppView = "profiles" | "proxies" | "logs" | "settings";

function proxyLabel(proxy?: ProxyConfig) {
  if (!proxy) return "Direct";
  if (proxy.scheme === "system") return "System proxy";
  return proxy.name;
}

function proxyDetail(proxy?: ProxyConfig) {
  if (!proxy) return "Direct connection";
  if (proxy.scheme === "system") return "Use Windows system proxy settings";
  return `${proxy.scheme}://${proxy.host}:${proxy.port}`;
}

const viewTitles: Record<AppView, string> = {
  profiles: "Profile Manager",
  proxies: "Proxy Manager",
  logs: "Activity Logs",
  settings: "Application Settings",
};

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [events, setEvents] = useState<LaunchEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [activeView, setActiveView] = useState<AppView>("profiles");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyConfig | null>(null);

  // Filter logs states
  const [severityFilter, setSeverityFilter] = useState("all");
  const [logProfileId, setLogProfileId] = useState("");

  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(false);
  const [testingAll, setTestingAll] = useState(false);

  // Dialog state for custom native-like alerts/confirms
  const [dialog, setDialog] = useState<{
    type: "alert" | "confirm";
    severity: "info" | "warn" | "error";
    title: string;
    message: string;
    resolve: (value: boolean) => void;
  } | null>(null);

  const showAlert = (message: string, title = "Notification", severity: "info" | "warn" | "error" = "info"): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({
        type: "alert",
        severity,
        title,
        message,
        resolve,
      });
    });
  };

  const showConfirm = (message: string, title = "Confirmation Required", severity: "info" | "warn" | "error" = "warn"): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({
        type: "confirm",
        severity,
        title,
        message,
        resolve,
      });
    });
  };

  // Real-time listener for logs
  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<LaunchEvent>("runner-log", (event) => {
      if (!active) return;
      setEvents((current) => {
        const exists = current.some((e) => e.at === event.payload.at && e.profileId === event.payload.profileId && e.message === event.payload.message);
        if (exists) return current;
        return [event.payload, ...current].slice(0, 100);
      });
      void listProfiles().then(setProfiles);
    });
    return () => {
      active = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function loadSystemInfo() {
    setLoadingSystemInfo(true);
    try {
      const info = await getSystemInfo();
      setSystemInfo(info);
    } catch (err) {
      console.error("Failed to load system info", err);
    } finally {
      setLoadingSystemInfo(false);
    }
  }

  useEffect(() => {
    if (activeView === "settings") {
      void loadSystemInfo();
    }
  }, [activeView]);

  async function testAll() {
    if (testingAll) return;
    setTestingAll(true);
    try {
      for (const p of proxies) {
        await testProxy(p);
      }
      await refresh();
      await showAlert("All proxies tested successfully!", "Proxies Tested", "info");
    } catch (err) {
      await showAlert(`Error testing proxies: ${err}`, "Proxy Test Error", "error");
    } finally {
      setTestingAll(false);
    }
  }

  async function clearData(profile: Profile) {
    if (profile.status === "running") {
      await showAlert("Cannot clear cache while browser is running.", "Cache Clear Warning", "warn");
      return;
    }
    const ok = await showConfirm(`Are you sure you want to clear cookies, history, and cache for "${profile.name}"?\nThis action cannot be undone.`, "Clear Profile Data", "warn");
    if (!ok) return;
    try {
      await clearProfileData(profile.id);
      await showAlert("Profile browser data cleared successfully!", "Data Cleared", "info");
      await refresh();
    } catch (err) {
      await showAlert(`Error clearing data: ${err}`, "Error", "error");
    }
  }

  async function handleClearLogs() {
    const ok = await showConfirm("Are you sure you want to clear all launch logs? This cannot be undone.", "Clear Logs", "warn");
    if (!ok) return;
    try {
      await clearLaunchEvents();
      await showAlert("Logs cleared successfully!", "Logs Cleared", "info");
      await refresh();
    } catch (err) {
      await showAlert(`Failed to clear logs: ${err}`, "Error", "error");
    }
  }

  function exportProfiles() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profiles, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cloakbrowser_profiles_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function exportLogs() {
    const logLines = filteredEvents.map((e) => {
      const time = new Date(e.at).toISOString().replace("T", " ").slice(0, 19);
      return `[${time}] [${e.status.toUpperCase()}] [Profile: ${e.profileId.slice(0, 8)}] - ${e.message}`;
    }).join("\n");
    
    const dataStr = "data:text/plain;charset=utf-8," + encodeURIComponent(logLines);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `cloakbrowser_logs_${new Date().toISOString().slice(0,10)}.txt`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function importProfiles(e: React.ChangeEvent<HTMLInputElement>) {
    const fileReader = new FileReader();
    if (!e.target.files || e.target.files.length === 0) return;
    fileReader.readAsText(e.target.files[0], "UTF-8");
    fileReader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as Profile[];
        if (!Array.isArray(parsed)) throw new Error("File content is not a valid profiles array");
        
        let count = 0;
        for (const item of parsed) {
          if (!item.name || !item.settings) continue;
          const nextProfile: Profile = {
            ...item,
            id: crypto.randomUUID(),
            status: "stopped",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLaunchedAt: undefined,
            cdpUrl: undefined,
          };
          await saveProfile(nextProfile);
          count++;
        }
        await showAlert(`Successfully imported ${count} profiles!`, "Import Successful", "info");
        await refresh();
      } catch (err) {
        await showAlert(`Error importing profiles: ${err}`, "Import Error", "error");
      }
    };
  }

  async function refresh() {
    const [nextProfiles, nextProxies, nextEvents] = await Promise.all([listProfiles(), listProxies(), listEvents()]);
    setProfiles(nextProfiles);
    setProxies(nextProxies);
    setEvents(nextEvents);
    setSelectedId((current) => current ?? nextProfiles[0]?.id);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!profiles.some((p) => p.status === "running")) return;
    const id = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(id);
  }, [profiles]);

  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? profiles[0], [profiles, selectedId]);

  const selectedProxy = useMemo(() => {
    if (!selected?.proxyId) return undefined;
    if (selected.proxyId === SYSTEM_PROXY_ID) return { id: SYSTEM_PROXY_ID, name: "System proxy", scheme: "system", host: "", port: 0 } as ProxyConfig;
    return proxies.find((p) => p.id === selected.proxyId);
  }, [proxies, selected]);

  const filtered = profiles.filter((profile) => {
    const haystack = [profile.name, profile.groupName, profile.tags.join(" "), profile.settings.locale, profile.settings.timezone].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const filteredEvents = events.filter((event) => {
    if (severityFilter !== "all" && event.status.toLowerCase() !== severityFilter.toLowerCase()) return false;
    if (logProfileId && !event.profileId.toLowerCase().includes(logProfileId.toLowerCase())) return false;
    return true;
  });

  async function addProfile() {
    const p = await createProfile();
    setDraft(p);
  }

  async function persistProfile(profile: Profile) {
    const saved = await saveProfile(profile);
    setDraft(null);
    await refresh();
    setSelectedId(saved.id);
  }

  async function removeProfile(profile: Profile) {
    const removeData = await showConfirm(`Delete browser data for "${profile.name}" too?`, "Delete Profile Data", "warn");
    await deleteProfile(profile.id, removeData);
    await refresh();
  }

  async function run(profile: Profile) {
    await launchProfile(profile.id);
    await refresh();
  }

  async function stop(profile: Profile) {
    await stopProfile(profile.id);
    await refresh();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <svg width="34" height="34" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="6" fill="#141416" stroke="#262629" strokeWidth="1"/>
              <path d="M16 8L23 11.5V17C23 21 20 23.5 16 24.5C12 23.5 9 21 9 17V11.5L16 8Z" fill="url(#logo-grad)" stroke="#00f0ff" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="16" cy="14" r="1.8" stroke="#00f0ff" strokeWidth="1.2"/>
              <path d="M16 15.8V20" stroke="#00f0ff" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M14.5 18.2H17.5" stroke="#00f0ff" strokeWidth="1.2" strokeLinecap="round"/>
              <defs>
                <linearGradient id="logo-grad" x1="16" y1="8" x2="16" y2="24.5" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#00f0ff" stopOpacity="0.2"/>
                  <stop offset="1" stopColor="#00f0ff" stopOpacity="0"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <strong>CyberCloak</strong>
            <small>Enterprise Tier</small>
          </div>
        </div>

        <div className="primary-action-container">
          <button type="button" className="btn-sidebar-action" onClick={addProfile}>
            <Plus size={16} /> New Profile
          </button>
        </div>

        <nav className="nav">
          <button className={activeView === "profiles" ? "active" : ""} type="button" onClick={() => setActiveView("profiles")}>
            <Users size={16} /> Profiles
          </button>
          <button className={activeView === "proxies" ? "active" : ""} type="button" onClick={() => setActiveView("proxies")}>
            <Network size={16} /> Proxies
          </button>
          <button className={activeView === "logs" ? "active" : ""} type="button" onClick={() => setActiveView("logs")}>
            <Terminal size={16} /> Logs
          </button>
          <button className={activeView === "settings" ? "active" : ""} type="button" onClick={() => setActiveView("settings")}>
            <Settings size={16} /> Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-avatar">
            <User size={16} />
          </div>
          <div className="sidebar-footer-info">
            <p>Admin</p>
            <span>Workspace</span>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="toolbar">
          <h2>{viewTitles[activeView]}</h2>
          
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {activeView === "profiles" && (
              <label className="search">
                <Search size={16} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search profiles, tags, or proxies..." />
              </label>
            )}
            
            <div className="toolbar-actions">
              <button type="button" aria-label="Refresh" onClick={() => void refresh()}>
                <RefreshCw size={15} />
              </button>
              <button type="button" aria-label="Notifications" style={{ position: "relative" }}>
                <Activity size={15} />
                <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, backgroundColor: "var(--primary)", borderRadius: "50%", boxShadow: "0 0 6px var(--primary)" }}></span>
              </button>
              <button type="button" aria-label="Profile">
                <User size={15} />
              </button>
            </div>
          </div>
        </header>

        {activeView === "profiles" ? (
          <div className="workspace">
            <div className="list-container">
              <div className="workspace-actions">
                <div>
                  <h3>Active Environment</h3>
                  <div className="status-summary">
                    <span className="status-dot"></span>
                    <span className="status-text">{profiles.filter((p) => p.status === "running").length} Active Connections</span>
                  </div>
                </div>
                <div className="workspace-actions-buttons" style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={exportProfiles} title="Export all profiles as JSON">
                    Export All
                  </button>
                  <label className="btn-label" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "1px solid var(--border-zinc)", borderRadius: "var(--radius-md)", padding: "0 12px", height: "36px", fontSize: "14px", backgroundColor: "var(--bg-zinc)", color: "var(--text-primary)" }}>
                    Import JSON
                    <input type="file" accept=".json" onChange={importProfiles} style={{ display: "none" }} />
                  </label>
                  <button type="button" className="primary" onClick={addProfile}>
                    <Plus size={15} /> New Profile
                  </button>
                </div>
              </div>

              <div className="list">
                {filtered.map((profile) => (
                  <article key={profile.id} className={`card ${profile.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(profile.id)}>
                    <div className="card-header">
                      <div className="card-header-title">
                        <div className="card-header-title-row">
                          <span className={`status-dot-sm ${profile.status}`}></span>
                          <h3>{profile.name}</h3>
                        </div>
                        <p>ID: {profile.id.slice(0, 8)}</p>
                      </div>

                      {profile.status === "running" ? (
                        <button type="button" className="btn-stop" onClick={(e) => { e.stopPropagation(); void stop(profile); }}>
                          STOP
                        </button>
                      ) : (
                        <button type="button" className="btn-launch" onClick={(e) => { e.stopPropagation(); void run(profile); }}>
                          LAUNCH
                        </button>
                      )}
                    </div>

                    <div className="card-body">
                      <div className="card-tags">
                        <span className="pill">
                          <Monitor size={11} /> {profile.settings.platform}
                        </span>
                        <span className="pill">
                          <Network size={11} /> {profile.proxyId === SYSTEM_PROXY_ID ? "System" : proxyLabel(proxies.find((p) => p.id === profile.proxyId))}
                        </span>
                        {profile.groupName && (
                          <span className="pill premium">{profile.groupName}</span>
                        )}
                        {profile.tags.map((tag) => (
                          <span key={tag} className="pill">{tag}</span>
                        ))}
                      </div>

                      <div className="card-grid">
                        <div className="card-grid-item">
                          <span className="card-grid-label">IP ADDRESS</span>
                          <span className="card-grid-value">
                            {profile.proxyId ? (proxies.find((p) => p.id === profile.proxyId)?.host || "System IP") : "Direct IP"}
                          </span>
                        </div>
                        <div className="card-grid-item">
                          <span className="card-grid-label">{profile.status === "running" ? "UPTIME" : "LAST SEEN"}</span>
                          <span className={`card-grid-value ${profile.status !== "running" ? "inactive" : ""}`}>
                            {profile.status === "running"
                              ? (profile.lastLaunchedAt ? `${Math.floor((Date.now() - new Date(profile.lastLaunchedAt).getTime()) / 60000)}m` : "Active")
                              : (profile.lastLaunchedAt ? new Date(profile.lastLaunchedAt).toLocaleDateString() : "Never")}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {filtered.length === 0 ? <p className="empty">No profiles match the current filter.</p> : null}
              </div>

              <section className="workspace-logs">
                <div className="section-title">Recent Events</div>
                <div className="workspace-logs-list">
                  {events.slice(0, 5).map((event) => (
                    <div key={`${event.profileId}-${event.at}`} className="workspace-logs-line">
                      <time>{new Date(event.at).toLocaleTimeString()}</time>
                      <strong className={event.status}>{event.status}</strong>
                      <p>{event.message}</p>
                    </div>
                  ))}
                  {events.length === 0 && <p className="muted" style={{ padding: 4 }}>No recent events logged.</p>}
                </div>
              </section>
            </div>

            <ProfileInspector
              profile={selected}
              proxy={selectedProxy}
              onEdit={() => selected && setDraft(selected)}
              onDelete={() => selected && removeProfile(selected)}
              onLaunch={() => selected && run(selected)}
              onStop={() => selected && stop(selected)}
              onDuplicate={async () => {
                if (selected) {
                  const dup = await duplicateProfile(selected);
                  setSelectedId(dup.id);
                  await refresh();
                }
              }}
              onClearData={() => selected && clearData(selected)}
            />
          </div>
        ) : null}

        {activeView === "proxies" ? (
          <div className="workspace">
            <div className="list-container">
              <div className="proxy-toolbar">
                <div className="proxy-toolbar-left">
                  <button type="button" className="primary" onClick={async () => setProxyDraft(await createProxy())}>
                    <Plus size={15} /> Add Proxy
                  </button>
                  <button type="button" disabled={testingAll} onClick={testAll}>
                    {testingAll ? "Testing All..." : "Test All"}
                  </button>
                </div>
                <div className="proxy-toolbar-right">
                  <span>VIEW:</span>
                  <button type="button" className="active">Table</button>
                  <button type="button">Grid</button>
                </div>
              </div>

              {proxies.length === 0 ? (
                <p className="empty">No proxies saved yet.</p>
              ) : (
                <div className="proxy-table">
                  <div className="proxy-table-header">
                    <div className="proxy-table-checkbox"><input type="checkbox" readOnly checked={false} /></div>
                    <div>HOST / IP</div>
                    <div>PORT</div>
                    <div>PROTOCOL</div>
                    <div>LOCATION</div>
                    <div style={{ textAlign: "right" }}>LATENCY</div>
                  </div>
                  {proxies.map((proxy) => {
                    const isErr = proxy.lastTestStatus?.toLowerCase().includes("timeout") || proxy.lastTestStatus?.toLowerCase().includes("fail");
                    return (
                      <div key={proxy.id} className={`proxy-table-row ${isErr ? "error-row" : ""}`} onClick={() => setProxyDraft(proxy)}>
                        <div className="proxy-table-checkbox" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" readOnly checked={false} />
                        </div>
                        <div className="proxy-table-host">
                          <div className="proxy-table-icon">
                            <Globe size={14} />
                          </div>
                          <span>{proxy.host || "System Proxy Settings"}</span>
                        </div>
                        <div className="proxy-table-port">{proxy.port || "--"}</div>
                        <div className="proxy-table-protocol">
                          <span className="protocol-badge">{proxy.scheme.toUpperCase()}</span>
                        </div>
                        <div className="proxy-table-location">
                          <span>{proxy.host.includes(".de") ? "Germany" : proxy.host.includes(".jp") ? "Japan" : "United States"}</span>
                        </div>
                        <div className="proxy-table-latency">
                          <span className={`latency-dot ${isErr ? "error" : "good"}`}></span>
                          <span className={isErr ? "text-error" : "text-good"}>{proxy.lastTestStatus || "Untested"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="inspector">
              <div className="inspector-head">
                <div>
                  <h2>Proxy Registry</h2>
                  <span className="muted" style={{ fontSize: 13, marginTop: 4, display: "block" }}>
                    Configure proxies to assign them to your browser profiles.
                  </span>
                </div>
              </div>
              <dl style={{ marginTop: 10 }}>
                <dt>Total proxies</dt>
                <dd>{proxies.length}</dd>
                <dt>Direct connects</dt>
                <dd>{profiles.filter((profile) => !profile.proxyId).length}</dd>
                <dt>System proxies</dt>
                <dd>{profiles.filter((profile) => profile.proxyId === SYSTEM_PROXY_ID).length}</dd>
              </dl>
              <div className="inspector-buttons" style={{ marginTop: "auto" }}>
                <button type="button" className="primary" onClick={async () => setProxyDraft(await createProxy())}>
                  <Plus size={15} /> New proxy
                </button>
              </div>
            </aside>
          </div>
        ) : null}

        {activeView === "logs" ? (
          <div className="logs-page">
            <div className="logs-filter-bar">
              <div className="logs-filters">
                <div className="logs-filter-item">
                  <label>Severity</label>
                  <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                    <option value="all">ALL LEVELS</option>
                    <option value="info">INFO</option>
                    <option value="running">RUNNING</option>
                    <option value="stopped">STOPPED</option>
                    <option value="error">ERROR</option>
                  </select>
                </div>
                <div className="logs-filter-item">
                  <label>Profile ID</label>
                  <input value={logProfileId} onChange={(e) => setLogProfileId(e.target.value)} placeholder="Search profile ID..." />
                </div>
              </div>
              <div className="logs-filter-actions">
                <button type="button" onClick={exportLogs}>EXPORT</button>
                <button type="button" onClick={handleClearLogs}>CLEAR</button>
              </div>
            </div>

            <div className="terminal-container">
              <div className="terminal-header">
                <div className="terminal-header-title">
                  <Terminal size={14} style={{ color: "var(--primary)" }} />
                  <span>SYSTEM_ACTIVITY_LOG</span>
                </div>
                <div className="terminal-header-status">
                  <span className="terminal-header-status-dot"></span>
                  <span>LIVE</span>
                </div>
              </div>
              
              <div className="terminal-body">
                {filteredEvents.map((event, idx) => {
                  const isErr = event.status.toLowerCase() === "error";
                  const levelClass = event.status.toLowerCase();
                  return (
                    <div key={idx} className="terminal-row">
                      <span className="terminal-row-time">{new Date(event.at).toISOString().replace("T", " ").slice(0, 19)}</span>
                      <span className={`terminal-row-level ${levelClass}`}>[{event.status.toUpperCase()}]</span>
                      <span className="terminal-row-source">{event.profileId.slice(0, 8)}</span>
                      <span className="terminal-row-method">{isErr ? "POST" : "GET"}</span>
                      <span className="terminal-row-url">/api/v1/profiles/{event.profileId.slice(0, 6)}</span>
                      <span className={`terminal-row-message ${isErr ? "error" : ""}`}>{event.message}</span>
                    </div>
                  );
                })}
                {filteredEvents.length === 0 && (
                  <div className="muted" style={{ padding: 12 }}>No logs match the current filters.</div>
                )}
              </div>
              <div className="terminal-fade-overlay"></div>
            </div>
          </div>
        ) : null}

        {activeView === "settings" ? (
          <div className="workspace">
            <div className="settings-workspace" style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%", padding: 20, overflowY: "auto" }}>
              <div className="settings-card" style={{ border: "1px solid var(--border-zinc)", borderRadius: "var(--radius-lg)", padding: 24, backgroundColor: "var(--bg-zinc)", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 18, color: "var(--primary)" }}><Settings size={18} /> System Environment</h3>
                <small style={{ color: "var(--text-muted)", display: "block", marginTop: 4, marginBottom: 16 }}>Operational folder locations for the CloakBrowser Manager.</small>
                {loadingSystemInfo ? (
                  <p style={{ color: "var(--text-secondary)" }}>Loading environment info...</p>
                ) : systemInfo ? (
                  <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "10px 16px", margin: 0, fontSize: 13 }}>
                    <dt style={{ color: "var(--text-muted)", fontWeight: "bold" }}>Database Path</dt>
                    <dd style={{ color: "var(--text-primary)", wordBreak: "break-all", margin: 0, fontFamily: "var(--font-code)" }}>{systemInfo.dbPath}</dd>
                    
                    <dt style={{ color: "var(--text-muted)", fontWeight: "bold" }}>Logs Path</dt>
                    <dd style={{ color: "var(--text-primary)", wordBreak: "break-all", margin: 0, fontFamily: "var(--font-code)" }}>{systemInfo.logsPath}</dd>
                    
                    <dt style={{ color: "var(--text-muted)", fontWeight: "bold" }}>Profiles Path</dt>
                    <dd style={{ color: "var(--text-primary)", wordBreak: "break-all", margin: 0, fontFamily: "var(--font-code)" }}>{systemInfo.profilesPath}</dd>
                  </dl>
                ) : (
                  <p style={{ color: "var(--error)" }}>Could not load system info</p>
                )}
              </div>

              <div className="settings-card" style={{ border: "1px solid var(--border-zinc)", borderRadius: "var(--radius-lg)", padding: 24, backgroundColor: "var(--bg-zinc)", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 18, color: "var(--primary)" }}><Cpu size={18} /> Runner Sidecar & Browser Health</h3>
                <small style={{ color: "var(--text-muted)", display: "block", marginTop: 4, marginBottom: 16 }}>Status of executable sidecars and browsers required for launching profiles.</small>
                {loadingSystemInfo ? (
                  <p style={{ color: "var(--text-secondary)" }}>Checking health status...</p>
                ) : systemInfo ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: systemInfo.runnerScriptExists ? "var(--success)" : "var(--error)" }}></span>
                      <strong style={{ minWidth: 150 }}>TypeScript Runner:</strong>
                      <span style={{ color: systemInfo.runnerScriptExists ? "var(--text-primary)" : "var(--error)" }}>
                        {systemInfo.runnerScriptExists ? "Available (dist/index.js)" : "Missing runner build! Run npm run runner:build first."}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: systemInfo.bundledNodeExists ? "var(--success)" : "var(--warn)" }}></span>
                      <strong style={{ minWidth: 150 }}>Bundled Node.exe:</strong>
                      <span>
                        {systemInfo.bundledNodeExists ? "Bundled (runner/bin/node.exe)" : "Not Bundled (using system fallback Node)"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: systemInfo.cachedChromeExists ? "var(--success)" : "var(--error)" }}></span>
                      <strong style={{ minWidth: 150 }}>CloakBrowser Binary:</strong>
                      <span style={{ color: systemInfo.cachedChromeExists ? "var(--text-primary)" : "var(--error)" }}>
                        {systemInfo.cachedChromeExists ? `Detected: ${systemInfo.cachedChromePath?.split('\\').pop()}` : "No cached CloakBrowser found under .cloakbrowser! Launches will fail."}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "var(--error)" }}>Health checks unavailable</p>
                )}
              </div>

              <div className="settings-card" style={{ border: "1px solid var(--border-zinc)", borderRadius: "var(--radius-lg)", padding: 24, backgroundColor: "var(--bg-zinc)", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)" }}>
                <h3 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 18, color: "var(--primary)" }}><Terminal size={18} /> System Maintenance</h3>
                <small style={{ color: "var(--text-muted)", display: "block", marginTop: 4, marginBottom: 16 }}>Purge and reset manager database states.</small>
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="button" onClick={handleClearLogs} style={{ border: "1px solid var(--error)", color: "var(--error)", backgroundColor: "rgba(255, 180, 171, 0.05)", padding: "10px 16px", borderRadius: "var(--radius-md)", cursor: "pointer", fontSize: 13 }}>
                    Purge Activity Logs
                  </button>
                  <button type="button" className="secondary" onClick={() => void refresh()} style={{ fontSize: 13 }}>
                    Refresh Database Stats
                  </button>
                </div>
              </div>
            </div>

            <aside className="inspector">
              <div className="inspector-head">
                <div>
                  <h2>Manager Stats</h2>
                  <span className="muted" style={{ fontSize: 13, marginTop: 4, display: "block" }}>
                    Quick summary of active and configured profiles.
                  </span>
                </div>
              </div>
              <dl style={{ marginTop: 10 }}>
                <dt>Total Profiles</dt>
                <dd>{profiles.length}</dd>
                <dt>Running Profiles</dt>
                <dd style={{ color: "var(--primary)", fontWeight: "bold" }}>{profiles.filter((p) => p.status === "running").length}</dd>
                <dt>Total Proxies</dt>
                <dd>{proxies.length}</dd>
                <dt>Logged Events</dt>
                <dd>{events.length}</dd>
              </dl>
              <div className="inspector-buttons" style={{ marginTop: "auto" }}>
                <button type="button" className="primary" onClick={addProfile}>
                  <Plus size={15} /> New profile
                </button>
                <button type="button" onClick={() => { void refresh(); void loadSystemInfo(); }}>
                  <RefreshCw size={14} /> Force Refresh
                </button>
              </div>
            </aside>
          </div>
        ) : null}
      </section>

      {draft ? (
        <ProfileEditor
          profile={draft}
          proxies={proxies}
          onCancel={() => setDraft(null)}
          onSave={persistProfile}
          onChange={setDraft}
        />
      ) : null}

      {proxyDraft ? (
        <ProxyEditor
          proxy={proxyDraft}
          onCancel={() => setProxyDraft(null)}
          onChange={setProxyDraft}
          onSave={async (proxy) => {
            await saveProxy(proxy);
            setProxyDraft(null);
            await refresh();
          }}
        />
      ) : null}

      {dialog ? (
        <div className="modal-backdrop">
          <div className={`modal dialog-modal ${dialog.severity}`}>
            <div className="dialog-content">
              <div className={`dialog-icon ${dialog.severity}`}>
                {dialog.severity === "error" && <AlertTriangle size={24} />}
                {dialog.severity === "warn" && <AlertTriangle size={24} />}
                {dialog.severity === "info" && (dialog.type === "confirm" ? <HelpCircle size={24} /> : <CheckCircle2 size={24} />)}
              </div>
              <div className="dialog-text">
                <div className="dialog-title">{dialog.title}</div>
                <div className="dialog-message">{dialog.message}</div>
              </div>
            </div>
            <div className="dialog-footer">
              {dialog.type === "confirm" && (
                <button type="button" onClick={() => {
                  dialog.resolve(false);
                  setDialog(null);
                }}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="primary"
                onClick={() => {
                  dialog.resolve(true);
                  setDialog(null);
                }}
              >
                {dialog.type === "confirm" ? "Confirm" : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ProfileInspector({
  profile,
  proxy,
  onEdit,
  onDelete,
  onLaunch,
  onStop,
  onDuplicate,
  onClearData,
}: {
  profile?: Profile;
  proxy?: ProxyConfig;
  onEdit: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onDuplicate: () => void;
  onClearData: () => void;
}) {
  if (!profile) return <aside className="inspector empty-inspector">Select or create a profile to get started.</aside>;
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <h2>{profile.name}</h2>
          <span className="status-badge">
            <span className={`status-dot-sm ${profile.status}`}></span>
            {profile.status}
          </span>
        </div>
        <div className="inspector-actions">
          {profile.status === "running" ? (
            <button type="button" onClick={onStop} aria-label="Stop profile"><Pause size={16} /></button>
          ) : (
            <button type="button" onClick={onLaunch} aria-label="Launch profile"><Play size={16} /></button>
          )}
          <button type="button" onClick={onEdit} aria-label="Edit profile"><SquarePen size={16} /></button>
          <button type="button" onClick={onDuplicate} aria-label="Duplicate profile"><Copy size={16} /></button>
          <button type="button" className="btn-delete" onClick={onDelete} aria-label="Delete profile"><Trash2 size={16} /></button>
        </div>
      </div>

      <dl>
        <dt>Proxy</dt>
        <dd>{proxyDetail(proxy)}</dd>
        <dt>Seed</dt>
        <dd style={{ fontFamily: "var(--font-code)" }}>{profile.settings.fingerprintSeed || "Auto"}</dd>
        <dt>Viewport</dt>
        <dd>{profile.settings.viewportWidth}x{profile.settings.viewportHeight}</dd>
        <dt>Locale</dt>
        <dd>{profile.settings.locale}</dd>
        <dt>Timezone</dt>
        <dd>{profile.settings.timezone}</dd>
        <dt>Created</dt>
        <dd>{new Date(profile.createdAt).toLocaleDateString()}</dd>
        <dt>Last Launch</dt>
        <dd>{profile.lastLaunchedAt ? new Date(profile.lastLaunchedAt).toLocaleString() : "Never"}</dd>
        <dt>Startup URL</dt>
        <dd>{profile.settings.startupUrl || "Blank tab"}</dd>
        <dt>CDP URL</dt>
        <dd style={{ fontFamily: "var(--font-code)", fontSize: 11 }}>{profile.cdpUrl || "Not running"}</dd>
      </dl>

      {profile.notes ? <p className="notes">{profile.notes}</p> : null}

      <div className="inspector-buttons" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="primary" onClick={() => openProfileFolder(profile.id)} style={{ flex: "1 1 45%" }}>
          <FolderOpen size={14} /> Data folder
        </button>
        <button type="button" disabled={!profile.cdpUrl} onClick={() => profile.cdpUrl && navigator.clipboard.writeText(profile.cdpUrl)} style={{ flex: "1 1 45%" }}>
          <ExternalLink size={14} /> Copy CDP
        </button>
        <button type="button" disabled={profile.status === "running"} onClick={onClearData} style={{ flex: "1 1 100%", border: "1px solid var(--error)", color: "var(--error)", backgroundColor: "rgba(255, 180, 171, 0.05)", marginTop: 4 }}>
          <RefreshCw size={14} /> Clear Cache
        </button>
      </div>
    </aside>
  );
}

function ProfileEditor({
  profile,
  proxies,
  onChange,
  onSave,
  onCancel,
}: {
  profile: Profile;
  proxies: ProxyConfig[];
  onChange: (profile: Profile) => void;
  onSave: (profile: Profile) => void;
  onCancel: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"fingerprint" | "network" | "display" | "advanced">("fingerprint");

  const patch = (partial: Partial<Profile>) => onChange({ ...profile, ...partial });
  const settings = (partial: Partial<Profile["settings"]>) => onChange({ ...profile, settings: { ...profile.settings, ...partial } });
  const detectFromIp = profile.settings.geoipEnabled;

  const regenerateSeed = () => {
    settings({ fingerprintSeed: String(Math.floor(Math.random() * 1_000_000_000)) });
  };

  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={(e) => e.preventDefault()}>
        <header>
          <h2>Edit profile: {profile.name}</h2>
          <div className="header-actions">
            <button type="button" onClick={() => openProfileFolder(profile.id)}>
              <FolderOpen size={14} /> Data Folder
            </button>
            <button type="button" disabled={!profile.cdpUrl} onClick={() => profile.cdpUrl && navigator.clipboard.writeText(profile.cdpUrl)}>
              <ExternalLink size={14} /> Copy CDP
            </button>
            <button type="button" className="primary" onClick={() => onSave(profile)}>
              <Save size={14} /> Save Profile
            </button>
          </div>
        </header>

        <div className="modal-split-content">
          <aside className="modal-split-nav">
            <button type="button" className={activeTab === "fingerprint" ? "active" : ""} onClick={() => setActiveTab("fingerprint")}>
              <Cpu size={14} /> Fingerprint
            </button>
            <button type="button" className={activeTab === "network" ? "active" : ""} onClick={() => setActiveTab("network")}>
              <Network size={14} /> Network/Proxy
            </button>
            <button type="button" className={activeTab === "display" ? "active" : ""} onClick={() => setActiveTab("display")}>
              <Monitor size={14} /> Display
            </button>
            <button type="button" className={activeTab === "advanced" ? "active" : ""} onClick={() => setActiveTab("advanced")}>
              <Settings size={14} /> Advanced
            </button>
          </aside>

          <div className="modal-split-form">
            {activeTab === "fingerprint" && (
              <section className="form-section">
                <div className="form-section-title">
                  <span className="material-symbols-outlined">fingerprint</span>
                  <h3>Fingerprint Configurations</h3>
                </div>
                <div className="form-grid">
                  <Field label="Name">
                    <input value={profile.name} onChange={(e) => patch({ name: e.target.value })} />
                  </Field>
                  <Field label="Group">
                    <input value={profile.groupName} onChange={(e) => patch({ groupName: e.target.value })} />
                  </Field>
                  <Field label="Tags">
                    <input value={profile.tags.join(", ")} onChange={(e) => patch({ tags: splitList(e.target.value) })} />
                  </Field>
                  <Field label="Fingerprint seed">
                    <div className="seed-wrapper">
                      <input value={profile.settings.fingerprintSeed} onChange={(e) => settings({ fingerprintSeed: e.target.value })} />
                      <button type="button" onClick={regenerateSeed} title="Generate new seed">
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  </Field>
                  <Field label="Locale">
                    <input value={profile.settings.locale} disabled={detectFromIp} onChange={(e) => settings({ locale: e.target.value })} />
                  </Field>
                  <Field label="Timezone">
                    <select value={profile.settings.timezone} disabled={detectFromIp} onChange={(e) => settings({ timezone: e.target.value })}>
                      {Array.from(new Set([profile.settings.timezone, ...timezoneOptions])).map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="form-grid-full">
                    <Field label="User Agent">
                      <textarea value={profile.settings.userAgent} onChange={(e) => settings({ userAgent: e.target.value })} />
                    </Field>
                  </div>
                  <div className="form-grid-full" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label className="check">
                      <input type="checkbox" checked={profile.settings.humanizeEnabled} onChange={(e) => settings({ humanizeEnabled: e.target.checked })} />
                      Humanize actions
                    </label>
                    <label className="check">
                      <input type="checkbox" checked={profile.settings.geoipEnabled} onChange={(e) => settings({ geoipEnabled: e.target.checked })} />
                      Detect timezone/locale from proxy
                    </label>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "network" && (
              <section className="form-section">
                <div className="form-section-title">
                  <span className="material-symbols-outlined">lan</span>
                  <h3>Network Settings</h3>
                </div>
                <div className="form-grid">
                  <Field label="Proxy">
                    <select value={profile.proxyId ?? ""} onChange={(e) => patch({ proxyId: e.target.value || undefined })}>
                      <option value="">Direct (No Proxy)</option>
                      <option value={SYSTEM_PROXY_ID}>System proxy</option>
                      {proxies.map((p) => <option key={p.id} value={p.id}>{proxyLabel(p)}</option>)}
                    </select>
                  </Field>
                  <Field label="WebRTC Mode">
                    <select value={profile.settings.webrtcMode} onChange={(e) => settings({ webrtcMode: e.target.value as Profile["settings"]["webrtcMode"] })}>
                      <option value="auto">Auto proxy IP</option>
                      <option value="explicit">Explicit IP</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </Field>
                  <Field label="WebRTC IP">
                    <input value={profile.settings.webrtcIp} disabled={profile.settings.webrtcMode !== "explicit"} onChange={(e) => settings({ webrtcIp: e.target.value })} />
                  </Field>
                  <Field label="Startup URL">
                    <input value={profile.settings.startupUrl} onChange={(e) => settings({ startupUrl: e.target.value })} />
                  </Field>
                </div>
              </section>
            )}

            {activeTab === "display" && (
              <section className="form-section">
                <div className="form-section-title">
                  <span className="material-symbols-outlined">monitor</span>
                  <h3>Display Resolution</h3>
                </div>
                <div className="form-grid">
                  <Field label="Viewport width">
                    <input type="number" value={profile.settings.viewportWidth} onChange={(e) => settings({ viewportWidth: Number(e.target.value) })} />
                  </Field>
                  <Field label="Viewport height">
                    <input type="number" value={profile.settings.viewportHeight} onChange={(e) => settings({ viewportHeight: Number(e.target.value) })} />
                  </Field>
                  <Field label="Screen Width">
                    <input type="number" value={profile.settings.screenWidth} onChange={(e) => settings({ screenWidth: Number(e.target.value) })} />
                  </Field>
                  <Field label="Screen Height">
                    <input type="number" value={profile.settings.screenHeight} onChange={(e) => settings({ screenHeight: Number(e.target.value) })} />
                  </Field>
                  <Field label="Device Scale Factor">
                    <input type="number" step="0.25" value={profile.settings.deviceScaleFactor} onChange={(e) => settings({ deviceScaleFactor: Number(e.target.value) })} />
                  </Field>
                </div>
              </section>
            )}

            {activeTab === "advanced" && (
              <section className="form-section">
                <div className="form-section-title">
                  <span className="material-symbols-outlined">settings_suggest</span>
                  <h3>Advanced Arguments</h3>
                </div>
                <div className="form-grid">
                  <div className="form-grid-full">
                    <Field label="Extension Paths (one per line)">
                      <textarea value={joinList(profile.settings.extensionPaths)} onChange={(e) => settings({ extensionPaths: splitList(e.target.value) })} />
                    </Field>
                  </div>
                  <div className="form-grid-full">
                    <Field label="Extra Chromium Args (one per line)">
                      <textarea value={joinList(profile.settings.extraArgs)} onChange={(e) => settings({ extraArgs: splitList(e.target.value) })} />
                    </Field>
                  </div>
                  <div className="form-grid-full">
                    <Field label="Notes">
                      <textarea value={profile.notes} onChange={(e) => patch({ notes: e.target.value })} />
                    </Field>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>

        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={() => onSave(profile)}><Save size={14} /> Save Profile</button>
        </footer>
      </form>
    </div>
  );
}

function ProxyEditor({
  proxy,
  onChange,
  onSave,
  onCancel,
}: {
  proxy: ProxyConfig;
  onChange: (proxy: ProxyConfig) => void;
  onSave: (proxy: ProxyConfig) => void;
  onCancel: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(proxy.lastTestStatus || null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult("Testing connection...");
    try {
      const res = await testProxy(proxy);
      setTestResult(res.lastTestStatus || "No status returned");
      onChange(res);
    } catch (err) {
      setTestResult(`Test failed: ${err}`);
    } finally {
      setTesting(false);
    }
  };

  const patch = (partial: Partial<ProxyConfig>) => onChange({ ...proxy, ...partial });
  return (
    <div className="modal-backdrop">
      <form className="modal narrow" onSubmit={(e) => e.preventDefault()}>
        <header>
          <h2>Edit Proxy: {proxy.name || "New proxy"}</h2>
        </header>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 4px", overflowY: "auto", maxHeight: "60vh" }}>
          <Field label="Name">
            <input value={proxy.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field label="Scheme">
            <select value={proxy.scheme} onChange={(e) => patch({ scheme: e.target.value as ProxyConfig["scheme"] })}>
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
              <option value="system">System proxy</option>
            </select>
          </Field>
          <Field label="Host">
            <input value={proxy.host} disabled={proxy.scheme === "system"} placeholder={proxy.scheme === "system" ? "Uses Windows proxy settings" : ""} onChange={(e) => patch({ host: e.target.value })} />
          </Field>
          <Field label="Port">
            <input type="number" value={proxy.port} disabled={proxy.scheme === "system"} onChange={(e) => patch({ port: Number(e.target.value) })} />
          </Field>
          <Field label="Username">
            <input value={proxy.username ?? ""} disabled={proxy.scheme === "system"} onChange={(e) => patch({ username: e.target.value })} />
          </Field>
          <Field label="Password">
            <input type="password" value={proxy.password ?? ""} disabled={proxy.scheme === "system"} onChange={(e) => patch({ password: e.target.value })} />
          </Field>
          
          {testResult && (
            <div style={{ fontSize: 13, color: testResult.includes("Success") ? "var(--success)" : "var(--error)", marginTop: 8, padding: 8, borderRadius: 4, border: "1px solid var(--border-zinc)", backgroundColor: "rgba(0,0,0,0.2)" }}>
              <strong>Result:</strong> {testResult}
            </div>
          )}
        </div>

        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={testing || proxy.scheme === "system"} onClick={handleTest}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <button type="button" className="primary" onClick={() => onSave(proxy)}><Save size={14} /> Save Proxy</button>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
