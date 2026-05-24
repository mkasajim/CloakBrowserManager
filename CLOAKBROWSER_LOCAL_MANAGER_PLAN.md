# CloakBrowser Local Manager Plan

## Decision

Use **Tauri**, not Python + PyQt6.

Reasoning:

- Tauri gives a fast Windows desktop shell using the system WebView2 runtime, so the manager can stay light when no browsers are running.
- PyQt6 is simpler for calling the Python `cloakbrowser` package directly, but a packaged PyQt6 app normally starts slower, ships a larger runtime, and keeps a heavier GUI process alive.
- CloakBrowser itself is Playwright-compatible and has both Python and JavaScript packages. For a Windows desktop manager, the best tradeoff is:
  - Tauri app for UI, settings, SQLite, process tracking, and Windows integration.
  - A small lazy-start browser runner sidecar using Node/TypeScript and `cloakbrowser` + `playwright-core` for profile launch/stop/CDP operations.
  - No Docker, no VNC, no remote browser framebuffer. Launches open the real local CloakBrowser window on the same Windows desktop.

If direct binary launch becomes stable enough from CloakBrowser internals, replace the Node sidecar with direct Rust process spawning later. Start with the sidecar because it uses CloakBrowser's public JS API and lowers integration risk.

## Goals

- Windows desktop app for managing local CloakBrowser profiles.
- No Docker.
- No VNC/noVNC.
- No browser-in-manager streaming.
- Launch real headed CloakBrowser windows on the same machine.
- Support multiple profiles with isolated user data directories.
- Support proxy, platform, locale, timezone, user agent, viewport/screen size, fingerprint seed, WebRTC IP behavior, and extra launch args.
- Support create, edit, duplicate, delete, launch, stop, status, and profile notes/tags.
- Keep the manager fast to start and low-resource while idle.
- Persist enough context in this plan so work can resume after interruption.

## Confirmed Upstream Facts

- `CloakBrowser` is a wrapper around a custom Chromium binary and exposes Playwright-compatible APIs.
- It supports headed mode with `headless=False`.
- It supports HTTP and SOCKS5 proxies.
- It supports persistent profiles through `launch_persistent_context(user_data_dir, headless=False)`.
- It supports timezone, locale, viewport, user agent, humanize options, extension paths, and extra Chromium args.
- The official manager is Docker-based and uses FastAPI, React, SQLite, noVNC, and CloakBrowser.
- The official manager exposes CDP for running profiles; this local manager should also expose/copy CDP endpoints where practical, but visual interaction should happen in the real browser window.

## Proposed Architecture

### Desktop Shell

- Tauri v2.
- React + TypeScript frontend.
- Tailwind or plain CSS modules for a quiet operational UI.
- Rust backend commands for profile CRUD, settings, filesystem paths, process lifecycle, and SQLite access.
- System tray optional after MVP.

### Browser Runner

- Lazy-start sidecar process written in TypeScript/Node.
- Depends on `cloakbrowser` and `playwright-core`.
- Responsibilities:
  - Launch profile with `launch_persistent_context(profile_data_dir, headless=false, ...)`.
  - Keep a registry of active contexts.
  - Stop profile cleanly.
  - Report process/status metadata.
  - Return CDP info if available.
  - Stream structured logs back to Tauri.
- The sidecar should start only when a profile is launched or when status reconciliation needs it.
- Sidecar exits automatically when no profiles are running unless configured to stay alive.

### Storage

