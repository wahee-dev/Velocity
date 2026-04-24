use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

mod ai;
mod pty;
pub use ai::{
    ai_prompt,
    ai_to_command,
    classify_terminal_input,
    predict_next_command,
    revert_agent_task,
    respond_agent_confirmation,
    start_agent_task,
    AgentManager,
};
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutocompleteIndex {
    pub cwd: String,
    pub generated_at: i64,
    pub entries: Vec<AutocompleteEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutocompleteEntry {
    pub value: String,
    pub kind: AutocompleteKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AutocompleteKind {
    Script,
    Alias,
    File,
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
// GROUP 3 — Terminal Execution (TerminalPane.tsx) — DEPRECATED
// These run non-interactive cmd /C via tokio. The real execution path is
// TerminalPane → classify_terminal_input → write_to_pty/start_agent_task.
// Nothing listens to the command-start/command-finish events these emit.
// Kept for backward compat only; will be removed in a future version.
// ===========================================================================

#[tauri::command]
#[deprecated = "Legacy non-interactive executor. Use PTY path via write_to_pty instead."]
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
#[deprecated = "Legacy command killer. Use kill_pty instead."]
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

/// Get available system commands by scanning PATH directories.
/// Results are cached after first call.
#[tauri::command]
fn get_system_commands() -> Result<Vec<String>, String> {
    use std::sync::{OnceLock, Mutex};

    static CACHE: OnceLock<Mutex<Option<Vec<String>>>> = OnceLock::new();

    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().map_err(|e| format!("Lock error: {}", e))?;

    if let Some(ref cmds) = *guard {
        return Ok(cmds.clone());
    }

    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut seen = HashSet::new();
    let mut cmds = Vec::new();

    // Platform-specific path separator and executable detection
    #[cfg(target_os = "windows")]
    let path_sep = ';';
    #[cfg(not(target_os = "windows"))]
    let path_sep = ':';

    let exts: &[&str] = if cfg!(target_os = "windows") {
        &[".exe", ".cmd", ".bat", ".com", ".ps1"]
    } else {
        &[]
    };

    for dir_str in path_var.split(path_sep) {
        let dir = Path::new(dir_str.trim());
        if !dir.is_dir() { continue; }

        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || name.contains(' ') { continue; }

                let is_executable = if cfg!(target_os = "windows") {
                    let lower = name.to_lowercase();
                    exts.iter().any(|e| lower.ends_with(e) || (!lower.contains('.') && lower.len() > 1))
                } else {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        entry.metadata()
                            .ok()
                            .map(|m| m.permissions().mode() & 0o111 != 0)
                            .unwrap_or(false)
                    }
                    #[cfg(not(unix))]
                    { true }
                };

                if is_executable && seen.insert(name.clone()) {
                    cmds.push(name);
                }
            }
        }
    }

    cmds.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    *guard = Some(cmds.clone());
    Ok(cmds)
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
// GROUP 9.5 — File Search
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
}

/// Recursively search for files by name in a directory.
#[tauri::command]
fn search_files(path: String, query: String) -> Result<Vec<SearchResult>, String> {
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    let base = std::path::Path::new(&path);

    if !base.exists() || !base.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    fn walk(dir: &std::path::Path, query_lower: &str, results: &mut Vec<SearchResult>) -> Result<(), String> {
        let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;

            if metadata.is_dir() {
                // Skip hidden dirs (like .git, node_modules) for performance
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
                walk(&entry.path(), query_lower, results)?;
            } else if name.to_lowercase().contains(query_lower) {
                results.push(SearchResult {
                    path: entry.path().to_string_lossy().to_string(),
                    name,
                });
            }

            // Limit results to prevent slowdown
            if results.len() >= 100 {
                break;
            }
        }
        Ok(())
    }

    walk(base, &query_lower, &mut results)?;
    Ok(results)
}

const MAX_AUTOCOMPLETE_DEPTH: usize = 3;
const MAX_AUTOCOMPLETE_FILE_ENTRIES: usize = 256;
const AUTOCOMPLETE_SKIP_DIRS: &[&str] = &[".git", ".idea", ".next", ".turbo", "dist", "node_modules", "target"];
const COMMON_SHELL_ALIASES: &[&str] = &[
    "cd",
    "cls",
    "clear",
    "dir",
    "gc",
    "gci",
    "grep",
    "la",
    "ll",
    "ls",
    "mkdir",
    "ni",
    "pwd",
    "rg",
    "sls",
    "touch",
    "type",
];

#[tauri::command]
fn build_autocomplete_index(path: String) -> Result<AutocompleteIndex, String> {
    let cwd = PathBuf::from(&path);
    if !cwd.exists() || !cwd.is_dir() {
        return Err(format!("Directory does not exist: {}", path));
    }

    let mut entries = Vec::new();
    let mut seen = HashSet::new();

    if let Some(package_json_path) = find_nearest_package_json(&cwd) {
        for value in read_package_script_commands(&package_json_path)? {
            push_autocomplete_entry(
                &mut entries,
                &mut seen,
                value,
                AutocompleteKind::Script,
            );
        }
    }

    for alias in COMMON_SHELL_ALIASES {
        push_autocomplete_entry(
            &mut entries,
            &mut seen,
            (*alias).to_string(),
            AutocompleteKind::Alias,
        );
    }

    collect_autocomplete_file_entries(
        &cwd,
        &cwd,
        0,
        &mut entries,
        &mut seen,
    )?;

    Ok(AutocompleteIndex {
        cwd: cwd.to_string_lossy().to_string(),
        generated_at: chrono::Utc::now().timestamp_millis(),
        entries,
    })
}

