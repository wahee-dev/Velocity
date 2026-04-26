use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const GROQ_API_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL: &str = "llama-3.3-70b-versatile";
const GROQ_PREDICTION_MODEL: &str = "llama-3.1-8b-instant";
const GROQ_API_KEY_ENV: &str = "GROQ_API_KEY";
const MAX_AGENT_ITERATIONS: usize = 8;
const MAX_CONTEXT_DEPTH: usize = 4;
const MAX_CONTEXT_FILES: usize = 200;
const MAX_FILE_CHARS: usize = 12_000;
const MAX_TOOL_OUTPUT_CHARS: usize = 12_000;
const SKIP_DIRS: &[&str] = &[".git", ".idea", ".next", ".turbo", "dist", "node_modules", "target"];
const NATURAL_LANGUAGE_PREFIXES: &[&str] = &[
    "add ",
    "build me ",
    "create ",
    "debug ",
    "document ",
    "explain ",
    "fix ",
    "generate ",
    "implement ",
    "make ",
    "refactor ",
    "update ",
    "write ",
];
const SHELL_BUILTINS: &[&str] = &[
    "cat",
    "cd",
    "clear",
    "cls",
    "copy",
    "dir",
    "echo",
    "ls",
    "mkdir",
    "move",
    "ni",
    "pwd",
    "ren",
    "type",
];
const BLOCKED_COMMAND_PATTERNS: &[&str] = &[
    "del /f",
    "format ",
    "git checkout --",
    "git clean -fd",
    "git reset --hard",
    "mkfs",
    "remove-item",
    "rm -rf",
    "rmdir /s",
    "shutdown",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputIntent {
    pub kind: InputIntentKind,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputIntentKind {
    Shell,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskSnapshot {
    pub id: String,
    pub session_id: String,
    pub prompt: String,
    pub status: AgentTaskStatus,
    pub started_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<AgentTaskStep>,
    pub changes: Vec<AgentFileChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_tool: Option<String>,
    pub can_undo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentTaskStatus {
    Running,
    Completed,
    Error,
    Reverted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskStep {
    pub id: String,
    pub kind: AgentStepKind,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub status: AgentStepStatus,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStepKind {
    Thinking,
    ReadFile,
    WriteFile,
    ExecuteCommand,
    Complete,
    Revert,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStepStatus {
    Running,
    Completed,
    Error,
    AwaitingConfirmation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFileChange {
    pub path: String,
    pub kind: AgentFileChangeKind,
    pub summary: String,
    pub added_lines: usize,
    pub removed_lines: usize,
    pub reverted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentFileChangeKind {
    Created,
    Modified,
}

#[derive(Debug, Clone)]
struct FileBackupRecord {
    actual_path: PathBuf,
    display_path: String,
    original_exists: bool,
    backup_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct AgentTaskRecord {
    snapshot: AgentTaskSnapshot,
    root_cwd: PathBuf,
    backup_dir: PathBuf,
    file_backups: HashMap<String, FileBackupRecord>,
}

pub struct AgentManager {
    client: reqwest::Client,
    tasks: HashMap<String, AgentTaskRecord>,
    backups_root: PathBuf,
    pending_confirmations: HashMap<String, tokio::sync::oneshot::Sender<bool>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceContext {
    cwd: String,
    package_scripts: Vec<String>,
    files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct GroqChatRequest {
    model: &'static str,
    temperature: f32,
    messages: Vec<GroqChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GroqChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct GroqChatResponse {
    choices: Vec<GroqChoice>,
}

#[derive(Debug, Deserialize)]
struct GroqChoice {
    message: GroqChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct GroqChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawAgentReply {
    #[serde(rename = "type")]
    kind: String,
    tool: Option<String>,
    args: Option<serde_json::Value>,
    message: Option<String>,
    summary: Option<String>,
    reason: Option<String>,
}

#[derive(Debug)]
enum AgentReply {
    ToolCall(AgentToolCall),
    Final { message: String },
}

#[derive(Debug)]
enum AgentToolCall {
    ReadFile { path: String, reason: Option<String> },
    WriteFile { path: String, content: String, reason: Option<String> },
    ExecuteCommand { command: String, reason: Option<String> },
}

impl AgentManager {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
            .expect("failed to build reqwest client");
        let backups_root = std::env::temp_dir().join("velocity-agent-backups");
        let _ = std::fs::create_dir_all(&backups_root);

        Self {
            client,
            tasks: HashMap::new(),
            backups_root,
            pending_confirmations: HashMap::new(),
        }
    }

    fn create_task(
        &mut self,
        session_id: String,
        prompt: String,
        cwd: PathBuf,
    ) -> Result<AgentTaskSnapshot, String> {
        let root_cwd = cwd
            .canonicalize()
            .map_err(|e| format!("Failed to resolve working directory: {}", e))?;
        let started_at = now_millis();
        let task_id = uuid::Uuid::new_v4().to_string();
        let backup_dir = self.backups_root.join(&task_id);
        std::fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to prepare backup directory: {}", e))?;

        let snapshot = AgentTaskSnapshot {
            id: task_id.clone(),
            session_id,
            prompt: prompt.trim().to_string(),
            status: AgentTaskStatus::Running,
            started_at,
            updated_at: started_at,
            summary: Some("Connecting to Groq".to_string()),
            error: None,
            steps: vec![AgentTaskStep {
                id: uuid::Uuid::new_v4().to_string(),
                kind: AgentStepKind::Thinking,
                label: "Thinking through the request".to_string(),
                detail: Some("Preparing workspace context".to_string()),
                status: AgentStepStatus::Running,
                timestamp: started_at,
            }],
            changes: Vec::new(),
            last_tool: None,
            can_undo: false,
        };

        self.tasks.insert(
            task_id,
            AgentTaskRecord {
                snapshot: snapshot.clone(),
                root_cwd,
                backup_dir,
                file_backups: HashMap::new(),
            },
        );

        Ok(snapshot)
    }
}

#[tauri::command]
pub fn classify_terminal_input(input: String, cwd: String) -> Result<InputIntent, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(InputIntent {
            kind: InputIntentKind::Shell,
            reason: "Empty input".to_string(),
        });
    }

    let lower = trimmed.to_lowercase();
    if trimmed.starts_with("/agent ") || trimmed == "/agent" {
        return Ok(InputIntent {
            kind: InputIntentKind::Agent,
            reason: "Explicit /agent prefix".to_string(),
        });
    }

    if trimmed.contains('\n') || trimmed.ends_with('?') {
        return Ok(InputIntent {
            kind: InputIntentKind::Agent,
            reason: "Looks like a natural-language request".to_string(),
        });
    }

    if NATURAL_LANGUAGE_PREFIXES
        .iter()
        .any(|prefix| lower.starts_with(prefix))
    {
        return Ok(InputIntent {
            kind: InputIntentKind::Agent,
            reason: "Starts like a coding request".to_string(),
        });
    }

    if has_shell_operator(trimmed) {
        return Ok(InputIntent {
            kind: InputIntentKind::Shell,
            reason: "Contains shell operators".to_string(),
        });
    }

    let first_token = trimmed.split_whitespace().next().unwrap_or_default();
    if first_token.is_empty() {
        return Ok(InputIntent {
            kind: InputIntentKind::Shell,
            reason: "No command token found".to_string(),
        });
    }

    if SHELL_BUILTINS
        .iter()
        .any(|builtin| builtin.eq_ignore_ascii_case(first_token))
    {
        return Ok(InputIntent {
            kind: InputIntentKind::Shell,
            reason: "Matches a shell builtin".to_string(),
        });
    }

    let cwd_path = PathBuf::from(&cwd);
    if looks_like_executable_path(first_token, &cwd_path) || is_executable_on_path(first_token) {
        return Ok(InputIntent {
            kind: InputIntentKind::Shell,
            reason: "Resolvable executable or script".to_string(),
        });
    }

    if trimmed.split_whitespace().count() > 1 {
        return Ok(InputIntent {
            kind: InputIntentKind::Agent,
            reason: "First token is not a known command".to_string(),
        });
    }

    Ok(InputIntent {
        kind: InputIntentKind::Agent,
        reason: "Single token does not resolve to a command".to_string(),
    })
}

#[tauri::command]
pub async fn start_agent_task(
    session_id: String,
    prompt: String,
    cwd: String,
    app: AppHandle,
    agent_state: tauri::State<'_, Arc<Mutex<AgentManager>>>,
) -> Result<AgentTaskSnapshot, String> {
    if prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }

    let snapshot = {
        let mut guard = agent_state.lock().map_err(|e| e.to_string())?;
        guard.create_task(session_id, prompt, PathBuf::from(cwd))?
    };

    emit_task_update(&app, &snapshot);

    let manager = agent_state.inner().clone();
    let manager_for_run = manager.clone();
    let task_id = snapshot.id.clone();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_agent_task(manager_for_run, app_handle.clone(), &task_id).await {
            let _ = fail_task(&manager, &app_handle, &task_id, error);
        }
    });

    Ok(snapshot)
}

#[tauri::command]
pub fn revert_agent_task(
    task_id: String,
    app: AppHandle,
    agent_state: tauri::State<'_, Arc<Mutex<AgentManager>>>,
) -> Result<AgentTaskSnapshot, String> {
    let snapshot = {
        let mut guard = agent_state.lock().map_err(|e| e.to_string())?;
        let record = guard
            .tasks
            .get_mut(&task_id)
            .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;

        if matches!(record.snapshot.status, AgentTaskStatus::Running) {
            return Err("Cannot undo a task while it is still running".to_string());
        }

        for backup in record.file_backups.values() {
            if backup.original_exists {
                let backup_path = backup
                    .backup_path
                    .as_ref()
                    .ok_or_else(|| format!("Missing backup for {}", backup.display_path))?;
                if let Some(parent) = backup.actual_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to recreate {}: {}", parent.display(), e))?;
                }
                std::fs::copy(backup_path, &backup.actual_path).map_err(|e| {
                    format!(
                        "Failed to restore {} from backup: {}",
                        backup.display_path, e
                    )
                })?;
            } else if backup.actual_path.exists() {
                std::fs::remove_file(&backup.actual_path)
                    .map_err(|e| format!("Failed to remove {}: {}", backup.display_path, e))?;
            }
        }

        for change in &mut record.snapshot.changes {
            change.reverted = true;
        }

        record.snapshot.status = AgentTaskStatus::Reverted;
        record.snapshot.summary = Some("Restored the previous file state".to_string());
        record.snapshot.error = None;
        record.snapshot.last_tool = None;
        record.snapshot.can_undo = false;
        record.snapshot.steps.push(AgentTaskStep {
            id: uuid::Uuid::new_v4().to_string(),
            kind: AgentStepKind::Revert,
            label: "Undid agent file changes".to_string(),
            detail: Some("Recovered backup copies from the temp directory".to_string()),
            status: AgentStepStatus::Completed,
            timestamp: now_millis(),
        });
        record.snapshot.updated_at = now_millis();
        record.snapshot.clone()
    };

    emit_task_update(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn respond_agent_confirmation(
    task_id: String,
    allowed: bool,
    agent_state: tauri::State<'_, Arc<Mutex<AgentManager>>>,
) -> Result<(), String> {
    let mut guard = agent_state.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = guard.pending_confirmations.remove(&task_id) {
        let _ = tx.send(allowed);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfirmationRequest {
    pub task_id: String,
    pub command: String,
    pub reason: String,
}

#[tauri::command]
pub async fn predict_inline_completion(
    command_context: String,
    partial_input: String,
    query: String,
) -> Result<String, String> {
    let api_key = groq_api_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {}", e))?;

    let system_prompt = format!(
        "You are a terminal autocomplete engine. The user is typing the command '{}'. \
        Suggest only the single most likely subcommand, flag, or argument to complete '{}'. \
        Output only the completion text. No prose. No markdown. If you cannot suggest a high-confidence completion, return an empty string.",
        command_context, query
    );

    let user_content = format!("Input: {} | Query: {}", partial_input, query);

    let messages = vec![
        GroqChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        GroqChatMessage {
            role: "user".to_string(),
            content: user_content,
        },
    ];

    let request = GroqChatRequest {
        model: GROQ_PREDICTION_MODEL,
        temperature: 0.1,
        messages,
    };

    let response = client
        .post(GROQ_API_URL)
        .bearer_auth(&api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Groq: {}", e))?;

    let parsed: GroqChatResponse = response.json().await.map_err(|e| e.to_string())?;
    
    Ok(parsed.choices.into_iter().next()
        .and_then(|c| c.message.content)
        .map(|c| c.trim().trim_matches('`').to_string())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_prompt(prompt: String) -> Result<String, String> {
    let response = run_simple_completion(
        "You are Velocity Agent. Respond like a concise coding assistant.",
        prompt.as_str(),
    )
    .await?;
    Ok(response.trim().to_string())
}

#[tauri::command]
pub async fn ai_to_command(natural_language: String) -> Result<String, String> {
    let system_prompt = "You are Velocity Agent. Convert the request into a single Windows shell command. Return only the command text with no markdown, explanation, or backticks.";
    let response = run_simple_completion(system_prompt, natural_language.as_str()).await?;
    Ok(response.trim().to_string())
}

#[tauri::command]
pub async fn predict_next_command(
    history: Vec<String>,
    cwd: String,
) -> Result<String, String> {
    let api_key = groq_api_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {}", e))?;

    // Gather file snapshot in Rust to save an RTT
    let ls_snapshot = match std::fs::read_dir(&cwd) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .take(10)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", "),
        Err(_) => String::new(),
    };

    let user_content = format!(
        "Files: {} | CWD: {} | History: {} | Suggest next command:",
        ls_snapshot,
        cwd,
        history.join(", "),
    );

    let messages = vec![
        GroqChatMessage {
            role: "system".to_string(),
            content: "You are a terminal autocomplete engine. Suggest only the single most likely next shell command based on history and files. Output only the command. No prose. No markdown.".to_string(),
        },
        GroqChatMessage {
            role: "user".to_string(),
            content: user_content,
        },
    ];

    let request = GroqChatRequest {
        model: GROQ_PREDICTION_MODEL,
        temperature: 0.1,
        messages,
    };

    let response = client
        .post(GROQ_API_URL)
        .bearer_auth(&api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Groq: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Groq response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Groq returned {}: {}", status, body));
    }

    let parsed: GroqChatResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .map(|content| {
            // Strip common wrappers (backticks, quotes, $ prefix)
            content
                .trim()
                .trim_start_matches("```")
                .trim_start_matches('`')
                .trim_start_matches('$')
                .trim_start_matches(' ')
                .trim_end_matches("```")
                .trim_end_matches('`')
                .trim()
                .to_string()
        })
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Groq did not return any content".to_string())
}

const COMPILE_TIME_GROQ_KEY: Option<&'static str> = option_env!("GROQ_API_KEY");

fn groq_api_key() -> Result<String, String> {
    // 1. Check runtime environment variable (overrides baked-in key)
    if let Ok(value) = std::env::var(GROQ_API_KEY_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    // 2. Check compile-time baked key (from GitHub Secrets/Build env)
    if let Some(key) = COMPILE_TIME_GROQ_KEY {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    // 3. Check .env files (for local development)
    for candidate in dotenv_candidates() {
        if let Some(value) = read_dotenv_var(&candidate, GROQ_API_KEY_ENV)? {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    Err("GROQ_API_KEY is not set. It must be provided at compile-time via environment variable, or at runtime via .env file.".to_string())
}

fn dotenv_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // Current working directory
    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join(".env"));
        candidates.push(current_dir.join("src-tauri").join(".env"));

        if current_dir.file_name().is_some_and(|name| name == "src-tauri") {
            if let Some(parent) = current_dir.parent() {
                candidates.push(parent.join(".env"));
            }
        }
    }

    // Executable's directory (works for release builds)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(".env"));
            // exe is in target/debug/release, so check src-tauri sibling
            if let Some(project_root) = exe_dir.parent() {
                candidates.push(project_root.join("src-tauri").join(".env"));
                candidates.push(project_root.join(".env"));
            }
        }
    }

    // Compile-time known project root
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(&manifest);
        candidates.push(manifest_path.join(".env"));
        if let Some(parent) = manifest_path.parent() {
            candidates.push(parent.join(".env"));
        }
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

fn read_dotenv_var(path: &Path, key: &str) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };

        if name.trim() != key {
            continue;
        }

        let parsed = value.trim().trim_matches('"').trim_matches('\'').to_string();
        return Ok(Some(parsed));
    }

    Ok(None)
}

async fn run_agent_task(
    manager: Arc<Mutex<AgentManager>>,
    app: AppHandle,
    task_id: &str,
) -> Result<(), String> {
    let api_key = groq_api_key()?;

    let (client, prompt, cwd) = {
        let guard = manager.lock().map_err(|e| e.to_string())?;
        let record = guard
            .tasks
            .get(task_id)
            .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;
        (
            guard.client.clone(),
            record.snapshot.prompt.clone(),
            record.root_cwd.clone(),
        )
    };

    let context = build_workspace_context(&cwd)?;
    let context_json = serde_json::to_string_pretty(&context)
        .map_err(|e| format!("Failed to serialize workspace context: {}", e))?;

    let mut messages = vec![
        GroqChatMessage {
            role: "system".to_string(),
            content: velocity_agent_system_prompt(),
        },
        GroqChatMessage {
            role: "user".to_string(),
            content: format!(
                "Working directory: {}\nUser request: {}\nWorkspace context:\n{}",
                cwd.display(),
                prompt,
                context_json
            ),
        },
    ];

    for _ in 0..MAX_AGENT_ITERATIONS {
        let response_text = groq_chat_completion(&client, &api_key, messages.clone()).await?;
        messages.push(GroqChatMessage {
            role: "assistant".to_string(),
            content: response_text.clone(),
        });

        match parse_agent_reply(&response_text) {
            Ok(AgentReply::ToolCall(tool_call)) => {
                let (label, detail, last_tool) = tool_metadata(&tool_call);

                update_task(&manager, task_id, &app, |record| {
                    finish_running_step(record, AgentStepStatus::Completed, None);
                    record.snapshot.last_tool = Some(last_tool.to_string());
                    record.snapshot.summary = Some(label.to_string());
                    record.snapshot.steps.push(AgentTaskStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        kind: tool_step_kind(&tool_call),
                        label: label.to_string(),
                        detail,
                        status: AgentStepStatus::Running,
                        timestamp: now_millis(),
                    });
                    Ok(())
                })?;

                let tool_result = execute_tool_call(&manager, &app, task_id, &tool_call).await?;
                messages.push(GroqChatMessage {
                    role: "user".to_string(),
                    content: format!(
                        "Tool result for {}:\n{}",
                        last_tool,
                        truncate_chars(&tool_result, MAX_TOOL_OUTPUT_CHARS)
                    ),
                });

                update_task(&manager, task_id, &app, |record| {
                    finish_running_step(record, AgentStepStatus::Completed, None);
                    record.snapshot.steps.push(AgentTaskStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        kind: AgentStepKind::Thinking,
                        label: "Thinking through the next step".to_string(),
                        detail: Some("Reviewing the latest tool result".to_string()),
                        status: AgentStepStatus::Running,
                        timestamp: now_millis(),
                    });
                    record.snapshot.summary = Some("Reviewing tool results".to_string());
                    Ok(())
                })?;
            }
            Ok(AgentReply::Final { message }) => {
                update_task(&manager, task_id, &app, |record| {
                    finish_running_step(record, AgentStepStatus::Completed, None);
                    record.snapshot.status = AgentTaskStatus::Completed;
                    record.snapshot.summary = Some(message.clone());
                    record.snapshot.error = None;
                    record.snapshot.last_tool = None;
                    record.snapshot.can_undo = !record.snapshot.changes.is_empty();
                    record.snapshot.steps.push(AgentTaskStep {
                        id: uuid::Uuid::new_v4().to_string(),
                        kind: AgentStepKind::Complete,
                        label: "Completed agent task".to_string(),
                        detail: Some(message.clone()),
                        status: AgentStepStatus::Completed,
                        timestamp: now_millis(),
                    });
                    Ok(())
                })?;
                return Ok(());
            }
            Err(parse_error) => {
                messages.push(GroqChatMessage {
                    role: "user".to_string(),
                    content: format!(
                        "Your previous response could not be parsed: {}. Return only valid JSON using the documented schema.",
                        parse_error
                    ),
                });

                update_task(&manager, task_id, &app, |record| {
                    record.snapshot.summary = Some("Retrying after invalid model output".to_string());
                    if let Some(step) = record
                        .snapshot
                        .steps
                        .iter_mut()
                        .rev()
                        .find(|step| matches!(step.status, AgentStepStatus::Running))
                    {
                        step.detail = Some("Model output was invalid JSON; retrying".to_string());
                    }
                    Ok(())
                })?;
            }
        }
    }

    Err("The agent hit its step limit before returning a final answer".to_string())
}

async fn execute_tool_call(
    manager: &Arc<Mutex<AgentManager>>,
    app: &AppHandle,
    task_id: &str,
    tool_call: &AgentToolCall,
) -> Result<String, String> {
    match tool_call {
        AgentToolCall::ReadFile { path, .. } => {
            let (root_cwd, resolved_path) = get_task_root_and_path(manager, task_id, path)?;
            let content = std::fs::read_to_string(&resolved_path)
                .map_err(|e| format!("Failed to read {}: {}", resolved_path.display(), e))?;
            let display_path = display_path(&root_cwd, &resolved_path);
            update_task(manager, task_id, app, |record| {
                record.snapshot.summary = Some(format!("Read {}", display_path));
                Ok(())
            })?;
            Ok(format!(
                "path: {}\ncontent:\n{}",
                display_path,
                truncate_chars(&content, MAX_FILE_CHARS)
            ))
        }
        AgentToolCall::WriteFile { path, content, .. } => {
            let summary = write_agent_file(manager, task_id, path, content)?;
            update_task(manager, task_id, app, |record| {
                record.snapshot.summary = Some(summary.clone());
                Ok(())
            })?;
            Ok(summary)
        }
        AgentToolCall::ExecuteCommand { command, .. } => {
            // Check if command is risky and needs user confirmation
            if let Some(reason) = is_risky_command(command) {
                let confirm_id = format!("confirm-{}-{}", task_id, now_millis());

                // Update step status to awaiting_confirmation
                update_task(manager, task_id, app, |record| {
                    if let Some(step) = record.snapshot.steps.iter_mut().rev()
                        .find(|s| matches!(s.status, AgentStepStatus::Running))
                    {
                        step.status = AgentStepStatus::AwaitingConfirmation;
                        step.detail = Some(format!("Awaiting confirmation: {}", reason));
                    }
                    Ok(())
                })?;

                // Emit confirmation request to frontend
                let _ = app.emit("agent://confirm", AgentConfirmationRequest {
                    task_id: confirm_id.clone(),
                    command: command.clone(),
                    reason,
                });

                // Create oneshot channel and wait for frontend response
                let (tx, rx) = tokio::sync::oneshot::channel();
                {
                    let mut guard = manager.lock().map_err(|e| e.to_string())?;
                    guard.pending_confirmations.insert(confirm_id.clone(), tx);
                }

                let allowed = rx.await.map_err(|e| format!("Confirmation channel closed: {}", e))?;

                // Update step back to running or mark as skipped
                if !allowed {
                    update_task(manager, task_id, app, |record| {
                        finish_running_step(record, AgentStepStatus::Completed, None);
                        Ok(())
                    })?;
                    return Ok("Command skipped by user.".to_string());
                }

                // User approved — proceed with execution
                update_task(manager, task_id, app, |record| {
                    if let Some(step) = record.snapshot.steps.iter_mut().rev()
                        .find(|s| matches!(s.status, AgentStepStatus::AwaitingConfirmation))
                    {
                        step.status = AgentStepStatus::Running;
                        step.detail = None;
                    }
                    Ok(())
                })?;
            } else {
                validate_agent_command(command)?;
            }

            let cwd = {
                let guard = manager.lock().map_err(|e| e.to_string())?;
                let record = guard
                    .tasks
                    .get(task_id)
                    .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;
                record.root_cwd.clone()
            };
            let output = run_shell_command(&cwd, command).await?;
            update_task(manager, task_id, app, |record| {
                record.snapshot.summary = Some(format!("Executed {}", command));
                Ok(())
            })?;
            Ok(output)
        }
    }
}

fn write_agent_file(
    manager: &Arc<Mutex<AgentManager>>,
    task_id: &str,
    requested_path: &str,
    content: &str,
) -> Result<String, String> {
    let mut guard = manager.lock().map_err(|e| e.to_string())?;
    let record = guard
        .tasks
        .get_mut(task_id)
        .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;

    let resolved_path = resolve_task_path(&record.root_cwd, requested_path)?;
    let file_key = resolved_path.to_string_lossy().to_string();

    let backup_record = if let Some(existing) = record.file_backups.get(&file_key) {
        existing.clone()
    } else {
        let display = display_path(&record.root_cwd, &resolved_path);
        let original_exists = resolved_path.exists();
        let backup_path = if original_exists {
            std::fs::create_dir_all(&record.backup_dir)
                .map_err(|e| format!("Failed to prepare backup directory: {}", e))?;
            let backup_path = record
                .backup_dir
                .join(format!("{}.bak", uuid::Uuid::new_v4().simple()));
            std::fs::copy(&resolved_path, &backup_path).map_err(|e| {
                format!("Failed to create a backup for {}: {}", display, e)
            })?;
            Some(backup_path)
        } else {
            None
        };

        let created = FileBackupRecord {
            actual_path: resolved_path.clone(),
            display_path: display,
            original_exists,
            backup_path,
        };
        record
            .file_backups
            .insert(file_key.clone(), created.clone());
        created
    };

    if let Some(parent) = resolved_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }

    std::fs::write(&resolved_path, content)
        .map_err(|e| format!("Failed to write {}: {}", resolved_path.display(), e))?;

    let original_content = if backup_record.original_exists {
        let backup_path = backup_record
            .backup_path
            .as_ref()
            .ok_or_else(|| format!("Missing backup for {}", backup_record.display_path))?;
        std::fs::read_to_string(backup_path)
            .map_err(|e| format!("Failed to read backup for {}: {}", backup_record.display_path, e))?
    } else {
        String::new()
    };

    let (added_lines, removed_lines) = summarize_line_delta(&original_content, content);
    let diff = compute_unified_diff(&backup_record.display_path, &original_content, content);
    let change_kind = if backup_record.original_exists {
        AgentFileChangeKind::Modified
    } else {
        AgentFileChangeKind::Created
    };
    let summary = format!(
        "{} {} (+{} -{})",
        match change_kind {
            AgentFileChangeKind::Created => "Created",
            AgentFileChangeKind::Modified => "Updated",
        },
        backup_record.display_path,
        added_lines,
        removed_lines
    );

    if let Some(change) = record
        .snapshot
        .changes
        .iter_mut()
        .find(|change| change.path == backup_record.display_path.as_str())
    {
        change.kind = change_kind.clone();
        change.summary = summary.clone();
        change.added_lines = added_lines;
        change.removed_lines = removed_lines;
        change.reverted = false;
        change.diff = Some(diff.clone());
    } else {
        record.snapshot.changes.push(AgentFileChange {
            path: backup_record.display_path.clone(),
            kind: change_kind,
            summary: summary.clone(),
            added_lines,
            removed_lines,
            reverted: false,
            diff: Some(diff),
        });
    }

    record.snapshot.updated_at = now_millis();
    record.snapshot.can_undo = true;
    Ok(summary)
}

fn get_task_root_and_path(
    manager: &Arc<Mutex<AgentManager>>,
    task_id: &str,
    requested_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let guard = manager.lock().map_err(|e| e.to_string())?;
    let record = guard
        .tasks
        .get(task_id)
        .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;
    let root = record.root_cwd.clone();
    let resolved = resolve_task_path(&root, requested_path)?;
    Ok((root, resolved))
}

fn update_task<F>(
    manager: &Arc<Mutex<AgentManager>>,
    task_id: &str,
    app: &AppHandle,
    update: F,
) -> Result<(), String>
where
    F: FnOnce(&mut AgentTaskRecord) -> Result<(), String>,
{
    let snapshot = {
        let mut guard = manager.lock().map_err(|e| e.to_string())?;
        let record = guard
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| format!("Agent task '{}' not found", task_id))?;
        update(record)?;
        record.snapshot.updated_at = now_millis();
        record.snapshot.clone()
    };

    emit_task_update(app, &snapshot);
    Ok(())
}

fn fail_task(
    manager: &Arc<Mutex<AgentManager>>,
    app: &AppHandle,
    task_id: &str,
    error: String,
) -> Result<(), String> {
    update_task(manager, task_id, app, |record| {
        finish_running_step(record, AgentStepStatus::Error, Some(error.clone()));
        record.snapshot.status = AgentTaskStatus::Error;
        record.snapshot.summary = Some("Agent task failed".to_string());
        record.snapshot.error = Some(error.clone());
        record.snapshot.last_tool = None;
        record.snapshot.can_undo = !record.snapshot.changes.is_empty();
        Ok(())
    })
}

fn finish_running_step(
    record: &mut AgentTaskRecord,
    status: AgentStepStatus,
    detail: Option<String>,
) {
    if let Some(step) = record
        .snapshot
        .steps
        .iter_mut()
        .rev()
        .find(|step| matches!(step.status, AgentStepStatus::Running))
    {
        step.status = status;
        if detail.is_some() {
            step.detail = detail;
        }
    }
}

fn build_workspace_context(root: &Path) -> Result<WorkspaceContext, String> {
    let mut seen_count = 0usize;
    let files = collect_workspace_files(root, 0, &mut seen_count)?;
    let package_scripts = if let Some(package_json) = find_nearest_package_json(root) {
        read_package_scripts(&package_json)?
    } else {
        Vec::new()
    };

    Ok(WorkspaceContext {
        cwd: root.to_string_lossy().to_string(),
        package_scripts,
        files,
    })
}

fn collect_workspace_files(
    dir: &Path,
    depth: usize,
    seen_count: &mut usize,
) -> Result<Vec<String>, String> {
    if depth > MAX_CONTEXT_DEPTH || *seen_count >= MAX_CONTEXT_FILES {
        return Ok(Vec::new());
    }

    let root = dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {}: {}", dir.display(), e))?;
    let mut results = Vec::new();
    collect_workspace_files_inner(&root, &root, depth, seen_count, &mut results)?;
    Ok(results)
}

fn collect_workspace_files_inner(
    root: &Path,
    dir: &Path,
    depth: usize,
    seen_count: &mut usize,
    results: &mut Vec<String>,
) -> Result<(), String> {
    if depth > MAX_CONTEXT_DEPTH || *seen_count >= MAX_CONTEXT_FILES {
        return Ok(());
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    let mut children = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let is_dir = match entry.file_type() {
            Ok(file_type) => file_type.is_dir(),
            Err(_) => false,
        };
        children.push((name, path, is_dir));
    }

    children.sort_by(|a, b| match (a.2, b.2) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.to_lowercase().cmp(&b.0.to_lowercase()),
    });

    for (_, path, is_dir) in children {
        if *seen_count >= MAX_CONTEXT_FILES {
            break;
        }

        if is_dir {
            collect_workspace_files_inner(root, &path, depth + 1, seen_count, results)?;
            continue;
        }

        if let Ok(relative) = path.strip_prefix(root) {
            results.push(relative.to_string_lossy().replace('\\', "/"));
            *seen_count += 1;
        }
    }

    Ok(())
}

fn find_nearest_package_json(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .map(|dir| dir.join("package.json"))
        .find(|candidate| candidate.is_file())
}

fn read_package_scripts(package_json_path: &Path) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(package_json_path)
        .map_err(|e| format!("Failed to read {}: {}", package_json_path.display(), e))?;
    let package_json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", package_json_path.display(), e))?;

    let Some(scripts) = package_json.get("scripts").and_then(|value| value.as_object()) else {
        return Ok(Vec::new());
    };

    let mut names: Vec<String> = scripts.keys().cloned().collect();
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(names)
}

fn resolve_task_path(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(requested_path);
    let combined = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };

    let root_canonical = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {}: {}", root.display(), e))?;
    let target_canonical = canonicalize_with_missing_tail(&combined)?;

    if !target_canonical.starts_with(&root_canonical) {
        return Err(format!(
            "Refusing to access '{}' outside '{}'",
            combined.display(),
            root.display()
        ));
    }

    Ok(target_canonical)
}

fn canonicalize_with_missing_tail(path: &Path) -> Result<PathBuf, String> {
    let mut missing_segments = Vec::new();
    let mut cursor = path;

    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            return Err(format!("Could not resolve {}", path.display()));
        };
        missing_segments.push(name.to_os_string());
        cursor = cursor
            .parent()
            .ok_or_else(|| format!("Could not resolve {}", path.display()))?;
    }

    let mut canonical = cursor
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {}: {}", cursor.display(), e))?;
    for segment in missing_segments.iter().rev() {
        canonical.push(segment);
    }
    Ok(canonical)
}

