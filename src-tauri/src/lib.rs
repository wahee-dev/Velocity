use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

mod pty;
pub use pty::PtyManager;

// ===========================================================================
// Shared structs — mirror TypeScript types in src/types/index.ts
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<SessionIcon>,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionIcon {
    Claude,
    Terminal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: FileType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_expanded: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlock {
    pub id: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    pub status: CommandStatus,
    #[serde(with = "chrono_ts")]
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandStatus {
    Input,
    Running,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: String,
    pub changes: u32,
}

mod chrono_ts {
    use chrono::{DateTime, Utc};
    use serde::{Deserializer, Serializer};

    pub fn serialize<S>(dt: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        s.serialize_str(&dt.to_rfc3339())
    }

    pub fn deserialize<'de, D>(d: D) -> Result<DateTime<Utc>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = <String as serde::Deserialize>::deserialize(d)?;
        DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(serde::de::Error::custom)
    }
}

// ===========================================================================
// Application state
// ===========================================================================

pub struct AppState {
    pub sessions: Vec<Session>,
    pub workspaces: HashMap<String, Workspace>,
    pub tabs: HashMap<String, Tab>,
    pub active_session_id: Option<String>,
    pub active_tab_id: Option<String>,
    pub command_history: Vec<CommandHistoryEntry>,
}

#[derive(Debug, Clone)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub folders: HashMap<String, Folder>,
}