- SQLite database stored under `%APPDATA%\CloakBrowserLocalManager\manager.db`.
- Profile browser data stored under `%LOCALAPPDATA%\CloakBrowserLocalManager\profiles\<profile_id>\`.
- App logs stored under `%LOCALAPPDATA%\CloakBrowserLocalManager\logs\`.
- Encrypted proxy credentials using Windows DPAPI via Rust where possible.

### Process Model

- Manager process: Tauri app, always light.
- Browser runner sidecar: starts on demand.
- Browser processes: one CloakBrowser headed persistent context per launched profile.
- No VNC server, no Xvfb, no container, no browser framebuffer transport.

## Data Model

### profiles

- `id` UUID primary key.
- `name` required.
- `group_name` optional.
- `tags` JSON array.
- `notes` text.
- `status` derived at runtime, not trusted from DB.
- `created_at`, `updated_at`, `last_launched_at`.

### profile_settings

- `profile_id`.
- `fingerprint_seed`.
- `platform` enum: `windows`, `macos`, `linux`, `auto`.
- `user_agent`.
- `locale`.
- `timezone`.
- `viewport_width`, `viewport_height`.
- `screen_width`, `screen_height`.
- `device_scale_factor`.
- `color_scheme`.
- `humanize_enabled`.
- `human_preset`.
- `geoip_enabled`.
- `webrtc_mode`: `auto`, `disabled`, `explicit`.
- `webrtc_ip`.
- `startup_url`.
- `extension_paths` JSON array.
- `extra_args` JSON array.

### proxies

- `id` UUID primary key.
- `name`.
- `scheme`: `http`, `https`, `socks5`.
- `host`.
- `port`.
- `username`.
- `password_encrypted`.
- `bypass`.
- `test_url`.
- `last_test_status`.
- `last_test_at`.

### profile_proxy

- `profile_id`.
- `proxy_id`.
- Or allow inline per-profile proxy settings for MVP if simpler.

### launch_history

- `id`.
- `profile_id`.
- `started_at`.
- `stopped_at`.
- `exit_reason`.
- `runner_version`.
- `cloakbrowser_version`.
- `log_path`.

## MVP Features

- Profile list with search, tags, status, and last launched time.
- Create/edit profile dialog.
- Delete profile with option to keep or remove browser data.
- Duplicate profile with either:
  - copy settings only, or
  - copy settings plus browser data.
- Launch profile in real local CloakBrowser window.
- Stop launched profile.
- Open profile data folder.
- Proxy form with HTTP/SOCKS5 support and auth.
- Proxy test through the selected proxy.
- Platform/fingerprint settings:
  - platform
  - fingerprint seed
  - locale/timezone
  - user agent
  - viewport/screen size
  - WebRTC IP auto/explicit
  - humanize on/off
- Global settings:
  - data directory
  - browser runner path/status
  - auto-update CloakBrowser package/binary check
  - logs retention
- Basic logs panel per profile.

## Post-MVP Features

- Profile groups and bulk actions.
- Import/export profiles as JSON, with credentials excluded by default.
- Proxy pool management and assignment.
- Health checks for all proxies.
- Start URL templates.
- Extension manager.
- Cookie/storage export/import.
- CDP endpoint copy button for automation.
- Optional local HTTP API bound to `127.0.0.1` only.
- Optional auth token for local API.
- System tray: keep manager in tray while profiles run.
- Crash recovery: detect orphaned browser processes and reconcile statuses.
- Per-profile window placement/size memory.
- Portable mode.

## UI Plan

- First screen is the actual profile manager, not a landing page.
- Layout:
  - Left sidebar: groups/tags/settings.
  - Main table: profiles with status, proxy, platform, locale/timezone, last launch.
  - Right inspector or modal for profile edit.
  - Bottom/log drawer for active profile logs.
- Controls:
  - Icon buttons for launch, stop, duplicate, edit, delete, open folder, copy CDP.
  - Segmented controls for platform and WebRTC mode.
  - Toggles for humanize and geoip.
  - Inputs for proxy, viewport, seed, locale, timezone.
- Avoid heavy decorative UI. This is an operational desktop tool.

## Build Plan

1. Scaffold Tauri v2 + React + TypeScript app. **Done**
2. Add Rust SQLite layer and migrations. **Initial implementation done**
3. Add profile CRUD commands and frontend screens. **Initial implementation done**
4. Add Node browser-runner package with `cloakbrowser` and `playwright-core`. **Done**
5. Add Tauri sidecar packaging and lazy startup. **Partially done: JS runner is packaged as resources; standalone runner exe still pending**
6. Implement launch/stop/status protocol between Tauri and runner. **Initial launch/kill process handling done**
7. Wire profile settings to CloakBrowser launch options. **Initial mapping done**
8. Add proxy test command.
9. Add logs and launch history.
10. Package Windows installer/exe.
11. Measure cold start, idle RAM, launch time, and profile RAM.

## Technical Risks

- CloakBrowser JS API may not expose every low-level launch detail needed for CDP or process tracking. Mitigation: use Playwright context/browser APIs where possible and keep sidecar protocol flexible.
- Tauri cannot directly run Node code in production. Mitigation: package the Node browser runner as a sidecar executable.
- Persistent context lifecycle differs from normal browser lifecycle. Mitigation: model a launched profile as a browser context plus owning runner session.
- Proxy credentials need careful handling. Mitigation: store encrypted via Windows DPAPI and avoid writing plaintext to logs.
- Some fingerprint/platform combinations can be unrealistic. Mitigation: add validation presets and warn on inconsistent combinations.

## Validation Plan

- Unit tests for DB migrations and profile/proxy validation.
- Runner integration test:
  - create temp profile dir
  - launch headed=false for CI smoke where possible
  - launch headed=true manually on Windows
  - verify session persistence across restarts
- Manual Windows tests:
  - cold start manager
  - create profile
  - launch real browser window
  - login/session persistence
  - edit proxy and relaunch
  - duplicate and delete
  - stop profile
  - orphan recovery after killing browser process
- Performance targets:
  - Manager cold start: under 2 seconds on a normal Windows desktop after first install.
  - Idle manager RAM: target under 120 MB.
  - Sidecar not running while idle unless profiles are active.
  - Browser RAM accepted as CloakBrowser/Chromium cost, not manager cost.

## Initial File/Folder Layout

```text
CloakBrowserManager/
  src-tauri/
    src/
      commands/
      db/
      runner/
      settings/
    migrations/
    tauri.conf.json
  src/
    components/
    features/
      profiles/
      proxies/
      settings/
      logs/
    lib/
    App.tsx
  runner/
    src/
      index.ts
      cloak.ts
      protocol.ts
    package.json
    tsconfig.json
  docs/
    architecture.md
  CLOAKBROWSER_LOCAL_MANAGER_PLAN.md
