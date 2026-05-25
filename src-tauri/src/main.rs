#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::Utc;
use directories::ProjectDirs;
use rusqlite::{params, types::Type, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
};
use tauri::{Emitter, Manager, State};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SYSTEM_PROXY_ID: &str = "__system_proxy__";

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
    if proxy.name.trim().is_empty() {
        return Err("Proxy name is required".to_string());
    }
    if proxy.scheme != "system" && proxy.host.trim().is_empty() {
        return Err("Proxy host is required".to_string());
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
            Some(proxy_id) if proxy_id == SYSTEM_PROXY_ID => Some(system_proxy_config()),
            Some(proxy_id) => get_proxy(&state, proxy_id)?,
            None => None,
        }
    });
    fs::write(
        &payload_path,
        serde_json::to_vec_pretty(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let resource_dir = app.path().resource_dir().ok();
    let runner_root = find_existing_path(
        [
            exe_dir.as_ref().map(|path| path.join("runner")),
            resource_dir.as_ref().map(|path| path.join("runner")),
            Some(PathBuf::from("runner")),
        ]
        .into_iter()
        .flatten(),
    );
    let runner_script = find_existing_path(
        [
            runner_root
                .as_ref()
                .map(|path| path.join("dist").join("index.js")),
            resource_dir
                .as_ref()
                .map(|path| path.join("runner").join("dist").join("index.js")),
            resource_dir
                .as_ref()
                .map(|path| path.join("dist").join("index.js")),
            Some(PathBuf::from("runner").join("dist").join("index.js")),
        ]
        .into_iter()
        .flatten(),
    );
    let bundled_node = find_existing_path(
        [
            runner_root
                .as_ref()
                .map(|path| path.join("bin").join("node.exe")),
            resource_dir
                .as_ref()
                .map(|path| path.join("runner").join("bin").join("node.exe")),
            resource_dir
                .as_ref()
                .map(|path| path.join("bin").join("node.exe")),
        ]
        .into_iter()
        .flatten(),
    );

    let mut message = "Runner started.".to_string();
    if let Some(runner_script) = runner_script {
        let mut command = bundled_node
            .map(Command::new)
            .unwrap_or_else(|| Command::new("node"));
        hide_command_window(&mut command);
        if let Some(runner_root) = runner_root.as_ref() {
            command.current_dir(runner_root);
        }
        let script_arg = runner_root
            .as_ref()
            .filter(|root| runner_script.starts_with(root))
            .map(|_| PathBuf::from("dist").join("index.js"))
            .unwrap_or(runner_script.clone());
        let child = command
            .arg(&script_arg)
            .arg("launch")
            .arg(&payload_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Failed to start Node runner: {error}"))?;
        let mut child = child;
        if let Some(stdout) = child.stdout.take() {
            spawn_runner_log_reader(stdout, state.db_path.clone(), profile_id.clone(), false, app.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            spawn_runner_log_reader(stderr, state.db_path.clone(), profile_id.clone(), true, app.clone());
        }
        state
            .runner
            .children
            .lock()
            .unwrap()
            .insert(profile_id.clone(), child);
    } else {
        let resolved = runner_root
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "<not found>".to_string());
        message = format!(
            "Runner build not found. Expected runner files under {resolved}. Run npm run runner:build before launching a real browser."
        );
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

fn find_existing_path(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|path| path.exists())
}

fn hide_command_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn spawn_runner_log_reader<R>(
    reader: R,
    db_path: PathBuf,
    profile_id: String,
    is_error_stream: bool,
    app: tauri::AppHandle,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let Some(message) = runner_message_from_line(&line, is_error_stream) else {
                continue;
            };
            let event = LaunchEvent {
                profile_id: profile_id.clone(),
                status: ProfileStatus::Running,
                message,
                cdp_url: None,
                at: Utc::now().to_rfc3339(),
            };
            let _ = record_event_to_db(&db_path, &event);
            let _ = app.emit("runner-log", &event);
        }
    });
}

fn runner_message_from_line(line: &str, is_error_stream: bool) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
        if let Some(message) = value.get("message").and_then(|item| item.as_str()) {
            return Some(message.to_string());
        }
    }
    let lower = line.to_lowercase();
    let prefix = if is_error_stream && (lower.contains("error") || lower.contains("failed")) {
        "Runner error"
    } else {
        "Runner"
    };
    Some(format!("{prefix}: {line}"))
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

