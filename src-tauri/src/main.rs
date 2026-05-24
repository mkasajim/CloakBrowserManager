#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Utc;
use directories::ProjectDirs;
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
struct RunnerState {
    children: Mutex<HashMap<String, Child>>,
}

struct AppState {
    db_path: PathBuf,
    data_dir: PathBuf,
    profiles_dir: PathBuf,
    events: Mutex<Vec<LaunchEvent>>,
    runner: RunnerState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    name: String,
    group_name: String,
    tags: Vec<String>,
    notes: String,
    proxy_id: Option<String>,
    status: ProfileStatus,
    cdp_url: Option<String>,
    created_at: String,
    updated_at: String,
    last_launched_at: Option<String>,
    settings: ProfileSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSettings {
    fingerprint_seed: String,
    platform: String,
    user_agent: String,
    locale: String,
    timezone: String,
    viewport_width: u32,
    viewport_height: u32,
    screen_width: u32,
    screen_height: u32,
    device_scale_factor: f64,
    humanize_enabled: bool,
    human_preset: String,
    geoip_enabled: bool,
    webrtc_mode: String,
    webrtc_ip: String,
    startup_url: String,
    extension_paths: Vec<String>,
    extra_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ProfileStatus {
    Stopped,
    Running,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProxyConfig {
    id: String,
    name: String,
    scheme: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    bypass: Option<String>,
    last_test_status: Option<String>,
    last_test_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchEvent {
    profile_id: String,
    status: ProfileStatus,
    message: String,
    cdp_url: Option<String>,
    at: String,
}

impl AppState {
    fn new() -> Result<Self, String> {
        let dirs = ProjectDirs::from("local", "CloakBrowser", "CloakBrowserLocalManager")
            .ok_or_else(|| "Could not resolve Windows app data directories".to_string())?;
        let data_dir = dirs.data_local_dir().to_path_buf();
        let profiles_dir = data_dir.join("profiles");
        fs::create_dir_all(&profiles_dir).map_err(|error| error.to_string())?;
        fs::create_dir_all(data_dir.join("logs")).map_err(|error| error.to_string())?;
        let db_path = data_dir.join("manager.db");
        let state = Self {
            db_path,
            data_dir,
            profiles_dir,
            events: Mutex::new(Vec::new()),
            runner: RunnerState::default(),
        };
        state.migrate()?;
        Ok(state)
    }

    fn conn(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }

    fn migrate(&self) -> Result<(), String> {
        self.conn()?
            .execute_batch(
                "
                create table if not exists profiles (
                  id text primary key,
                  name text not null,
                  group_name text not null default '',
                  tags_json text not null,
                  notes text not null default '',
                  proxy_id text,
                  status text not null default 'stopped',
                  cdp_url text,
                  created_at text not null,
                  updated_at text not null,
                  last_launched_at text,
                  settings_json text not null
                );
                create table if not exists proxies (
                  id text primary key,
                  json text not null
                );
                create table if not exists launch_events (
                  id integer primary key autoincrement,
                  profile_id text not null,
                  json text not null,
                  created_at text not null
                );
                ",
            )
            .map_err(|error| error.to_string())
    }

    fn profile_dir(&self, profile_id: &str) -> PathBuf {
        self.profiles_dir.join(profile_id)
    }
}

#[tauri::command]
fn list_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "select id, name, group_name, tags_json, notes, proxy_id, status, cdp_url, created_at, updated_at, last_launched_at, settings_json from profiles order by updated_at desc",
        )
        .map_err(|error| error.to_string())?;
    let profiles = stmt
        .query_map([], row_to_profile)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(profiles)
}

#[tauri::command]
fn save_profile(profile: Profile, state: State<AppState>) -> Result<Profile, String> {
    if profile.name.trim().is_empty() {
        return Err("Profile name is required".to_string());
    }
    let mut next = profile;
    next.updated_at = Utc::now().to_rfc3339();
    let conn = state.conn()?;
    conn.execute(
        "
        insert into profiles (id, name, group_name, tags_json, notes, proxy_id, status, cdp_url, created_at, updated_at, last_launched_at, settings_json)
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        on conflict(id) do update set
          name=excluded.name,
          group_name=excluded.group_name,
          tags_json=excluded.tags_json,
          notes=excluded.notes,
          proxy_id=excluded.proxy_id,
          status=excluded.status,
          cdp_url=excluded.cdp_url,
          updated_at=excluded.updated_at,
          last_launched_at=excluded.last_launched_at,
          settings_json=excluded.settings_json
        ",
        params![
            next.id,
            next.name,
            next.group_name,
            serde_json::to_string(&next.tags).map_err(|error| error.to_string())?,
            next.notes,
            next.proxy_id,
            status_to_str(&next.status),
            next.cdp_url,
            next.created_at,
            next.updated_at,
            next.last_launched_at,
            serde_json::to_string(&next.settings).map_err(|error| error.to_string())?,
        ],
    )
    .map_err(|error| error.to_string())?;
    fs::create_dir_all(state.profile_dir(&next.id)).map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
fn delete_profile(
    profile_id: String,
    remove_data: bool,
    state: State<AppState>,
) -> Result<(), String> {
    stop_profile_inner(profile_id.clone(), state.inner())?;
    state
        .conn()?
        .execute("delete from profiles where id=?1", params![profile_id])
        .map_err(|error| error.to_string())?;
    if remove_data {
        let target = state.profile_dir(&profile_id);
        if target.exists() && target.starts_with(&state.profiles_dir) {
            fs::remove_dir_all(target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn list_proxies(state: State<AppState>) -> Result<Vec<ProxyConfig>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("select json from proxies order by json")
        .map_err(|error| error.to_string())?;
    let proxies = stmt
        .query_map([], |row| {
            let json: String = row.get(0)?;
            serde_json::from_str::<ProxyConfig>(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(proxies)
}

#[tauri::command]
fn save_proxy(proxy: ProxyConfig, state: State<AppState>) -> Result<ProxyConfig, String> {
    if proxy.name.trim().is_empty() || proxy.host.trim().is_empty() {
        return Err("Proxy name and host are required".to_string());
    }
    let json = serde_json::to_string(&proxy).map_err(|error| error.to_string())?;
    state
        .conn()?
        .execute(
            "insert into proxies (id, json) values (?1, ?2) on conflict(id) do update set json=excluded.json",
            params![proxy.id, json],
        )
        .map_err(|error| error.to_string())?;
    Ok(proxy)
}

#[tauri::command]
fn launch_profile(
    profile_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<LaunchEvent, String> {
    let mut profile =
        get_profile(&state, &profile_id)?.ok_or_else(|| "Profile not found".to_string())?;
    let profile_dir = state.profile_dir(&profile_id);
    fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;

    let payload_path = state.data_dir.join(format!("launch-{profile_id}.json"));
    let payload = serde_json::json!({
        "profile": profile,
        "profileDataDir": profile_dir,
        "proxy": match profile.proxy_id.as_ref() {
            Some(proxy_id) => get_proxy(&state, proxy_id)?,
            None => None,
        }
    });
    fs::write(
        &payload_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let dev_runner_script = PathBuf::from("runner").join("dist").join("index.js");
    let runner_script = resolve_runner_script(&app).unwrap_or(dev_runner_script);

    let mut message = "Runner started.".to_string();
    if runner_script.exists() {
        let mut command = Command::new("node");
        command
            .arg(runner_script)
            .arg("launch")
            .arg(&payload_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(target_os = "windows")]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command
            .spawn()
            .map_err(|error| format!("Failed to start Node runner: {error}"))?;
        state
            .runner
            .children
            .lock()
            .unwrap()
            .insert(profile_id.clone(), child);
    } else {
        message =
            "Runner build not found. Run npm run runner:build before launching a real browser."
                .to_string();
    }

    let at = Utc::now().to_rfc3339();
    profile.status = ProfileStatus::Running;
    profile.last_launched_at = Some(at.clone());
    save_profile_inner(state.inner(), &profile)?;
    let event = LaunchEvent {
        profile_id,
        status: ProfileStatus::Running,
        message,
        cdp_url: None,
        at,
    };
    record_event(&state, &event)?;
    Ok(event)
}

fn resolve_runner_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidates = [
        resource_dir.join("runner").join("dist").join("index.js"),
        resource_dir.join("dist").join("index.js"),
        resource_dir.join("runner-dist").join("index.js"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

#[tauri::command]
fn stop_profile(profile_id: String, state: State<AppState>) -> Result<LaunchEvent, String> {
    stop_profile_inner(profile_id, state.inner())
}

fn stop_profile_inner(profile_id: String, state: &AppState) -> Result<LaunchEvent, String> {
    if let Some(mut child) = state.runner.children.lock().unwrap().remove(&profile_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut profile) = get_profile(state, &profile_id)? {
        profile.status = ProfileStatus::Stopped;
        profile.cdp_url = None;
        save_profile_inner(state, &profile)?;
    }
    let event = LaunchEvent {
        profile_id,
        status: ProfileStatus::Stopped,
        message: "Profile stopped.".to_string(),
        cdp_url: None,
        at: Utc::now().to_rfc3339(),
    };
    record_event(state, &event)?;
    Ok(event)
}

#[tauri::command]
fn list_launch_events(state: State<AppState>) -> Result<Vec<LaunchEvent>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare("select json from launch_events order by id desc limit 100")
        .map_err(|error| error.to_string())?;
    let events = stmt
        .query_map([], |row| {
            let json: String = row.get(0)?;
            serde_json::from_str::<LaunchEvent>(&json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(events)
}

#[tauri::command]
fn open_profile_folder(profile_id: String, state: State<AppState>) -> Result<(), String> {
    let dir = state.profile_dir(&profile_id);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn get_profile(state: &AppState, profile_id: &str) -> Result<Option<Profile>, String> {
    state
        .conn()?
        .query_row(
            "select id, name, group_name, tags_json, notes, proxy_id, status, cdp_url, created_at, updated_at, last_launched_at, settings_json from profiles where id=?1",
            params![profile_id],
            row_to_profile,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn get_proxy(state: &AppState, proxy_id: &str) -> Result<Option<ProxyConfig>, String> {
    state
        .conn()?
        .query_row(
            "select json from proxies where id=?1",
            params![proxy_id],
            |row| {
                let json: String = row.get(0)?;
                serde_json::from_str::<ProxyConfig>(&json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(error))
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn save_profile_inner(state: &AppState, profile: &Profile) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "update profiles set status=?2, cdp_url=?3, last_launched_at=?4, updated_at=?5 where id=?1",
        params![
            profile.id,
            status_to_str(&profile.status),
            profile.cdp_url,
            profile.last_launched_at,
            Utc::now().to_rfc3339(),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn record_event(state: &AppState, event: &LaunchEvent) -> Result<(), String> {
    state.events.lock().unwrap().insert(0, event.clone());
    state
        .conn()?
        .execute(
            "insert into launch_events (profile_id, json, created_at) values (?1, ?2, ?3)",
            params![
                event.profile_id,
                serde_json::to_string(event).map_err(|error| error.to_string())?,
                event.at,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn row_to_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
    let tags_json: String = row.get(3)?;
    let settings_json: String = row.get(11)?;
    let status: String = row.get(6)?;
    Ok(Profile {
        id: row.get(0)?,
        name: row.get(1)?,
        group_name: row.get(2)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        notes: row.get(4)?,
        proxy_id: row.get(5)?,
        status: str_to_status(&status),
        cdp_url: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        last_launched_at: row.get(10)?,
        settings: serde_json::from_str(&settings_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(11, Type::Text, Box::new(error))
        })?,
    })
}

fn status_to_str(status: &ProfileStatus) -> &'static str {
    match status {
        ProfileStatus::Stopped => "stopped",
        ProfileStatus::Running => "running",
        ProfileStatus::Unknown => "unknown",
    }
}

fn str_to_status(status: &str) -> ProfileStatus {
    match status {
        "running" => ProfileStatus::Running,
        "unknown" => ProfileStatus::Unknown,
        _ => ProfileStatus::Stopped,
    }
}

fn main() {
    let state = AppState::new().expect("failed to initialize app state");
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            save_profile,
            delete_profile,
            list_proxies,
            save_proxy,
            launch_profile,
            stop_profile,
            list_launch_events,
            open_profile_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