```

## Task List

### Phase 0 - Planning

- [x] Inspect workspace.
- [x] Check upstream CloakBrowser and CloakBrowser-Manager documentation.
- [x] Decide Tauri vs PyQt6.
- [x] Write persistent plan file.

### Phase 1 - Project Scaffold

- [x] Initialize Tauri v2 React TypeScript project in this workspace.
- [x] Add base app layout.
- [ ] Add formatting/linting scripts.
- [x] Add Windows app metadata and icons placeholder.

### Phase 2 - Local Database

- [x] Add SQLite dependency in Rust.
- [x] Create migrations.
- [x] Implement profile repository.
- [x] Implement proxy repository.
- [x] Implement launch history repository.
- [x] Add validation layer.

### Phase 3 - Frontend CRUD

- [x] Build profile table.
- [x] Build create/edit profile form.
- [x] Build delete flow with data retention choice.
- [x] Build duplicate flow.
- [x] Build proxy editor.
- [ ] Build settings screen.

### Phase 4 - Browser Runner

- [x] Create `runner/` TypeScript package.
- [x] Install `cloakbrowser` and `playwright-core`.
- [x] Define JSON protocol for launch/stop/status/log events.
- [x] Implement launch persistent profile.
- [x] Implement stop profile.
- [x] Implement active session tracking.
- [ ] Implement structured logging.
- [ ] Build runner into Windows sidecar executable.

### Phase 5 - Tauri/Runner Integration

- [ ] Package runner as Tauri sidecar.
- [x] Implement lazy sidecar startup.
- [x] Implement profile launch command.
- [x] Implement profile stop command.
- [ ] Implement status reconciliation.
- [ ] Implement orphan process detection strategy.

### Phase 6 - Profile Settings Coverage

- [x] Proxy mapping.
- [x] Platform mapping.
- [x] Fingerprint seed mapping.
- [x] Locale/timezone mapping.
- [x] User agent mapping.
- [x] Viewport/screen mapping.
- [x] WebRTC IP mapping.
- [x] Humanize mapping.
- [x] Extension paths mapping.
- [x] Extra Chromium args mapping.

### Phase 7 - Utilities

- [ ] Proxy test.
- [x] Open profile data folder.
- [x] Copy CDP endpoint if available.
- [ ] Import/export profiles.
- [ ] Logs panel.

### Phase 8 - Packaging

- [ ] Configure Windows installer/exe.
- [ ] Ensure first-run CloakBrowser binary download UX is clear.
- [ ] Add portable data path option if feasible.
- [ ] Sign/notarization placeholder notes if user wants distribution.

### Phase 9 - Verification

- [ ] Run unit tests.
- [x] Run frontend build.
- [ ] Run Tauri build. Blocked on missing Rust/Cargo in current PATH.
- [ ] Test on Windows with real headed launch.
- [ ] Measure manager cold start and idle RAM.
- [ ] Measure sidecar idle/running behavior.
- [ ] Document known limitations.

## Resume Notes

- Start implementation from Phase 1.
- Keep this file updated after each meaningful task.
- Prefer changing task checkboxes as work completes so another session can resume from here.
- Do not introduce Docker or VNC.
- Do not embed the browser view in the manager for MVP; the browser must open as a real local headed window.