#[tauri::command]
fn test_proxy(proxy: ProxyConfig, state: State<AppState>) -> Result<ProxyConfig, String> {
    let mut next_proxy = proxy.clone();
    let mut cmd = Command::new("curl");
    hide_command_window(&mut cmd);
    cmd.arg("-s")
       .arg("--max-time")
       .arg("5")
       .arg("https://api.ipify.org");
       
    if proxy.scheme != "system" {
        let proxy_url = format!("{}://{}:{}", proxy.scheme, proxy.host, proxy.port);
        cmd.arg("--proxy").arg(&proxy_url);
        if let (Some(u), Some(p)) = (&proxy.username, &proxy.password) {
            if !u.is_empty() {
                cmd.arg("--proxy-user").arg(format!("{}:{}", u, p));
            }
        }
    }
    
    let start = std::time::Instant::now();
    match cmd.output() {
        Ok(output) => {
            let latency = start.elapsed().as_millis();
            if output.status.success() {
                let exit_ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !exit_ip.is_empty() && exit_ip.len() < 45 {
                    next_proxy.last_test_status = Some(format!("Success (IP: {}, Latency: {}ms)", exit_ip, latency));
                } else {
                    next_proxy.last_test_status = Some(format!("Failed (Invalid IP response, Latency: {}ms)", latency));
                }
            } else {
                let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let short_err = if err_msg.is_empty() { "Connection error".to_string() } else { err_msg };
                next_proxy.last_test_status = Some(format!("Failed ({})", short_err));
            }
        }
        Err(e) => {
            next_proxy.last_test_status = Some(format!("Failed to execute curl: {}", e));
        }
    }
    
    next_proxy.last_test_at = Some(chrono::Utc::now().to_rfc3339());
    let _ = save_proxy(next_proxy.clone(), state);
    Ok(next_proxy)
}

#[tauri::command]
fn clear_profile_data(
    profile_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let is_running = state.runner.children.lock().unwrap().contains_key(&profile_id);
    if is_running {
        return Err("Cannot clear browser cache/cookies while the profile is running".to_string());
    }
    
    let dir = state.profile_dir(&profile_id);
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    
    let event = LaunchEvent {
        profile_id,
        status: ProfileStatus::Stopped,
        message: "Profile browser cache, cookies, and local data cleared.".to_string(),
        cdp_url: None,
        at: Utc::now().to_rfc3339(),
    };
    record_event(&state, &event)?;
    let _ = app.emit("runner-log", &event);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    db_path: String,
    logs_path: String,
    profiles_path: String,
    runner_script_exists: bool,
    bundled_node_exists: bool,
    cached_chrome_exists: bool,
    cached_chrome_path: Option<String>,
}

#[tauri::command]
fn get_system_info(state: State<AppState>, app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let resource_dir = app.path().resource_dir().ok();
    
    let runner_root = find_existing_path(
        [
            exe_dir.as_ref().map(|path| path.join("runner")),
            resource_dir.as_ref().map(|path| path.join("runner")),
            Some(PathBuf::from("runner")),
        ]
        .into_iter()
        .flatten(),
    );
    
    let runner_script = find_existing_path(
        [
            runner_root.as_ref().map(|path| path.join("dist").join("index.js")),
            resource_dir.as_ref().map(|path| path.join("runner").join("dist").join("index.js")),
            resource_dir.as_ref().map(|path| path.join("dist").join("index.js")),
            Some(PathBuf::from("runner").join("dist").join("index.js")),
        ]
        .into_iter()
        .flatten(),
    );
    
    let bundled_node = find_existing_path(
        [
            runner_root.as_ref().map(|path| path.join("bin").join("node.exe")),
            resource_dir.as_ref().map(|path| path.join("runner").join("bin").join("node.exe")),
            resource_dir.as_ref().map(|path| path.join("bin").join("node.exe")),
        ]
        .into_iter()
        .flatten(),
    );

    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .ok();
        
    let cache_dir = std::env::var("CLOAKBROWSER_CACHE_DIR")
        .map(PathBuf::from)
        .ok()
        .or_else(|| home_dir.map(|h| h.join(".cloakbrowser")));
        
    let mut cached_chrome_path = None;
    let mut cached_chrome_exists = false;
    
    if let Some(ref cache_dir) = cache_dir {
        if cache_dir.exists() {
            if let Ok(entries) = fs::read_dir(cache_dir) {
                let mut candidates = Vec::new();
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if name.starts_with("chromium-") {
                            let chrome_exe = path.join("chrome.exe");
                            if chrome_exe.exists() {
                                candidates.push(chrome_exe);
                            }
                        }
                    }
                }
                if !candidates.is_empty() {
                    cached_chrome_path = Some(candidates[0].to_string_lossy().to_string());
                    cached_chrome_exists = true;
                }
            }
        }
    }

    Ok(SystemInfo {
        db_path: state.db_path.to_string_lossy().to_string(),
        logs_path: state.data_dir.join("logs").to_string_lossy().to_string(),
        profiles_path: state.profiles_dir.to_string_lossy().to_string(),
        runner_script_exists: runner_script.is_some(),
        bundled_node_exists: bundled_node.is_some(),
        cached_chrome_exists,
        cached_chrome_path,
    })
}

#[tauri::command]
fn clear_launch_events(state: State<AppState>) -> Result<(), String> {
    state
        .conn()?
        .execute("delete from launch_events", [])
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

fn system_proxy_config() -> ProxyConfig {
    ProxyConfig {
        id: SYSTEM_PROXY_ID.to_string(),
        name: "System proxy".to_string(),
        scheme: "system".to_string(),
        host: String::new(),
        port: 0,
        username: None,
        password: None,
        bypass: None,
        last_test_status: None,
        last_test_at: None,
    }
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
    record_event_to_db(&state.db_path, event)
}

fn record_event_to_db(db_path: &Path, event: &LaunchEvent) -> Result<(), String> {
    Connection::open(db_path)
        .map_err(|error| error.to_string())?
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
            open_profile_folder,
            test_proxy,
            clear_profile_data,
            get_system_info,
            clear_launch_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
