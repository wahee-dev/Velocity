import { invoke } from '@tauri-apps/api/core';

/**
 * Stub handler for Tauri actions
 * Each function wraps invoke() for type safety and error handling
 */

// Execute a shell command
export async function handleExecuteCommand(command: string): Promise<string> {
  try {
    const result = await invoke<string>('execute_command', { command });
    return result;
  } catch (error) {
    console.error('[Tauri] execute_command failed:', error);
    throw error;
  }
}

// Cancel a running command
export async function handleCancelCommand(blockId: string): Promise<void> {
  try {
    await invoke('cancel_command', { blockId });
  } catch (error) {
    console.error('[Tauri] cancel_command failed:', error);
    throw error;
  }
}

// Create a new workspace
export async function handleCreateWorkspace(name: string): Promise<string> {
  try {
    const workspaceId = await invoke<string>('create_workspace', { name });
    return workspaceId;
  } catch (error) {
    console.error('[Tauri] create_workspace failed:', error);
    throw error;
  }
}

// Create a new folder in workspace
export async function handleCreateFolder(workspaceId: string, name: string): Promise<string> {
  try {
    const folderId = await invoke<string>('create_folder', { workspaceId, name });
    return folderId;
  } catch (error) {
    console.error('[Tauri] create_folder failed:', error);
    throw error;
  }
}

// Delete a folder
export async function handleDeleteFolder(folderId: string): Promise<void> {
  try {
    await invoke('delete_folder', { folderId });
  } catch (error) {
    console.error('[Tauri] delete_folder failed:', error);
    throw error;
  }
}

// Rename a folder
export async function handleRenameFolder(folderId: string, newName: string): Promise<void> {
  try {
    await invoke('rename_folder', { folderId, newName });
  } catch (error) {
    console.error('[Tauri] rename_folder failed:', error);
    throw error;
  }
}

// Open a new tab
export async function handleOpenTab(workspaceId: string): Promise<string> {
  try {
    const tabId = await invoke<string>('open_tab', { workspaceId });
    return tabId;
  } catch (error) {
    console.error('[Tauri] open_tab failed:', error);
    throw error;
  }
}

// Close a tab
export async function handleCloseTab(tabId: string): Promise<void> {
  try {
    await invoke('close_tab', { tabId });
  } catch (error) {
    console.error('[Tauri] close_tab failed:', error);
    throw error;
  }
}

// Switch active tab
export async function handleSwitchTab(tabId: string): Promise<void> {
  try {
    await invoke('switch_tab', { tabId });
  } catch (error) {
    console.error('[Tauri] switch_tab failed:', error);
    throw error;
  }
}

// AI Command - send prompt to AI
export async function handleAIPrompt(prompt: string): Promise<string> {
  try {
    const response = await invoke<string>('ai_prompt', { prompt });
    return response;
  } catch (error) {
    console.error('[Tauri] ai_prompt failed:', error);
    throw error;
  }
}

// AI Command - convert natural language to shell command
export async function handleAIToCommand(naturalLanguage: string): Promise<string> {
  try {
    const command = await invoke<string>('ai_to_command', { naturalLanguage });
    return command;
  } catch (error) {
    console.error('[Tauri] ai_to_command failed:', error);
    throw error;
  }
}

// Copy text to clipboard
export async function handleCopyToClipboard(text: string): Promise<void> {
  try {
    await invoke('copy_to_clipboard', { text });
  } catch (error) {
    console.error('[Tauri] copy_to_clipboard failed:', error);
    throw error;
  }
}

// Clear terminal history
export async function handleClearHistory(): Promise<void> {
  try {
    await invoke('clear_history');
  } catch (error) {
    console.error('[Tauri] clear_history failed:', error);
    throw error;
  }
}

// Open settings
export async function handleOpenSettings(): Promise<void> {
  try {
    await invoke('open_settings');
  } catch (error) {
    console.error('[Tauri] open_settings failed:', error);
    throw error;
  }
}

// Get system info
export async function handleGetSystemInfo(): Promise<Record<string, string>> {
  try {
    const info = await invoke<Record<string, string>>('get_system_info');
    return info;
  } catch (error) {
    console.error('[Tauri] get_system_info failed:', error);
    throw error;
  }
}