fn push_autocomplete_entry(
    entries: &mut Vec<AutocompleteEntry>,
    seen: &mut HashSet<String>,
    value: String,
    kind: AutocompleteKind,
) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }

    let dedupe_key = trimmed.to_lowercase();
    if !seen.insert(dedupe_key) {
        return;
    }

    entries.push(AutocompleteEntry {
        value: trimmed.to_string(),
        kind,
    });
}

fn find_nearest_package_json(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|dir| dir.join("package.json"))
        .find(|candidate| candidate.is_file())
}

fn read_package_script_commands(package_json_path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(package_json_path)
        .map_err(|e| format!("Failed to read {}: {}", package_json_path.display(), e))?;

    let package_json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", package_json_path.display(), e))?;

    let Some(scripts) = package_json
        .get("scripts")
        .and_then(|value| value.as_object()) else {
        return Ok(Vec::new());
    };

    let mut commands: Vec<String> = scripts
        .keys()
        .map(|name| format!("npm run {}", name))
        .collect();
    commands.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(commands)
}

fn collect_autocomplete_file_entries(
    base: &Path,
    dir: &Path,
    depth: usize,
    entries: &mut Vec<AutocompleteEntry>,
    seen: &mut HashSet<String>,
) -> Result<(), String> {
    if depth > MAX_AUTOCOMPLETE_DEPTH || entries.len() >= MAX_AUTOCOMPLETE_FILE_ENTRIES {
        return Ok(());
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    let mut children = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || AUTOCOMPLETE_SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        children.push((name, entry.path(), metadata.is_dir()));
    }

    children.sort_by(|a, b| match (a.2, b.2) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.to_lowercase().cmp(&b.0.to_lowercase()),
    });

    for (_, child_path, is_dir) in children {
        if entries.len() >= MAX_AUTOCOMPLETE_FILE_ENTRIES {
            break;
        }

        if let Ok(relative) = child_path.strip_prefix(base) {
            let display = relative.to_string_lossy().to_string();
            if !display.is_empty() {
                push_autocomplete_entry(
                    entries,
                    seen,
                    display,
                    AutocompleteKind::File,
                );
            }
        }

        if is_dir && depth < MAX_AUTOCOMPLETE_DEPTH {
            collect_autocomplete_file_entries(
                base,
                &child_path,
                depth + 1,
                entries,
                seen,
            )?;
        }
    }

    Ok(())
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

/// Get health/metrics for a specific PTY session
#[tauri::command]
fn get_session_metrics(
    session_id: &str,
    pty: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<pty::SessionMetrics, String> {
    let mgr = pty.lock().map_err(|e| e.to_string())?;
    mgr.get_session_metrics(session_id)
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

/// .env files compiled into the binary. Release exe works anywhere without
/// needing a separate .env on disk.
const EMBEDDED_ENV_ROOT: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../.env"));
const EMBEDDED_ENV_SRC_TAURI: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));

/// Parse an inline .env string and set any vars not already in the process env.
fn apply_embedded_env(env_text: &str) {
    for line in env_text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }

        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else { continue };

        let key = key.trim();
        if key.is_empty() { continue; }
        // Only set if not already present (disk .env takes priority)
        if std::env::var(key).is_err() {
            let parsed = value.trim().trim_matches('"').trim_matches('\'');
            unsafe { std::env::set_var(key, parsed); }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Load .env from every plausible location so GROQ_API_KEY is always available.
/// Priority: disk files first → embedded fallback last.
fn load_env() {
    // 1. CWD and its src-tauri sibling (dev mode: npx tauri dev runs from here)
    let _ = dotenvy::dotenv();
    if let Ok(cwd) = std::env::current_dir() {
        let _ = dotenvy::from_path(cwd.join("src-tauri").join(".env"));
        if cwd.file_name().is_some_and(|n| n == "src-tauri") {
            if let Some(parent) = cwd.parent() {
                let _ = dotenvy::from_path(parent.join(".env"));
            }
        }
    }

    // 2. Exe's own directory + project root siblings (release builds)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let _ = dotenvy::from_path(exe_dir.join(".env"));
            if let Some(root) = exe_dir.parent() {
                let _ = dotenvy::from_path(root.join("src-tauri").join(".env"));
                let _ = dotenvy::from_path(root.join(".env"));
            }
        }
    }

    // 3. Compile-time manifest dir (source tree)
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let p = std::path::PathBuf::from(&manifest);
        let _ = dotenvy::from_path(p.join(".env"));
        if let Some(parent) = p.parent() {
            let _ = dotenvy::from_path(parent.join(".env"));
        }
    }

    // 4. Embedded fallback — compiled into binary, always works for shared exes
    if std::env::var("GROQ_API_KEY").is_err() {
        apply_embedded_env(EMBEDDED_ENV_SRC_TAURI);
    }
    if std::env::var("GROQ_API_KEY").is_err() {
        apply_embedded_env(EMBEDDED_ENV_ROOT);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_mcp_bridge::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(PtyManager::new()))
        .manage(Arc::new(Mutex::new(AgentManager::new())))
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
            classify_terminal_input,
            predict_next_command,
            start_agent_task,
            revert_agent_task,
            respond_agent_confirmation,
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
            get_system_commands,
            get_git_status,
            search_files,
            build_autocomplete_index,
            // PTY multi-session manager
            spawn_pty,
            write_to_pty,
            resize_pty,
            kill_pty,
            list_ptys,
            get_session_metrics,
            // State sync (terminal <-> file tree)
            get_cwd,
            change_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
