// Workspace and Folder Types
export interface Workspace {
  id: string;
  name: string;
  icon?: string;
  folders: Folder[];
}

export interface Folder {
  id: string;
  name: string;
  workspaceId: string;
  sessions: Session[];
  isExpanded: boolean;
}

export interface Session {
  id: string;
  name: string;
  folderId: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

// Command Block Types
export interface CommandBlock {
  id: string;
  command: string;
  output: string;
  status: 'running' | 'success' | 'error' | 'idle';
  timestamp: Date;
  exitCode?: number;
  duration?: number;
}

// Tab Types
export interface Tab {
  id: string;
  name: string;
  workspaceId: string;
  isActive: boolean;
  blocks: CommandBlock[];
}

// AI Command Types
export interface AICommand {
  id: string;
  prompt: string;
  response?: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
}

// Sidebar State
export interface SidebarState {
  isCollapsed: boolean;
  activeTab: 'workspaces' | 'history' | 'settings';
  selectedWorkspaceId: string | null;
  selectedFolderId: string | null;
}
