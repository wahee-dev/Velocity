export interface Session {
  id: string;
  name: string;
  path: string;
  icon?: 'claude' | 'terminal';
  isActive: boolean;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  isExpanded?: boolean;
}

export interface TerminalPane {
  id: string;
  path: string;
  isActive: boolean;
}

export interface CommandBlock {
  id: string;
  command: string;
  output?: string;
  status: 'input' | 'running' | 'success' | 'error';
  timestamp: Date;
}

export interface GitStatus {
  branch: string;
  changes: number;
}