fn display_path(root: &Path, target: &Path) -> String {
    target
        .strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| target.to_string_lossy().replace('\\', "/"))
}

fn compute_unified_diff(file_path: &str, old_content: &str, new_content: &str) -> String {
    let old_lines: Vec<&str> = old_content.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();

    // Compute LCS-based diff
    let mut result = String::new();
    result.push_str(&format!("--- a{}\n", file_path));
    result.push_str(&format!("+++ b{}\n", file_path));

    // Simple line-by-line diff using prefix/suffix matching (same as summarize_line_delta)
    let mut prefix = 0usize;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }

    let mut old_suffix = old_lines.len();
    let mut new_suffix = new_lines.len();
    while old_suffix > prefix
        && new_suffix > prefix
        && old_lines[old_suffix - 1] == new_lines[new_suffix - 1]
    {
        old_suffix -= 1;
        new_suffix -= 1;
    }

    let old_range = (prefix + 1)..=(old_suffix);
    let new_range = (prefix + 1)..=(new_suffix);

    result.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        old_range.start(),
        old_range.end() - old_range.start() + 1,
        new_range.start(),
        new_range.end() - new_range.start() + 1
    ));

    // Output unchanged context before diff region
    for i in 0..prefix {
        result.push(' ');
        result.push_str(old_lines[i]);
        result.push('\n');
    }

    // Output removed lines (old only)
    for i in prefix..old_suffix {
        result.push('-');
        result.push_str(old_lines[i]);
        result.push('\n');
    }

    // Output added lines (new only)
    for i in prefix..new_suffix {
        result.push('+');
        result.push_str(new_lines[i]);
        result.push('\n');
    }

    // Output unchanged context after diff region
    for i in new_suffix..new_lines.len() {
        result.push(' ');
        result.push_str(new_lines[i]);
        result.push('\n');
    }

    result
}