#[derive(Debug, Clone)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone)]
pub struct Tab {
    pub id: String,
    pub workspace_id: String,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct CommandHistoryEntry {
    pub id: String,
    pub command: String,
    pub output: String,
    pub status: String,
    pub timestamp: i64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sessions: vec![],
            workspaces: HashMap::new(),
            tabs: HashMap::new(),
            active_session_id: None,
            active_tab_id: None,
            command_history: vec![],
        }
    }
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ===========================================================================
// GROUP 1 — Window Controls (TitleBar.tsx)
// ===========================================================================

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize()
    } else {
        window.maximize()
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// ===========================================================================
// GROUP 2 — Sessions (SessionsSidebar.tsx + TitleBar.tsx)
// ===========================================================================

#[tauri::command]
fn search_sessions(
    query: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Vec<Session>, String> {
    let st = state.lock().map_err(|e| e.to_string())?;
    Ok(st
        .sessions
        .iter()
        .filter(|s| {
            query.is_empty()
                || s.name.to_lowercase().contains(&query.to_lowercase())
                || s.path.to_lowercase().contains(&query.to_lowercase())
        })
        .cloned()
        .collect())
}

#[tauri::command]
fn create_session(state: tauri::State<'_, Mutex<AppState>>) -> Result<Session, String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let session = Session {
        id: new_id(),
        name: format!("New session {}", st.sessions.len() + 1),
        path: std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        icon: Some(SessionIcon::Terminal),
        is_active: false,
    };
    for s in &mut st.sessions {
        s.is_active = false;
    }
    let active = Session { is_active: true, ..session.clone() };
    st.sessions.push(active);
    st.active_session_id = Some(session.id.clone());
    Ok(session)
}

#[tauri::command]
fn switch_session(
    session_id: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<Session, String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let target = st
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .cloned()
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;
    for s in &mut st.sessions {
        s.is_active = s.id == session_id;
    }
    st.active_session_id = Some(session_id.to_string());
    Ok(target)
}

// ===========================================================================
// GROUP 3 — Terminal Execution (TerminalPane.tsx)
// ===========================================================================

#[tauri::command]
async fn execute_command(
    command: &str,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let entry_id = new_id();

    // Emit start signal for Warp-style block UI
    let _ = app.emit("command-start", serde_json::json!({
        "blockId": entry_id,
        "command": command,
    }));

    let output = tokio::process::Command::new("cmd")
        .args(["/C", command])
        .output()
        .await
        .map_err(|e| format!("Failed to execute: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let result = if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        format!("(stderr) {}", stderr)
    } else {
        "(no output)".into()
    };
    let status = if output.status.success() { "success" } else { "error" };

    // Emit finish signal for Warp-style block UI
    let _ = app.emit("command-finish", serde_json::json!({
        "blockId": entry_id,
        "command": command,
        "output": result,
        "status": status,
    }));

    {
        let mut st = state.lock().map_err(|e| e.to_string())?;
        st.command_history.push(CommandHistoryEntry {
            id: entry_id,
            command: command.to_string(),
            output: result.clone(),
            status: status.into(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        });
    }
    Ok(result)
}

#[tauri::command]
fn cancel_command(
    block_id: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    if mgr.has_session(block_id) {
        mgr.kill(block_id)?;
    }
    Ok(())
}

// ===========================================================================
// GROUP 4 — Workspace & Folder Management
// ===========================================================================

#[tauri::command]
fn create_workspace(
    name: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    st.workspaces.insert(
        id.clone(),
        Workspace {
            id: id.clone(),
            name: name.to_string(),
            folders: HashMap::new(),
        },
    );
    Ok(id)
}

#[tauri::command]
fn create_folder(
    workspace_id: &str,
    name: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let ws = st
        .workspaces
        .get_mut(workspace_id)
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;
    let id = new_id();
    ws.folders.insert(
        id.clone(),
        Folder {
            id: id.clone(),
            name: name.to_string(),
            workspace_id: workspace_id.to_string(),
        },
    );
    Ok(id)
}

#[tauri::command]
fn delete_folder(
    folder_id: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    let mut found = false;
    for ws in st.workspaces.values_mut() {
        if ws.folders.remove(folder_id).is_some() {
            found = true;
            break;
        }
    }
    if !found {
        return Err(format!("Folder '{}' not found", folder_id));
    }
    Ok(())
}

#[tauri::command]
fn rename_folder(
    folder_id: &str,
    new_name: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    for ws in st.workspaces.values_mut() {
        if let Some(f) = ws.folders.get_mut(folder_id) {
            f.name = new_name.to_string();
            return Ok(());
        }
    }
    Err(format!("Folder '{}' not found", folder_id))
}

// ===========================================================================
// GROUP 5 — Tab Management
// ===========================================================================

#[tauri::command]
fn open_tab(
    workspace_id: &str,
    state: tauri::State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    if !st.workspaces.contains_key(workspace_id) {
        return Err(format!("Workspace '{}' not found", workspace_id));
    }
    let id = new_id();
    st.tabs.insert(
        id.clone(),
        Tab {
            id: id.clone(),
            workspace_id: workspace_id.to_string(),
            is_active: true,
        },
    );
    st.active_tab_id = Some(id.clone());
    Ok(id)
}

#[tauri::command]
fn close_tab(tab_id: &str, state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    st.tabs
        .remove(tab_id)
        .ok_or_else(|| format!("Tab '{}' not found", tab_id))?;
    if st.active_tab_id.as_deref() == Some(tab_id) {
        st.active_tab_id = st.tabs.keys().next().cloned();
    }
    Ok(())
}

#[tauri::command]
fn switch_tab(tab_id: &str, state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    if !st.tabs.contains_key(tab_id) {
        return Err(format!("Tab '{}' not found", tab_id));
    }
    for tab in st.tabs.values_mut() {
        tab.is_active = tab.id == tab_id;
    }
    st.active_tab_id = Some(tab_id.to_string());
    Ok(())
}

// ===========================================================================
// GROUP 6 — AI Features
// ===========================================================================

#[tauri::command]
async fn ai_prompt(prompt: &str) -> Result<String, String> {
    Ok(format!("[AI Response] Received prompt: {}", prompt))
}

#[tauri::command]
async fn ai_to_command(natural_language: &str) -> Result<String, String> {
    Ok(format!(
        "# Suggested command for: {}\necho 'placeholder'",
        natural_language
    ))
}

// ===========================================================================
// GROUP 7 — Clipboard & Utilities
// ===========================================================================

#[tauri::command]
fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut ctx = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    ctx.set_text(text.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_history(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    st.command_history.clear();
    Ok(())
}

#[tauri::command]
fn open_settings() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn get_system_info() -> Result<HashMap<String, String>, String> {
    let mut info = HashMap::new();
    info.insert("os".into(), std::env::consts::OS.to_string());
    info.insert("arch".into(), std::env::consts::ARCH.to_string());
    info.insert(
        "current_dir".into(),
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
    );
    Ok(info)
}

// ===========================================================================
// GROUP 8 — Pane Controls
// ===========================================================================

#[tauri::command]
fn close_pane(state: tauri::State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut st = state.lock().map_err(|e| e.to_string())?;
    if let Some(tid) = st.active_tab_id.clone() {
        st.tabs.remove(&tid);
        st.active_tab_id = st.tabs.keys().next().cloned();
    }
    Ok(())
}

// ===========================================================================
// GROUP 9 — File Explorer (real filesystem)
// ===========================================================================

/// Read directory contents and return as a sorted FileNode list.
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FileNode>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata for {}: {}", name, e))?;

        nodes.push(FileNode {
            id: format!("{}-{}", path.replace(['\\', '/'], "_"), name),
            name,
            node_type: if metadata.is_dir() { FileType::Folder } else { FileType::File },
            children: None,
            is_expanded: None,
        });
    }

    // Sort: folders first, then files, both alphabetically case-insensitive
    nodes.sort_by(|a, b| {
        match (&a.node_type, &b.node_type) {
            (FileType::Folder, FileType::File) => std::cmp::Ordering::Less,
            (FileType::File, FileType::Folder) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(nodes)
}

/// Get git status (branch + changed file count) for a directory.
#[tauri::command]
fn get_git_status(path: Option<String>) -> Result<GitStatus, String> {
    let repo_path = path.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });

    let branch_output = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&repo_path)
        .output();

    let branch = match branch_output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => "main".to_string(),
    };

    let diff_output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&repo_path)
        .output();

    let changes = match diff_output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).lines().count() as u32,
        _ => 0,
    };

    Ok(GitStatus { branch, changes })
}

