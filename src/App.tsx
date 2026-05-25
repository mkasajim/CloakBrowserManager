import { Copy, ExternalLink, FolderOpen, Pause, Play, Plus, Save, Search, Settings, SquarePen, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createProfile,
  createProxy,
  deleteProfile,
  duplicateProfile,
  launchProfile,
  listEvents,
  listProfiles,
  listProxies,
  openProfileFolder,
  saveProfile,
  saveProxy,
  stopProfile,
} from "./api";
import type { LaunchEvent, Profile, ProxyConfig } from "./types";

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

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [events, setEvents] = useState<LaunchEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [activeView, setActiveView] = useState<AppView>("profiles");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyConfig | null>(null);

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
    const removeData = window.confirm(`Delete browser data for "${profile.name}" too?`);
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
          <span className="brand-mark">CB</span>
          <div>
            <strong>Cloak Local</strong>
            <small>Windows profile manager</small>
          </div>
        </div>

        <button type="button" className="primary" onClick={addProfile}>
          <Plus size={16} /> New profile
        </button>

        <nav className="nav">
          <button className={activeView === "profiles" ? "active" : ""} type="button" onClick={() => setActiveView("profiles")}>Profiles</button>
          <button className={activeView === "proxies" ? "active" : ""} type="button" onClick={() => setActiveView("proxies")}>Proxies</button>
          <button className={activeView === "logs" ? "active" : ""} type="button" onClick={() => setActiveView("logs")}>Logs</button>
          <button className={activeView === "settings" ? "active" : ""} type="button" onClick={() => setActiveView("settings")}>Settings</button>
        </nav>

        <section className="proxy-panel">
          <div className="section-title">
            <span>Proxies</span>
            <button type="button" aria-label="Add proxy" onClick={async () => setProxyDraft(await createProxy())}>
              <Plus size={15} />
            </button>
          </div>
          {proxies.length === 0 ? <p className="muted">No proxies saved.</p> : null}
          {proxies.map((proxy) => (
            <button key={proxy.id} type="button" className="proxy-item" onClick={() => setProxyDraft(proxy)}>
              <span>{proxy.name}</span>
              <small>{proxyDetail(proxy)}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="content">
        <header className="toolbar">
          <label className="search">
            <Search size={17} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search profiles" />
          </label>
          <div>
            <button type="button" onClick={() => void refresh()}>
              <Settings size={16} /> Refresh
            </button>
          </div>
        </header>

        {activeView === "profiles" ? (
          <>
            <div className="workspace">
              <div className="list">
                {filtered.map((profile) => (
                  <article key={profile.id} className={`card ${profile.id === selected?.id ? "selected" : ""}`} onClick={() => setSelectedId(profile.id)}>
                    <div className="title">
                      <div>
                        <h3>{profile.name}</h3>
                        <small>{profile.tags.join(", ") || "No tags"}</small>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        <span className={`status ${profile.status}`}>{profile.status}</span>
                        <div className="meta">
                          <span className="pill">{profile.proxyId === SYSTEM_PROXY_ID ? "System" : proxyLabel(proxies.find((p) => p.id === profile.proxyId))}</span>
                          <span className="pill">{profile.settings.platform}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <div className="meta">
                        <small>{profile.settings.locale} · {profile.settings.timezone}</small>
                      </div>
                      <div className="actions">
                        {profile.status === "running" ? (
                          <button type="button" aria-label="Stop profile" onClick={(e) => { e.stopPropagation(); void stop(profile); }}>
                            <Pause size={15} />
                          </button>
                        ) : (
                          <button type="button" aria-label="Launch profile" onClick={(e) => { e.stopPropagation(); void run(profile); }}>
                            <Play size={15} />
                          </button>
                        )}

                        <button type="button" aria-label="Edit profile" onClick={(e) => { e.stopPropagation(); setDraft(profile); }}>
                          <SquarePen size={15} />
                        </button>

                        <button type="button" aria-label="Duplicate profile" onClick={async (e) => { e.stopPropagation(); const dup = await duplicateProfile(profile); setSelectedId(dup.id); await refresh(); }}>
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}

                {filtered.length === 0 ? <p className="empty">No profiles match the current filter.</p> : null}
              </div>

              <ProfileInspector
                profile={selected}
                proxy={selectedProxy}
                onEdit={() => selected && setDraft(selected)}
                onDelete={() => selected && removeProfile(selected)}
                onLaunch={() => selected && run(selected)}
                onStop={() => selected && stop(selected)}
              />
            </div>

            <section className="logs">
              <div className="section-title">Recent events</div>
              {events.slice(0, 8).map((event) => (
                <div key={`${event.profileId}-${event.at}`} className="log-line">
                  <time>{new Date(event.at).toLocaleTimeString()}</time>
                  <strong>{event.status}</strong>
                  <p>{event.message}</p>
                </div>
              ))}
            </section>
          </>
        ) : null}

        {activeView === "proxies" ? (
          <section className="workspace">
            <div className="list">
              {proxies.length === 0 ? <p className="empty">No proxies saved yet.</p> : null}
              {proxies.map((proxy) => (
                <article key={proxy.id} className="card" onClick={() => setProxyDraft(proxy)}>
                  <div className="title">
                    <div>
                      <h3>{proxy.name}</h3>
                      <small>{proxyDetail(proxy)}</small>
                    </div>
                    <div className="meta">
                      <span className="pill">{proxy.scheme}</span>
                      {proxy.lastTestStatus ? <span className="pill">{proxy.lastTestStatus}</span> : null}
                    </div>
                  </div>
                  <div className="meta">
                    <small>{proxy.username ? `Auth: ${proxy.username}` : "No auth"}</small>
                  </div>
                </article>
              ))}
            </div>

            <aside className="inspector">
              <div className="inspector-head">
                <div>
                  <h2>Proxy Manager</h2>
                  <span className="muted">Create, edit, and attach proxies to profiles.</span>
                </div>
              </div>
              <dl>
                <dt>Total proxies</dt>
                <dd>{proxies.length}</dd>
                <dt>Direct connections</dt>
                <dd>{profiles.filter((profile) => !profile.proxyId).length}</dd>
                <dt>System proxy usage</dt>
                <dd>{profiles.filter((profile) => profile.proxyId === SYSTEM_PROXY_ID).length}</dd>
              </dl>
              <div className="inspector-buttons">
                <button type="button" className="primary" onClick={async () => setProxyDraft(await createProxy())}>
                  <Plus size={16} /> New proxy
                </button>
              </div>
            </aside>
          </section>
        ) : null}

        {activeView === "logs" ? (
          <section className="logs" style={{ maxHeight: "none", minHeight: 0 }}>
            <div className="section-title">Activity log</div>
            {events.length === 0 ? <p className="empty">No recent events.</p> : null}
            {events.map((event) => (
              <div key={`${event.profileId}-${event.at}`} className="log-line">
                <time>{new Date(event.at).toLocaleTimeString()}</time>
                <strong>{event.status}</strong>
                <p>{event.message}</p>
              </div>
            ))}
          </section>
        ) : null}

        {activeView === "settings" ? (
          <section className="workspace">
            <div className="card">
              <div className="title">
                <div>
                  <h3>Application Settings</h3>
                  <small>These controls are intentionally lightweight in this desktop manager.</small>
                </div>
              </div>
              <div className="meta">
                <span className="pill">Auto-refresh running profiles</span>
                <span className="pill">Stored locally in browser/Tauri runtime</span>
                <span className="pill">Proxy and profile editing through modals</span>
              </div>
            </div>

            <aside className="inspector">
              <div className="inspector-head">
                <div>
                  <h2>Shortcuts</h2>
                  <span className="muted">Quick actions for the current workspace.</span>
                </div>
              </div>
              <div className="inspector-buttons">
                <button type="button" className="primary" onClick={addProfile}><Plus size={16} /> New profile</button>
                <button type="button" onClick={() => void refresh()}><Settings size={16} /> Refresh data</button>
              </div>
            </aside>
          </section>
        ) : null}
      </section>

      {draft ? (
        <ProfileEditor profile={draft} proxies={proxies} onCancel={() => setDraft(null)} onSave={persistProfile} onChange={setDraft} />
      ) : null}

      {proxyDraft ? (
        <ProxyEditor
          proxy={proxyDraft}
          onCancel={() => setProxyDraft(null)}
          onChange={setProxyDraft}
          onSave={async (proxy) => { await saveProxy(proxy); setProxyDraft(null); await refresh(); }}
        />
      ) : null}
    </main>
  );
}

function ProfileInspector({ profile, proxy, onEdit, onDelete, onLaunch, onStop }: { profile?: Profile; proxy?: ProxyConfig; onEdit: () => void; onDelete: () => void; onLaunch: () => void; onStop: () => void; }) {
  if (!profile) return <aside className="inspector empty-inspector">Create a profile to get started.</aside>;
  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div>
          <h2>{profile.name}</h2>
          <span className={`status ${profile.status}`}>{profile.status}</span>
        </div>
        <div className="actions">
          {profile.status === "running" ? (
            <button type="button" onClick={onStop} aria-label="Stop profile"><Pause size={16} /></button>
          ) : (
            <button type="button" onClick={onLaunch} aria-label="Launch profile"><Play size={16} /></button>
          )}
          <button type="button" onClick={onEdit} aria-label="Edit profile"><SquarePen size={16} /></button>
          <button type="button" onClick={onDelete} aria-label="Delete profile"><Trash2 size={16} /></button>
        </div>
      </div>

      <dl>
        <dt>Proxy</dt>
        <dd>{proxyDetail(proxy)}</dd>
        <dt>Fingerprint seed</dt>
        <dd>{profile.settings.fingerprintSeed || "Auto"}</dd>
        <dt>Window</dt>
        <dd>{profile.settings.viewportWidth}x{profile.settings.viewportHeight} viewport</dd>
        <dt>Locale</dt>
        <dd>{profile.settings.locale} / {profile.settings.timezone}</dd>
        <dt>Created</dt>
        <dd>{new Date(profile.createdAt).toLocaleString()}</dd>
        <dt>Last launched</dt>
        <dd>{profile.lastLaunchedAt ? new Date(profile.lastLaunchedAt).toLocaleString() : "Never"}</dd>
        <dt>Startup URL</dt>
        <dd>{profile.settings.startupUrl || "Blank tab"}</dd>
        <dt>CDP</dt>
        <dd>{profile.cdpUrl || "Available after launch if runner exposes it"}</dd>
      </dl>

      <div className="inspector-buttons">
        <button type="button" className="primary" onClick={() => openProfileFolder(profile.id)}><FolderOpen size={16} /> Data folder</button>
        <button type="button" disabled={!profile.cdpUrl} onClick={() => profile.cdpUrl && navigator.clipboard.writeText(profile.cdpUrl)}><ExternalLink size={16} /> Copy CDP</button>
      </div>

      {profile.notes ? <p className="notes">{profile.notes}</p> : null}
    </aside>
  );
}

function ProfileEditor({ profile, proxies, onChange, onSave, onCancel }: { profile: Profile; proxies: ProxyConfig[]; onChange: (profile: Profile) => void; onSave: (profile: Profile) => void; onCancel: () => void; }) {
  const patch = (partial: Partial<Profile>) => onChange({ ...profile, ...partial });
  const settings = (partial: Partial<Profile["settings"]>) => onChange({ ...profile, settings: { ...profile.settings, ...partial } });
  const detectFromIp = profile.settings.geoipEnabled;

  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={(e) => e.preventDefault()}>
        <header>
          <h2>Edit profile</h2>
          <button type="button" className="primary" onClick={() => onSave(profile)}><Save size={16} /> Save</button>
        </header>

        <div className="form-grid">
          <Field label="Name"><input value={profile.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <Field label="Group"><input value={profile.groupName} onChange={(e) => patch({ groupName: e.target.value })} /></Field>
          <Field label="Tags"><input value={profile.tags.join(", ")} onChange={(e) => patch({ tags: splitList(e.target.value) })} /></Field>

          <Field label="Proxy">
            <select value={profile.proxyId ?? ""} onChange={(e) => patch({ proxyId: e.target.value || undefined })}>
              <option value="">Direct</option>
              <option value={SYSTEM_PROXY_ID}>System proxy</option>
              {proxies.map((p) => <option key={p.id} value={p.id}>{proxyLabel(p)}</option>)}
            </select>
          </Field>

          <Field label="Platform">
            <select value={profile.settings.platform} onChange={(e) => settings({ platform: e.target.value as Profile["settings"]["platform"] })}>
              <option value="auto">Auto</option>
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
            </select>
          </Field>

          <Field label="Fingerprint seed"><input value={profile.settings.fingerprintSeed} onChange={(e) => settings({ fingerprintSeed: e.target.value })} /></Field>

          <Field label="Locale"><input value={profile.settings.locale} disabled={detectFromIp} onChange={(e) => settings({ locale: e.target.value })} /></Field>

          <Field label="Timezone">
            <select value={profile.settings.timezone} disabled={detectFromIp} onChange={(e) => settings({ timezone: e.target.value })}>
              {Array.from(new Set([profile.settings.timezone, ...timezoneOptions])).map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </Field>

          <Field label="Viewport width"><input type="number" value={profile.settings.viewportWidth} onChange={(e) => settings({ viewportWidth: Number(e.target.value) })} /></Field>
          <Field label="Viewport height"><input type="number" value={profile.settings.viewportHeight} onChange={(e) => settings({ viewportHeight: Number(e.target.value) })} /></Field>

          <Field label="WebRTC">
            <select value={profile.settings.webrtcMode} onChange={(e) => settings({ webrtcMode: e.target.value as Profile["settings"]["webrtcMode"] })}>
              <option value="auto">Auto proxy IP</option>
              <option value="explicit">Explicit IP</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>

          <Field label="WebRTC IP"><input value={profile.settings.webrtcIp} onChange={(e) => settings({ webrtcIp: e.target.value })} /></Field>
          <Field label="Startup URL"><input value={profile.settings.startupUrl} onChange={(e) => settings({ startupUrl: e.target.value })} /></Field>
          <Field label="User agent"><input value={profile.settings.userAgent} onChange={(e) => settings({ userAgent: e.target.value })} /></Field>

          <Field label="Extensions"><textarea value={joinList(profile.settings.extensionPaths)} onChange={(e) => settings({ extensionPaths: splitList(e.target.value) })} /></Field>
          <Field label="Extra args"><textarea value={joinList(profile.settings.extraArgs)} onChange={(e) => settings({ extraArgs: splitList(e.target.value) })} /></Field>

          <label className="check"><input type="checkbox" checked={profile.settings.humanizeEnabled} onChange={(e) => settings({ humanizeEnabled: e.target.checked })} /> Humanize actions</label>
          <label className="check"><input type="checkbox" checked={profile.settings.geoipEnabled} onChange={(e) => settings({ geoipEnabled: e.target.checked })} /> Detect timezone/locale from proxy</label>
        </div>

        <Field label="Notes"><textarea value={profile.notes} onChange={(e) => patch({ notes: e.target.value })} /></Field>

        {detectFromIp ? (
          <p className="muted">Timezone and locale will be resolved from the selected network path. Direct uses a no-proxy outbound lookup, saved proxies use their proxy IP, and System proxy uses Windows proxy settings.</p>
        ) : null}

        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={() => onSave(profile)}><Save size={16} /> Save profile</button>
        </footer>
      </form>
    </div>
  );
}

function ProxyEditor({ proxy, onChange, onSave, onCancel }: { proxy: ProxyConfig; onChange: (proxy: ProxyConfig) => void; onSave: (proxy: ProxyConfig) => void; onCancel: () => void; }) {
  const patch = (partial: Partial<ProxyConfig>) => onChange({ ...proxy, ...partial });
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={(e) => e.preventDefault()}>
        <header>
          <h2>Proxy</h2>
          <button type="button" className="primary" onClick={() => onSave(proxy)}><Save size={16} /> Save</button>
        </header>

        <Field label="Name"><input value={proxy.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
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
        <Field label="Port"><input type="number" value={proxy.port} disabled={proxy.scheme === "system"} onChange={(e) => patch({ port: Number(e.target.value) })} /></Field>
        <Field label="Username"><input value={proxy.username ?? ""} onChange={(e) => patch({ username: e.target.value })} /></Field>
        <Field label="Password"><input type="password" value={proxy.password ?? ""} onChange={(e) => patch({ password: e.target.value })} /></Field>

        <footer>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={() => onSave(proxy)}><Save size={16} /> Save proxy</button>
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