fn summarize_line_delta(old_content: &str, new_content: &str) -> (usize, usize) {
    let old_lines: Vec<&str> = old_content.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();

    let mut prefix = 0usize;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }

    let mut old_suffix = old_lines.len();
    let mut new_suffix = new_lines.len();
    while old_suffix > prefix
        && new_suffix > prefix
        && old_lines[old_suffix - 1] == new_lines[new_suffix - 1]
    {
        old_suffix -= 1;
        new_suffix -= 1;
    }

    (new_suffix - prefix, old_suffix - prefix)
}

fn has_shell_operator(input: &str) -> bool {
    ["&&", "||", "|", ">", "<"].iter().any(|operator| input.contains(operator))
}

fn looks_like_executable_path(token: &str, cwd: &Path) -> bool {
    let token_path = PathBuf::from(token);
    let candidate = if token_path.is_absolute() {
        token_path
    } else {
        cwd.join(token_path)
    };

    if candidate.exists() {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        for ext in [".cmd", ".bat", ".exe", ".ps1"] {
            if candidate.with_extension(ext.trim_start_matches('.')).exists() {
                return true;
            }
        }
    }

    false
}

fn is_executable_on_path(token: &str) -> bool {
    let path_var = match std::env::var_os("PATH") {
        Some(path_var) => path_var,
        None => return false,
        };

    let path_dirs: Vec<PathBuf> = std::env::split_paths(&path_var).collect();

    #[cfg(target_os = "windows")]
    let extensions: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".EXE;.CMD;.BAT;.COM".to_string())
        .split(';')
        .map(|value| value.trim().to_lowercase())
        .collect();

    for dir in path_dirs {
        let direct = dir.join(token);
        if direct.exists() {
            return true;
        }

        #[cfg(target_os = "windows")]
        {
            for extension in &extensions {
                let normalized = extension.trim_start_matches('.');
                if dir.join(format!("{}.{}", token, normalized)).exists() {
                    return true;
                }
            }
        }
    }

    false
}

