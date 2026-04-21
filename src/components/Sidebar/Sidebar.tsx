import { useState } from 'react';
import {
  Folder,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Terminal,
  History,
  Settings,
  Plus,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { handleCreateFolder, handleCreateWorkspace, handleOpenTab } from '../../hooks/useTauri';
import type { Workspace, Folder as FolderType, SidebarState } from '../../types';
import './Sidebar.css';

// Mock data for demonstration
const mockWorkspaces: Workspace[] = [
  {
    id: 'ws-1',
    name: 'Personal',
    folders: [
      { id: 'f-1', name: 'Projects', workspaceId: 'ws-1', sessions: [], isExpanded: true },
      { id: 'f-2', name: 'Scripts', workspaceId: 'ws-1', sessions: [], isExpanded: false },
      { id: 'f-3', name: 'Dotfiles', workspaceId: 'ws-1', sessions: [], isExpanded: false },
    ],
  },
  {
    id: 'ws-2',
    name: 'Work',
    folders: [
      { id: 'f-4', name: 'Frontend', workspaceId: 'ws-2', sessions: [], isExpanded: false },
      { id: 'f-5', name: 'Backend', workspaceId: 'ws-2', sessions: [], isExpanded: false },
      { id: 'f-6', name: 'DevOps', workspaceId: 'ws-2', sessions: [], isExpanded: false },
    ],
  },
];

export function Sidebar() {
  const [state, setState] = useState<SidebarState>({
    isCollapsed: false,
    activeTab: 'workspaces',
    selectedWorkspaceId: 'ws-1',
    selectedFolderId: null,
  });

  const [workspaces] = useState<Workspace[]>(mockWorkspaces);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['f-1']));

  const handleTabChange = (tab: SidebarState['activeTab']) => {
    setState((prev) => ({ ...prev, activeTab: tab }));
  };

  const handleToggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleFolderClick = (folderId: string) => {
    setState((prev) => ({ ...prev, selectedFolderId: folderId }));
  };

  const handleNewFolder = async (workspaceId: string) => {
    try {
      await handleCreateFolder(workspaceId, 'New Folder');
    } catch {
      // Stub - would handle error in production
      console.log('Creating folder in workspace:', workspaceId);
    }
  };

  const handleNewWorkspace = async () => {
    try {
      await handleCreateWorkspace('New Workspace');
    } catch {
      console.log('Creating new workspace');
    }
  };

  const handleNewTab = async (workspaceId: string) => {
    try {
      await handleOpenTab(workspaceId);
    } catch {
      console.log('Opening new tab in workspace:', workspaceId);
    }
  };

  const renderFolder = (folder: FolderType) => {
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = state.selectedFolderId === folder.id;

    return (
      <div key={folder.id} className="sidebar-folder">
        <button
          className={`sidebar-folder-header ${isSelected ? 'selected' : ''}`}
          onClick={() => {
            handleToggleFolder(folder.id);
            handleFolderClick(folder.id);
          }}
        >
          <span className="folder-chevron">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <Folder size={16} className="folder-icon" />
          <span className="folder-name">{folder.name}</span>
          <button
            className="folder-actions"
            onClick={(e) => {
              e.stopPropagation();
              handleNewTab(folder.workspaceId);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </button>
        {isExpanded && folder.sessions.length > 0 && (
          <div className="folder-sessions">
            {folder.sessions.map((session) => (
              <button key={session.id} className="session-item">
                <Terminal size={14} />
                <span>{session.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderWorkspace = (workspace: Workspace) => (
    <div key={workspace.id} className="sidebar-workspace">
      <div className="workspace-header">
        <span className="workspace-name">{workspace.name}</span>
        <button
          className="workspace-add-folder"
          onClick={() => handleNewFolder(workspace.id)}
          title="Add folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>
      <div className="workspace-folders">
        {workspace.folders.map(renderFolder)}
      </div>
    </div>
  );

  return (
    <aside className={`sidebar ${state.isCollapsed ? 'collapsed' : ''}`}>
      {/* Tab Navigation */}
      <nav className="sidebar-tabs">
        <button
          className={`sidebar-tab ${state.activeTab === 'workspaces' ? 'active' : ''}`}
          onClick={() => handleTabChange('workspaces')}
          title="Workspaces"
        >
          <Folder size={18} />
        </button>
        <button
          className={`sidebar-tab ${state.activeTab === 'history' ? 'active' : ''}`}
          onClick={() => handleTabChange('history')}
          title="History"
        >
          <History size={18} />
        </button>
        <button
          className={`sidebar-tab ${state.activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => handleTabChange('settings')}
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </nav>

      {/* Search */}
      <div className="sidebar-search">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Search..."
          className="search-input"
        />
      </div>

      {/* Content */}
      <div className="sidebar-content">
        {state.activeTab === 'workspaces' && (
          <>
            <div className="sidebar-section-header">
              <span>Workspaces</span>
              <button
                className="add-workspace-btn"
                onClick={handleNewWorkspace}
                title="New workspace"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="workspaces-list">
              {workspaces.map(renderWorkspace)}
            </div>
          </>
        )}

        {state.activeTab === 'history' && (
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span>Recent Commands</span>
            </div>
            <div className="history-list">
              <button className="history-item">
                <Terminal size={14} />
                <span className="history-command">git status</span>
              </button>
              <button className="history-item">
                <Terminal size={14} />
                <span className="history-command">npm run dev</span>
              </button>
              <button className="history-item">
                <Terminal size={14} />
                <span className="history-command">docker ps -a</span>
              </button>
            </div>
          </div>
        )}

        {state.activeTab === 'settings' && (
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span>Settings</span>
            </div>
            <div className="settings-list">
              <button className="settings-item">
                <span>Appearance</span>
              </button>
              <button className="settings-item">
                <span>Keybindings</span>
              </button>
              <button className="settings-item">
                <span>AI Settings</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
