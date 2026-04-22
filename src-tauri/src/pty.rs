use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Per-session metrics tracked by the PTY manager
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetrics {
    pub bytes_read: u64,
    pub commands_seen: u64,
    pub created_at_secs: u64,  // seconds since UNIX epoch (for JSON serialization)
    pub last_activity_secs: u64,
    pub is_alive: bool,
}

// ===========================================================================
// Data structures
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub id: String,
    pub pane_id: String,
    pub cwd: String,
    pub shell_kind: String,
    pub created_at: i64,
    pub is_alive: bool,
}

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    alive: Arc<Mutex<bool>>,
    cwd: Arc<Mutex<String>>,
    metrics: Arc<Mutex<SessionMetrics>>,
}

// ===========================================================================
// Shared PTY state — managed by Tauri's .manage()
// ===========================================================================

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
}

/// Output buffer configuration for batched PTY output flushing
const OUTPUT_BUFFER_CAPACITY: usize = 32 * 1024; // 32 KB
const OUTPUT_FLUSH_INTERVAL_MS: u64 = 8; // flush after 8ms of silence

/// Current UNIX timestamp in seconds (for metrics serialization)
fn unix_secs_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Spawn a new PTY session for a terminal pane.
    /// Returns the session ID. Output is streamed via Tauri events.
    pub fn spawn(
        &mut self,
        pane_id: String,
        app_handle: tauri::AppHandle,
        cols: u16,
        rows: u16,
    ) -> Result<PtySessionInfo, String> {
        let session_id = format!("pty_{}", uuid::Uuid::new_v4().simple());

        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let cwd = std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Build the shell command — interactive mode
        #[cfg(target_os = "windows")]
        let mut cmd = CommandBuilder::new("cmd.exe");
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            if std::path::Path::new("/bin/bash").exists() {
                CommandBuilder::new("/bin/bash")
            } else if std::path::Path::new("/bin/zsh").exists() {
                CommandBuilder::new("/bin/zsh")
            } else if std::path::Path::new("/bin/sh").exists() {
                CommandBuilder::new("/bin/sh")
            } else {
                return Err("No compatible shell found".to_string());
            }
        };
        #[cfg(target_os = "windows")]
        let shell_kind = "cmd".to_string();
        #[cfg(not(target_os = "windows"))]
        let shell_kind = "posix".to_string();

        // Use /K on Windows for interactive shell (keeps running)
        // On Unix, bash/zsh stay interactive by default
        #[cfg(target_os = "windows")]
        {
            cmd.arg("/K");
            cmd.env("TERM", "xterm-256color");
            cmd.env("PROMPT", "$E]7;file://localhost/$P$E\\$P$G");
        }
        #[cfg(not(target_os = "windows"))]
        {
            cmd.env("TERM", "xterm-256color");
            // Track CWD via OSC 7 escape sequence on each prompt
            cmd.env("PROMPT_COMMAND", "printf '\\033]7;file://%s\\a' \"$PWD\" 2>/dev/null; true");
        }

        cmd.cwd(&cwd);

        // Spawn the child process inside the PTY
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell in PTY: {}", e))?;
        let shared_child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>> = Arc::new(Mutex::new(child));

        // The slave is consumed by spawn_command; we keep the master for I/O
        let master = pair.master;
        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;
        let writer = master.take_writer().map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let alive = Arc::new(Mutex::new(true));
        let session_cwd = Arc::new(Mutex::new(cwd.clone()));
        let read_alive = alive.clone();
        let emit_cwd = session_cwd.clone();
        let emit_child = shared_child.clone();

        // Session metrics — shared between read thread and query path
        let now = unix_secs_now();
        let session_metrics = Arc::new(Mutex::new(SessionMetrics {
            bytes_read: 0,
            commands_seen: 0,
            created_at_secs: now,
            last_activity_secs: now,
            is_alive: true,
        }));
        let read_metrics = session_metrics.clone();

        let emit_pane_id = pane_id.clone();
        let emit_session = session_id.clone();
        let app = app_handle.clone();

        // Spawn background thread to read PTY output and emit events (with buffering)
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            // Output buffer for batching — reduces Tauri event firehose
            let mut output_buffer: Vec<u8> = Vec::with_capacity(OUTPUT_BUFFER_CAPACITY);
            let mut last_emit = Instant::now();

            // Flush accumulated output buffer as a single Tauri event.
            let flush_output = |buffer: &mut Vec<u8>| -> bool {
                if buffer.is_empty() {
                    return false;
                }
                let output = String::from_utf8_lossy(buffer).to_string();
                let _ = app.emit("pty://output", serde_json::json!({
                    "sessionId": &emit_session,
                    "paneId": &emit_pane_id.clone(),
                    "data": output,
                }));
                buffer.clear();
                true
            };

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — flush remaining buffer, then signal close
                        flush_output(&mut output_buffer);
                        *read_alive.lock().unwrap() = false;
                        {
                            let mut m = read_metrics.lock().unwrap();
                            m.is_alive = false;
                            m.last_activity_secs = unix_secs_now();
                        }
                        let exit_code = emit_child
                            .lock()
                            .ok()
                            .and_then(|mut child| child.wait().ok())
                            .map(|status| status.exit_code() as i64);
                        let _ = app.emit("pty://closed", serde_json::json!({
                            "sessionId": &emit_session,
                            "paneId": &emit_pane_id,
                            "exitCode": exit_code,
                        }));
                        break;
                    }
                    Ok(n) => {
                        let data = &buf[..n];

                        // Update metrics
                        {
                            let mut m = read_metrics.lock().unwrap();
                            m.bytes_read += n as u64;
                            let now_secs = unix_secs_now();
                            m.last_activity_secs = now_secs;
                        }

                        // Detect CWD changes from OSC 7 escape sequences (terminal standard)
                        if let Some(new_cwd) = extract_osc7_cwd(data) {
                            *emit_cwd.lock().unwrap() = new_cwd.clone();
                            let _ = app.emit("cwd-changed", serde_json::json!({
                                "sessionId": &emit_session,
                                "paneId": &emit_pane_id,
                                "cwd": &new_cwd,
                            }));
                        }

                        // Buffer output instead of emitting immediately
                        output_buffer.extend_from_slice(data);

                        // Flush when buffer is full
                        if output_buffer.len() >= OUTPUT_BUFFER_CAPACITY {
                            let _ = flush_output(&mut output_buffer);
                            last_emit = Instant::now();
                        } else if last_emit.elapsed() >= Duration::from_millis(OUTPUT_FLUSH_INTERVAL_MS) {
                            // Also flush after interval of silence (keeps latency low)
                            let _ = flush_output(&mut output_buffer);
                            last_emit = Instant::now();
                        }
                    }
                    Err(e) => {
                        // On error, flush any buffered output before dying
                        flush_output(&mut output_buffer);
                        eprintln!("[PTY] Read error for {}: {}", emit_session, e);
                        *read_alive.lock().unwrap() = false;
                        {
                            let mut m = read_metrics.lock().unwrap();
                            m.is_alive = false;
                        }
                        let exit_code = emit_child
                            .lock()
                            .ok()
                            .and_then(|mut child| child.try_wait().ok().flatten())
                            .map(|status| status.exit_code() as i64);
                        let _ = app.emit("pty://closed", serde_json::json!({
                            "sessionId": &emit_session,
                            "paneId": &emit_pane_id,
                            "exitCode": exit_code,
                        }));
                        break;
                    }
                }
            }
        });

        self.sessions.insert(
            session_id.clone(),
            PtySession {
                master,
                writer,
                _child: shared_child,
                alive,
                cwd: session_cwd,
                metrics: session_metrics,
            },
        );

        Ok(PtySessionInfo {
            id: session_id,
            pane_id,
            cwd,
            shell_kind,
            created_at: chrono::Utc::now().timestamp_millis(),
            is_alive: true,
        })
    }

    /// Write input (keystrokes / commands) to a specific PTY session
    pub fn write(&mut self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

        {
            let mut metrics = session.metrics.lock().unwrap();
            metrics.last_activity_secs = unix_secs_now();
            let carriage_returns = data.matches('\r').count() as u64;
            let newlines = data.matches('\n').count() as u64;
            metrics.commands_seen += if carriage_returns > 0 {
                carriage_returns
            } else {
                newlines
            };
        }

        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;

        Ok(())
    }

    /// Resize a PTY session's terminal dimensions
    pub fn resize(&mut self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;

        Ok(())
    }

    /// Kill (terminate) a PTY session
    pub fn kill(&mut self, session_id: &str) -> Result<(), String> {
        let session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

        *session.alive.lock().unwrap() = false;

        Ok(())
    }

    /// List all active PTY sessions
    pub fn list(&self) -> Vec<PtySessionInfo> {
        self.sessions
            .iter()
            .map(|(id, sess)| PtySessionInfo {
                id: id.clone(),
                pane_id: String::new(),
                cwd: sess.cwd.lock().unwrap().clone(),
                shell_kind: if cfg!(target_os = "windows") { "cmd".to_string() } else { "posix".to_string() },
                created_at: 0,
                is_alive: *sess.alive.lock().unwrap(),
            })
            .collect()
    }

    /// Check if a session exists.
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Get the current working directory of a session
    pub fn get_cwd(&self, session_id: &str) -> Result<String, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;

        Ok(session.cwd.lock().unwrap().clone())
    }

    /// Clean up all sessions (called on app shutdown)
    pub fn shutdown(&mut self) {
        for (_, session) in self.sessions.drain() {
            *session.alive.lock().unwrap() = false;
        }
    }

    /// Get metrics for a specific PTY session
    pub fn get_session_metrics(&self, session_id: &str) -> Result<SessionMetrics, String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("PTY session '{}' not found", session_id))?;
        Ok(session.metrics.lock().unwrap().clone())
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

// ===========================================================================
// Helpers
// ===========================================================================

/// Extract current working directory from an OSC 7 escape sequence.
/// Terminals emit `ESC ] 7 ; file://hostname/path BEL` to communicate CWD.
fn extract_osc7_cwd(data: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(data);

    let start = text.find("\x1b]7;file://")?;
    let payload = &text[start + "\x1b]7;file://".len()..];
    let end = payload
        .find('\x07')
        .or_else(|| payload.find("\x1b\\"))?;
    let file_url = &payload[..end];
    let path_start = file_url.find('/')?;
    let decoded = url_decode(&file_url[path_start..]);

    #[cfg(target_os = "windows")]
    {
        let trimmed = decoded.trim_start_matches('/');
        return Some(trimmed.replace('/', "\\"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Some(decoded)
    }
}

/// Minimal URL percent decoding
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push(c);
                result.push_str(&hex);
            }
        } else {
            result.push(c);
        }
    }
    result
}