fn velocity_agent_system_prompt() -> String {
    [
        "You are Velocity Agent, an autonomous coding assistant embedded in a desktop terminal.",
        "You must respond with JSON only. Never use markdown, prose outside JSON, or code fences.",
        "Decide between tool calls and a final answer. Use as many turns as needed, but stop once the task is complete.",
        "Available tools:",
        "1. read_file -> {\"type\":\"tool_call\",\"tool\":\"read_file\",\"args\":{\"path\":\"relative/or/absolute/path\"},\"reason\":\"why\"}",
        "2. write_file -> {\"type\":\"tool_call\",\"tool\":\"write_file\",\"args\":{\"path\":\"relative/path\",\"content\":\"full file contents\"},\"reason\":\"why\"}",
        "3. execute_command -> {\"type\":\"tool_call\",\"tool\":\"execute_command\",\"args\":{\"command\":\"non-destructive shell command\"},\"reason\":\"why\"}",
        "Final response schema:",
        "{\"type\":\"final\",\"message\":\"what you changed, tested, or need from the user\"}",
        "Rules:",
        "- Prefer read_file before write_file unless the change is trivial from context.",
        "- Use write_file for file edits. Do not rely on execute_command to mutate files.",
        "- Keep commands non-interactive and non-destructive.",
        "- Paths should stay inside the provided working directory.",
    ]
    .join("\n")
}

