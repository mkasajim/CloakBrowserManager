import {
  Copy,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
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

const splitList = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const joinList = (value: string[]) => value.join("\n");

export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [proxies, setProxies] = useState<ProxyConfig[]>([]);
  const [events, setEvents] = useState<LaunchEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyConfig | null>(null);

  async function refresh() {
    const [nextProfiles, nextProxies, nextEvents] = await Promise.all([listProfiles(), listProxies(), listEvents()]);
    setProfiles(nextProfiles);
    setProxies(nextProxies);
    setEvents(nextEvents);
    if (!selectedId && nextProfiles[0]) setSelectedId(nextProfiles[0].id);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!profiles.some((profile) => profile.status === "running")) return;
    const interval = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(interval);
  }, [profiles]);

  const selected = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? profiles[0],
    [profiles, selectedId],
  );

  const filtered = profiles.filter((profile) => {
    const haystack = [profile.name, profile.groupName, profile.tags.join(" "), profile.settings.locale, profile.settings.timezone]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  async function addProfile() {
    const profile = await createProfile();
    setDraft(profile);
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
            <span>Windows profile manager</span>
          </div>
        </div>
        <button className="primary" onClick={addProfile}>
          <Plus size={16} /> New profile
        </button>
        <nav>
          <a className="active">Profiles</a>
          <a>Proxies</a>
          <a>Logs</a>
          <a>Settings</a>
        </nav>
        <section className="proxy-panel">
          <div className="section-title">
            <span>Proxies</span>
            <button aria-label="Add proxy" onClick={async () => setProxyDraft(await createProxy())}>
              <Plus size={15} />
            </button>
          </div>
          {proxies.length === 0 ? <p className="muted">No proxies saved.</p> : null}
          {proxies.map((proxy) => (
            <button key={proxy.id} className="proxy-item" onClick={() => setProxyDraft(proxy)}>
              <span>{proxy.name}</span>
              <small>
                {proxy.scheme}://{proxy.host || "host"}:{proxy.port}
              </small>
            </button>
          ))}
        </section>
      </aside>

      <section className="content">
        <header className="toolbar">
          <label className="search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search profiles" />
          </label>
          <button onClick={refresh}>
            <Settings size={16} /> Refresh
          </button>
        </header>

        <section className="profile-grid">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Proxy</th>
                  <th>Platform</th>
                  <th>Locale</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((profile) => (
                  <tr
                    key={profile.id}
                    className={profile.id === selected?.id ? "selected" : ""}
                    onClick={() => setSelectedId(profile.id)}
                  >
                    <td>
                      <strong>{profile.name}</strong>
                      <small>{profile.tags.join(", ") || "No tags"}</small>
                    </td>
                    <td>
                      <span className={`status ${profile.status}`}>{profile.status}</span>
                    </td>
                    <td>{proxies.find((proxy) => proxy.id === profile.proxyId)?.name ?? "Direct"}</td>
                    <td>{profile.settings.platform}</td>
                    <td>
                      {profile.settings.locale}
                      <small>{profile.settings.timezone}</small>
                    </td>
                    <td className="actions">
                      {profile.status === "running" ? (
                        <button aria-label="Stop profile" onClick={() => stop(profile)}>
                          <Pause size={15} />
                        </button>
                      ) : (
                        <button aria-label="Launch profile" onClick={() => run(profile)}>
                          <Play size={15} />
                        </button>
                      )}
                      <button aria-label="Edit profile" onClick={() => setDraft(profile)}>
                        <SquarePen size={15} />
                      </button>
                      <button aria-label="Duplicate profile" onClick={async () => setSelectedId((await duplicateProfile(profile)).id)}>
                        <Copy size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 ? <p className="empty">No profiles match the current filter.</p> : null}
          </div>

          <ProfileInspector
            profile={selected}
            proxy={selected ? proxies.find((item) => item.id === selected.proxyId) : undefined}
            onEdit={() => selected && setDraft(selected)}
            onDelete={() => selected && removeProfile(selected)}
            onLaunch={() => selected && run(selected)}
            onStop={() => selected && stop(selected)}
          />
        </section>

        <section className="logs">
          <div className="section-title">Recent events</div>
          {events.slice(0, 8).map((event) => (
            <div key={`${event.profileId}-${event.at}`} className="log-line">
              <span>{new Date(event.at).toLocaleTimeString()}</span>
              <strong>{event.status}</strong>
              <p>{event.message}</p>
            </div>
          ))}
        </section>
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
}: {
  profile?: Profile;
  proxy?: ProxyConfig;
  onEdit: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onStop: () => void;
}) {
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
            <button onClick={onStop} aria-label="Stop profile">
              <Pause size={16} />
            </button>
          ) : (
            <button onClick={onLaunch} aria-label="Launch profile">
              <Play size={16} />
            </button>
          )}
          <button onClick={onEdit} aria-label="Edit profile">
            <SquarePen size={16} />
          </button>
          <button onClick={onDelete} aria-label="Delete profile">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <dl>
        <dt>Proxy</dt>
        <dd>{proxy ? `${proxy.scheme}://${proxy.host}:${proxy.port}` : "Direct connection"}</dd>
        <dt>Fingerprint seed</dt>
        <dd>{profile.settings.fingerprintSeed || "Auto"}</dd>
        <dt>Window</dt>
        <dd>
          {profile.settings.viewportWidth}x{profile.settings.viewportHeight} viewport
        </dd>
        <dt>Locale</dt>
        <dd>
          {profile.settings.locale} / {profile.settings.timezone}
        </dd>
        <dt>Startup URL</dt>
        <dd>{profile.settings.startupUrl || "Blank tab"}</dd>
        <dt>CDP</dt>
        <dd>{profile.cdpUrl || "Available after launch if runner exposes it"}</dd>
      </dl>
      <div className="inspector-buttons">
        <button onClick={() => openProfileFolder(profile.id)}>
          <FolderOpen size={16} /> Data folder
        </button>
        <button disabled={!profile.cdpUrl} onClick={() => profile.cdpUrl && navigator.clipboard.writeText(profile.cdpUrl)}>
          <ExternalLink size={16} /> Copy CDP
        </button>
      </div>
      {profile.notes ? <p className="notes">{profile.notes}</p> : null}
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
  const patch = (partial: Partial<Profile>) => onChange({ ...profile, ...partial });
  const settings = (partial: Partial<Profile["settings"]>) => onChange({ ...profile, settings: { ...profile.settings, ...partial } });
  return (
    <div className="modal-backdrop">
      <form className="modal wide" onSubmit={(event) => event.preventDefault()}>
        <header>
          <h2>Edit profile</h2>
          <button className="primary" onClick={() => onSave(profile)}>
            <Save size={16} /> Save
          </button>
        </header>
        <div className="form-grid">
          <Field label="Name">
            <input value={profile.name} onChange={(event) => patch({ name: event.target.value })} />
          </Field>
          <Field label="Group">
            <input value={profile.groupName} onChange={(event) => patch({ groupName: event.target.value })} />
          </Field>
          <Field label="Tags">
            <input value={profile.tags.join(", ")} onChange={(event) => patch({ tags: splitList(event.target.value) })} />
          </Field>
          <Field label="Proxy">
            <select value={profile.proxyId ?? ""} onChange={(event) => patch({ proxyId: event.target.value || undefined })}>
              <option value="">Direct</option>
              {proxies.map((proxy) => (
                <option key={proxy.id} value={proxy.id}>
                  {proxy.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Platform">
            <select value={profile.settings.platform} onChange={(event) => settings({ platform: event.target.value as Profile["settings"]["platform"] })}>
              <option value="auto">Auto</option>
              <option value="windows">Windows</option>
              <option value="macos">macOS</option>
              <option value="linux">Linux</option>
            </select>
          </Field>
          <Field label="Fingerprint seed">
            <input value={profile.settings.fingerprintSeed} onChange={(event) => settings({ fingerprintSeed: event.target.value })} />
          </Field>
          <Field label="Locale">
            <input value={profile.settings.locale} onChange={(event) => settings({ locale: event.target.value })} />
          </Field>
          <Field label="Timezone">
            <input value={profile.settings.timezone} onChange={(event) => settings({ timezone: event.target.value })} />
          </Field>
          <Field label="Viewport width">
            <input type="number" value={profile.settings.viewportWidth} onChange={(event) => settings({ viewportWidth: Number(event.target.value) })} />
          </Field>
          <Field label="Viewport height">
            <input type="number" value={profile.settings.viewportHeight} onChange={(event) => settings({ viewportHeight: Number(event.target.value) })} />
          </Field>
          <Field label="WebRTC">
            <select value={profile.settings.webrtcMode} onChange={(event) => settings({ webrtcMode: event.target.value as Profile["settings"]["webrtcMode"] })}>
              <option value="auto">Auto proxy IP</option>
              <option value="explicit">Explicit IP</option>
              <option value="disabled">Disabled</option>
            </select>
          </Field>
          <Field label="WebRTC IP">
            <input value={profile.settings.webrtcIp} onChange={(event) => settings({ webrtcIp: event.target.value })} />
          </Field>
          <Field label="Startup URL">
            <input value={profile.settings.startupUrl} onChange={(event) => settings({ startupUrl: event.target.value })} />
          </Field>
          <Field label="User agent">
            <input value={profile.settings.userAgent} onChange={(event) => settings({ userAgent: event.target.value })} />
          </Field>
          <Field label="Extensions">
            <textarea value={joinList(profile.settings.extensionPaths)} onChange={(event) => settings({ extensionPaths: splitList(event.target.value) })} />
          </Field>
          <Field label="Extra args">
            <textarea value={joinList(profile.settings.extraArgs)} onChange={(event) => settings({ extraArgs: splitList(event.target.value) })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={profile.settings.humanizeEnabled} onChange={(event) => settings({ humanizeEnabled: event.target.checked })} />
            Humanize actions
          </label>
          <label className="check">
            <input type="checkbox" checked={profile.settings.geoipEnabled} onChange={(event) => settings({ geoipEnabled: event.target.checked })} />
            Detect timezone/locale from proxy
          </label>
        </div>
        <Field label="Notes">
          <textarea value={profile.notes} onChange={(event) => patch({ notes: event.target.value })} />
        </Field>
        <footer>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onSave(profile)}>
            <Save size={16} /> Save profile
          </button>
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
  const patch = (partial: Partial<ProxyConfig>) => onChange({ ...proxy, ...partial });
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={(event) => event.preventDefault()}>
        <header>
          <h2>Proxy</h2>
          <button className="primary" onClick={() => onSave(proxy)}>
            <Save size={16} /> Save
          </button>
        </header>
        <Field label="Name">
          <input value={proxy.name} onChange={(event) => patch({ name: event.target.value })} />
        </Field>
        <Field label="Scheme">
          <select value={proxy.scheme} onChange={(event) => patch({ scheme: event.target.value as ProxyConfig["scheme"] })}>
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </Field>
        <Field label="Host">
          <input value={proxy.host} onChange={(event) => patch({ host: event.target.value })} />
        </Field>
        <Field label="Port">
          <input type="number" value={proxy.port} onChange={(event) => patch({ port: Number(event.target.value) })} />
        </Field>
        <Field label="Username">
          <input value={proxy.username ?? ""} onChange={(event) => patch({ username: event.target.value })} />
        </Field>
        <Field label="Password">
          <input type="password" value={proxy.password ?? ""} onChange={(event) => patch({ password: event.target.value })} />
        </Field>
        <footer>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onSave(proxy)}>
            <Save size={16} /> Save proxy
          </button>
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
