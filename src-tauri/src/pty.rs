use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// ===========================================================================
// Data structures
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySessionInfo {
    pub id: String,
    pub pane_id: String,
    pub cwd: String,
    pub created_at: i64,
    pub is_alive: bool,
}

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send>,
    alive: Arc<Mutex<bool>>,
    cwd: Arc<Mutex<String>>,
}

// ===========================================================================
// Shared PTY state — managed by Tauri's .manage()
// ===========================================================================

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
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

        // Use /K on Windows for interactive shell (keeps running)
        // On Unix, bash/zsh stay interactive by default
        #[cfg(target_os = "windows")]
        {
            cmd.arg("/K");
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

        let emit_pane_id = pane_id.clone();
        let emit_session = session_id.clone();
        let app = app_handle.clone();

        // Spawn background thread to read PTY output and emit events
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — PTY closed
                        *read_alive.lock().unwrap() = false;
                        let _ = app.emit("pty://closed", serde_json::json!({
                            "sessionId": &emit_session,
                            "paneId": &emit_pane_id,
                        }));
                        break;
                    }
                    Ok(n) => {
                        let data = &buf[..n];
                        let output = String::from_utf8_lossy(data).to_string();

                        // Detect CWD changes from OSC 7 escape sequences (terminal standard)
                        if let Some(new_cwd) = extract_osc7_cwd(data) {
                            *emit_cwd.lock().unwrap() = new_cwd.clone();
                            let _ = app.emit("cwd-changed", serde_json::json!({
                                "sessionId": &emit_session,
                                "paneId": &emit_pane_id,
                                "cwd": &new_cwd,
                            }));
                        }

                        // Emit output to the specific pane
                        let _ = app.emit("pty://output", serde_json::json!({
                            "sessionId": &emit_session,
                            "paneId": &emit_pane_id.clone(),
                            "data": output,
                        }));
                    }
                    Err(e) => {
                        eprintln!("[PTY] Read error for {}: {}", emit_session, e);
                        *read_alive.lock().unwrap() = false;
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
                _child: child,
                alive,
                cwd: session_cwd,
            },
        );

        Ok(PtySessionInfo {
            id: session_id,
            pane_id,
            cwd,
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

    // Pattern: \x1b]7;file://...<BEL> or \x1b]7;file://...\x1b\\
    let osc7_prefix = "\x1b]7;file://";
    let osc7_suffixes: &[&str] = &["\x07", "\x1b\\"]; // BEL or ST

    if let Some(start) = text.find(osc7_prefix) {
        let after_prefix = &text[start + osc7_prefix.len()..];
        for suffix in osc7_suffixes {
            if let Some(end) = after_prefix.find(*suffix) {
                let file_url = &after_prefix[..end];
                // Extract path from file://hostname/path
                let after_scheme = match file_url.find("://") {
                    Some(i) => &file_url[i + 3..],
                    None => file_url,
                };
                if let Some(path_start) = after_scheme.find('/') {
                    if let Some(second_slash) = after_scheme[path_start + 1..].find('/') {
                        let path = &after_scheme[path_start + 1 + second_slash + 1..];
                        return Some(url_decode(path));
                    }
                }
            }
        }
    }

    None
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