fn tool_metadata(tool_call: &AgentToolCall) -> (&'static str, Option<String>, &'static str) {
    match tool_call {
        AgentToolCall::ReadFile { path, reason } => (
            "Reading file",
            Some(format!("{}{}", path, format_reason(reason))),
            "read_file",
        ),
        AgentToolCall::WriteFile { path, reason, .. } => (
            "Writing file",
            Some(format!("{}{}", path, format_reason(reason))),
            "write_file",
        ),
        AgentToolCall::ExecuteCommand { command, reason } => (
            "Running command",
            Some(format!("{}{}", command, format_reason(reason))),
            "execute_command",
        ),
    }
}

fn tool_step_kind(tool_call: &AgentToolCall) -> AgentStepKind {
    match tool_call {
        AgentToolCall::ReadFile { .. } => AgentStepKind::ReadFile,
        AgentToolCall::WriteFile { .. } => AgentStepKind::WriteFile,
        AgentToolCall::ExecuteCommand { .. } => AgentStepKind::ExecuteCommand,
    }
}

fn format_reason(reason: &Option<String>) -> String {
    reason
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(": {}", value))
        .unwrap_or_default()
}

fn parse_agent_reply(content: &str) -> Result<AgentReply, String> {
    let raw_json = extract_json(content).ok_or_else(|| "Missing JSON object".to_string())?;
    let reply: RawAgentReply = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Invalid agent JSON: {}", e))?;

    match reply.kind.as_str() {
        "tool_call" => {
            let tool = reply
                .tool
                .ok_or_else(|| "Tool call is missing the tool name".to_string())?;
            let args = reply
                .args
                .ok_or_else(|| "Tool call is missing args".to_string())?;

            match tool.as_str() {
                "read_file" => {
                    let path = args
                        .get("path")
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| "read_file requires a path".to_string())?;
                    Ok(AgentReply::ToolCall(AgentToolCall::ReadFile {
                        path: path.to_string(),
                        reason: reply.reason,
                    }))
                }
                "write_file" => {
                    let path = args
                        .get("path")
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| "write_file requires a path".to_string())?;
                    let content = args
                        .get("content")
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| "write_file requires content".to_string())?;
                    Ok(AgentReply::ToolCall(AgentToolCall::WriteFile {
                        path: path.to_string(),
                        content: content.to_string(),
                        reason: reply.reason,
                    }))
                }
                "execute_command" => {
                    let command = args
                        .get("command")
                        .and_then(|value| value.as_str())
                        .ok_or_else(|| "execute_command requires a command".to_string())?;
                    Ok(AgentReply::ToolCall(AgentToolCall::ExecuteCommand {
                        command: command.to_string(),
                        reason: reply.reason,
                    }))
                }
                other => Err(format!("Unsupported tool '{}'", other)),
            }
        }
        "final" => {
            let message = reply
                .message
                .or(reply.summary)
                .ok_or_else(|| "Final response is missing message".to_string())?;
            Ok(AgentReply::Final { message })
        }
        other => Err(format!("Unsupported response type '{}'", other)),
    }
}