#[tauri::command]
fn open_file(path: &str, app: tauri::AppHandle) -> Result<(), String> {
    let resolved = if std::path::Path::new(path).is_absolute() {
        path.to_string()
    } else {
        match std::env::current_dir() {
            Ok(d) => d.join(path).to_string_lossy().to_string(),
            Err(_) => path.to_string(),
        }
    };
    app.opener()
        .open_path(&resolved, None::<&str>)
        .map_err(|e| e.to_string())
}

// ===========================================================================
// GROUP 10 — PTY Multi-Session Manager
// ===========================================================================

/// Spawn a new PTY for a terminal pane. Output streams via `pty://output` events.
#[tauri::command]
fn spawn_pty(
    pane_id: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
    app: tauri::AppHandle,
) -> Result<pty::PtySessionInfo, String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.spawn(pane_id.to_string(), app, 120, 36)
}

/// Write input (keystrokes / commands) to a specific PTY session
#[tauri::command]
fn write_to_pty(
    session_id: &str,
    data: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.write(session_id, data)
}

/// Resize a PTY session's terminal
#[tauri::command]
fn resize_pty(
    session_id: &str,
    cols: u16,
    rows: u16,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.resize(session_id, cols, rows)
}

/// Kill (terminate) a PTY session
#[tauri::command]
fn kill_pty(
    session_id: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.kill(session_id)
}

/// List all active PTY sessions
#[tauri::command]
fn list_ptys(pty: tauri::State<'_, Mutex<PtyManager>>) -> Result<Vec<pty::PtySessionInfo>, String> {
    let mgr = pty.lock().map_err(|e| e.to_string())?;
    Ok(mgr.list())
}

// ===========================================================================
// GROUP 11 — State Synchronization (Terminal <-> File Tree)
// ===========================================================================

/// Get the current working directory of a PTY session
#[tauri::command]
fn get_cwd(
    session_id: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<String, String> {
    let mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.get_cwd(session_id)
}

/// Change directory in the active PTY (called when user clicks folder in file tree).
/// Writes a cd command to the PTY and updates tracked CWD.
#[tauri::command]
fn change_directory(
    session_id: &str,
    path: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut mgr = pty.lock().map_err(|e| e.to_string())?;
    // Write cd command + enter to the PTY
    let cd_cmd = format!("cd {}\r\n", path);
    mgr.write(session_id, &cd_cmd)?;
    Ok(())
}

// ===========================================================================
// Builder — registers all commands + manages PTY and app state
// ===========================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            // Window controls
            minimize_window,
            maximize_window,
            close_window,
            // Sessions
            search_sessions,
            create_session,
            switch_session,
            // Terminal execution
            execute_command,
            cancel_command,
            // Workspace & folders
            create_workspace,
            create_folder,
            delete_folder,
            rename_folder,
            // Tabs
            open_tab,
            close_tab,
            switch_tab,
            // AI
            ai_prompt,
            ai_to_command,
            // Utilities
            copy_to_clipboard,
            clear_history,
            open_settings,
            get_system_info,
            // Pane
            close_pane,
            // File explorer
            open_file,
            read_dir,
            get_git_status,
            // PTY multi-session manager
            spawn_pty,
            write_to_pty,
            resize_pty,
            kill_pty,
            list_ptys,
            // State sync (terminal <-> file tree)
            get_cwd,
            change_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
