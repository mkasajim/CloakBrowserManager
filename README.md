# CloakBrowser Local Manager

Windows-first local desktop manager for CloakBrowser profiles.

This app intentionally does **not** use Docker, VNC, noVNC, or a remote framebuffer. Profiles are launched as real local headed CloakBrowser windows on the same machine.

## Stack

- Tauri v2 desktop shell.
- React + TypeScript UI.
- Rust backend with SQLite under `%LOCALAPPDATA%\CloakBrowser\CloakBrowserLocalManager`.
- Node/TypeScript runner using `cloakbrowser` + `playwright-core`.

## Current Status

- Web UI builds and runs.
- Runner builds.
- Tauri source is present, but the desktop build requires Rust/Cargo on PATH.
- Release builds bundle a Node runtime with the JS runner so installed and portable Windows builds can launch real browser profiles without a separate local Node install.

## Run UI Preview

```powershell
npm install
npm --prefix runner install
npm run dev
```

Open:

```text
http://127.0.0.1:1420
```

The browser preview uses localStorage mocks because Tauri commands are only available inside the desktop shell.

## Build Frontend And Runner

```powershell
npm run build
npm run runner:build
npm run runner:prepare-node
```

## Build Desktop App

Install Rust first:

```powershell
winget install Rustlang.Rustup
```

Restart the terminal, then:

```powershell
npm run tauri build
```

## Important Files

- `CLOAKBROWSER_LOCAL_MANAGER_PLAN.md` tracks the implementation checklist.
- `src/App.tsx` contains the manager UI.
- `src/api.ts` bridges Tauri commands and web-preview mocks.
- `src-tauri/src/main.rs` contains SQLite commands and runner process management.
- `runner/src/index.ts` launches real local CloakBrowser persistent contexts.