fn extract_json(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed.to_string());
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    Some(trimmed[start..=end].to_string())
}

async fn groq_chat_completion(
    client: &reqwest::Client,
    api_key: &str,
    messages: Vec<GroqChatMessage>,
) -> Result<String, String> {
    let request = GroqChatRequest {
        model: GROQ_MODEL,
        temperature: 0.1,
        messages,
    };

    let response = client
        .post(GROQ_API_URL)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Groq: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Groq response: {}", e))?;

    if !status.is_success() {
        return Err(format!("Groq returned {}: {}", status, body));
    }

    let parsed: GroqChatResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|choice| choice.message.content)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Groq did not return any content".to_string())
}

async fn run_simple_completion(system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    let api_key = groq_api_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build reqwest client: {}", e))?;

    groq_chat_completion(
        &client,
        &api_key,
        vec![
            GroqChatMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            GroqChatMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            },
        ],
    )
    .await
}

async fn run_shell_command(cwd: &Path, command: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = tokio::process::Command::new("cmd")
        .args(["/C", command])
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("sh")
        .args(["-lc", command])
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let exit_code = output.status.code().unwrap_or_default();

    let combined = if stdout.is_empty() && stderr.is_empty() {
        "(no output)".to_string()
    } else if stderr.is_empty() {
        stdout
    } else if stdout.is_empty() {
        format!("stderr:\n{}", stderr)
    } else {
        format!("stdout:\n{}\n\nstderr:\n{}", stdout, stderr)
    };

    Ok(format!(
        "exit_code: {}\noutput:\n{}",
        exit_code,
        truncate_chars(&combined, MAX_TOOL_OUTPUT_CHARS)
    ))
}

fn validate_agent_command(command: &str) -> Result<(), String> {
    // Hard-blocked patterns that are never allowed (even with confirmation)
    let lower = command.to_lowercase();
    for pattern in ["format ", "mkfs", "shutdown"] {
        if lower.contains(pattern) {
            return Err(format!("Refusing to run destructive command: {}", command));
        }
    }
    Ok(())
}

/// Returns Some(reason) if a command is risky and should trigger user confirmation.
/// Returns None if the command is safe.
fn is_risky_command(command: &str) -> Option<String> {
    let lower = command.to_lowercase();
    for pattern in BLOCKED_COMMAND_PATTERNS.iter() {
        if lower.contains(pattern) {
            return Some(format!("Matches blocked pattern: {}", pattern));
        }
    }
    None
}

fn emit_task_update(app: &AppHandle, snapshot: &AgentTaskSnapshot) {
    let _ = app.emit("agent://update", snapshot);
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value.to_string();
    }

    let truncated: String = value.chars().take(max_chars).collect();
    format!("{}\n...[truncated {} chars]", truncated, count - max_chars)
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
