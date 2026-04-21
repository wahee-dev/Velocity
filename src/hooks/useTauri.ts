import { invoke } from '@tauri-apps/api/core';
import type { FileNode } from '../types';

/**
 * Tauri IPC bridge — each function wraps invoke() for type safety and error handling.
 * These are the real implementations replacing all former stubs.
 */

// ── PTY / Terminal ────────────────────────────────────────────────

/** Spawn a new PTY (interactive shell) for a terminal pane. Returns session info. */
export async function handleSpawnPty(paneId: string): Promise<{ id: string; cwd: string }> {
  try {
    const result = await invoke<{ id: string; cwd: string }>('spawn_pty', { paneId });
    return result;
  } catch (error) {
    console.error('[Tauri] spawn_pty failed:', error);
    throw error;
  }
}

/** Write input (keystrokes, commands) to a running PTY session. */
export async function handleWriteToPty(sessionId: string, data: string): Promise<void> {
  try {
    await invoke('write_to_pty', { sessionId, data });
  } catch (error) {
    console.error('[Tauri] write_to_pty failed:', error);
    throw error;
  }
}

/** Resize a PTY session's terminal dimensions. */
export async function handleResizePty(sessionId: string, cols: number, rows: number): Promise<void> {
  try {
    await invoke('resize_pty', { sessionId, cols, rows });
  } catch (error) {
    console.error('[Tauri] resize_pty failed:', error);
    throw error;
  }
}

/** Kill (terminate) a PTY session. */
export async function handleKillPty(sessionId: string): Promise<void> {
  try {
    await invoke('kill_pty', { sessionId });
  } catch (error) {
    console.error('[Tauri] kill_pty failed:', error);
    throw error;
  }
}

// ── Command Execution ─────────────────────────────────────────────

/** Execute a one-shot shell command (non-interactive). Returns stdout/stderr. */
export async function handleExecuteCommand(command: string): Promise<string> {
  try {
    const result = await invoke<string>('execute_command', { command });
    return result;
  } catch (error) {
    console.error('[Tauri] execute_command failed:', error);
    throw error;
  }
}

/** Cancel / kill a running command or PTY session. */
export async function handleCancelCommand(blockId: string): Promise<void> {
  try {
    await invoke('cancel_command', { blockId });
  } catch (error) {
    console.error('[Tauri] cancel_command failed:', error);
    throw error;
  }
}

// ── File System ───────────────────────────────────────────────────

/** Read directory contents as a sorted FileNode list. */
export async function handleReadDir(path: string): Promise<FileNode[]> {
  try {
    const nodes = await invoke<FileNode[]>('read_dir', { path });
    return nodes;
  } catch (error) {
    console.error('[Tauri] read_dir failed:', error);
    throw error;
  }
}

/** Get git status (branch + changed file count) for a directory. */
export async function handleGetGitStatus(path?: string): Promise<{ branch: string; changes: number }> {
  try {
    const status = await invoke<{ branch: string; changes: number }>('get_git_status', { path });
    return status;
  } catch (error) {
    console.error('[Tauri] get_git_status failed:', error);
    throw error;
  }
}

/** Open a file in the system's default application. */
export async function handleOpenFile(path: string): Promise<void> {
  try {
    await invoke('open_file', { path });
  } catch (error) {
    console.error('[Tauri] open_file failed:', error);
    throw error;
  }
}

// ── Workspace & Folder Management ─────────────────────────────────

export async function handleCreateWorkspace(name: string): Promise<string> {
  try {
    const workspaceId = await invoke<string>('create_workspace', { name });
    return workspaceId;
  } catch (error) {
    console.error('[Tauri] create_workspace failed:', error);
    throw error;
  }
}

export async function handleCreateFolder(workspaceId: string, name: string): Promise<string> {
  try {
    const folderId = await invoke<string>('create_folder', { workspaceId, name });
    return folderId;
  } catch (error) {
    console.error('[Tauri] create_folder failed:', error);
    throw error;
  }
}

export async function handleDeleteFolder(folderId: string): Promise<void> {
  try {
    await invoke('delete_folder', { folderId });
  } catch (error) {
    console.error('[Tauri] delete_folder failed:', error);
    throw error;
  }
}

export async function handleRenameFolder(folderId: string, newName: string): Promise<void> {
  try {
    await invoke('rename_folder', { folderId, newName });
  } catch (error) {
    console.error('[Tauri] rename_folder failed:', error);
    throw error;
  }
}

// ── Tab Management ────────────────────────────────────────────────

export async function handleOpenTab(workspaceId: string): Promise<string> {
  try {
    const tabId = await invoke<string>('open_tab', { workspaceId });
    return tabId;
  } catch (error) {
    console.error('[Tauri] open_tab failed:', error);
    throw error;
  }
}

export async function handleCloseTab(tabId: string): Promise<void> {
  try {
    await invoke('close_tab', { tabId });
  } catch (error) {
    console.error('[Tauri] close_tab failed:', error);
    throw error;
  }
}

export async function handleSwitchTab(tabId: string): Promise<void> {
  try {
    await invoke('switch_tab', { tabId });
  } catch (error) {
    console.error('[Tauri] switch_tab failed:', error);
    throw error;
  }
}

// ── AI Features ───────────────────────────────────────────────────

export async function handleAIPrompt(prompt: string): Promise<string> {
  try {
    const response = await invoke<string>('ai_prompt', { prompt });
    return response;
  } catch (error) {
    console.error('[Tauri] ai_prompt failed:', error);
    throw error;
  }
}

export async function handleAIToCommand(naturalLanguage: string): Promise<string> {
  try {
    const command = await invoke<string>('ai_to_command', { naturalLanguage });
    return command;
  } catch (error) {
    console.error('[Tauri] ai_to_command failed:', error);
    throw error;
  }
}

// ── Clipboard & Utilities ─────────────────────────────────────────

export async function handleCopyToClipboard(text: string): Promise<void> {
  try {
    await invoke('copy_to_clipboard', { text });
  } catch (error) {
    console.error('[Tauri] copy_to_clipboard failed:', error);
    throw error;
  }
}

export async function handleClearHistory(): Promise<void> {
  try {
    await invoke('clear_history');
  } catch (error) {
    console.error('[Tauri] clear_history failed:', error);
    throw error;
  }
}

export async function handleOpenSettings(): Promise<void> {
  try {
    await invoke('open_settings');
  } catch (error) {
    console.error('[Tauri] open_settings failed:', error);
    throw error;
  }
}

export async function handleGetSystemInfo(): Promise<Record<string, string>> {
  try {
    const info = await invoke<Record<string, string>>('get_system_info');
    return info;
  } catch (error) {
    console.error('[Tauri] get_system_info failed:', error);
    throw error;
  }
}
