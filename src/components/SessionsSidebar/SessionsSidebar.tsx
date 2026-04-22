/* @solid */
import {
  createSignal,
  createEffect,
  onCleanup,
  Show,
} from "solid-js";
import {
  PanelLeft,
  FolderTree,
  Search,
  ArrowLeftRight,
  Plus,
  TerminalSquare,
  X,
  FileText,
} from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, SearchResult } from "../../types";
import "./SessionsSidebar.css";

interface SessionsSidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectWorkspace: (w: Workspace) => void;
  onDeleteWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onToggleExplorer: () => void;
  onToggleGlobalSearch: () => void;
}

export function SessionsSidebar(props: SessionsSidebarProps) {
  const [collapsed, setCollapsed] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<SearchResult[]>([]);
  const [isSearching, setIsSearching] = createSignal(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced file search
  createEffect(() => {
    const query = searchQuery();
    if (searchTimer) clearTimeout(searchTimer);

    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimer = setTimeout(async () => {
      const activeWs = props.workspaces.find(
        (w) => w.id === props.activeWorkspaceId
      );
      if (!activeWs) return;

      setIsSearching(true);
      try {
        const results = await invoke<SearchResult[]>("search_files", {
          path: activeWs.rootPath,
          query: query.trim(),
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    onCleanup(() => {
      if (searchTimer) clearTimeout(searchTimer);
    });
  });

  if (collapsed()) {
    return (
      <div class="sessions-sidebar collapsed">
        <div class="sidebar-toolbar">
          <button
            class="toolbar-btn"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <PanelLeft size={16} />
          </button>
        </div>
      </div>
    );
  }

  const filteredWorkspaces = props.workspaces.filter((w) =>
    w.name.toLowerCase().includes(searchQuery().toLowerCase())
  );

  return (
    <div class="sessions-sidebar">
      <div class="sidebar-toolbar">
        <div class="toolbar-item" title="Collapse sidebar (Ctrl+B)">
          <button
            class="toolbar-btn"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeft size={15} />
          </button>
          <kbd class="shortcut-badge">B</kbd>
        </div>
        <div class="toolbar-item" title="Toggle File Explorer (Ctrl+E)">
          <button class="toolbar-btn" onClick={props.onToggleExplorer}>
            <FolderTree size={15} />
          </button>
          <kbd class="shortcut-badge">E</kbd>
        </div>
        <div class="toolbar-item" title="Global Search (Ctrl+Shift+P)">
          <button class="toolbar-btn" onClick={props.onToggleGlobalSearch}>
            <Search size={15} />
          </button>
          <kbd class="shortcut-badge">P</kbd>
        </div>
      </div>

      <div class="sidebar-search">
        <Search size={12} class="search-icon" />
        <input
          type="text"
          placeholder="Find session..."
          value={searchQuery()}
          onInput={(e) =>
            setSearchQuery((e.target as HTMLInputElement).value)
          }
        />
        <div class="search-actions">
          <button class="search-action-btn">
            <ArrowLeftRight size={12} />
          </button>
          <button
            class="search-action-btn"
            onClick={props.onCreateWorkspace}
            title="New Session"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <Show when={searchQuery().trim()}>
        <div class="search-results-dropdown">
          <Show
            when={isSearching()}
            fallback={
              <Show
                when={searchResults().length > 0}
                fallback={<div class="search-result-item no-results">No results found</div>}
              >
                {searchResults().slice(0, 20).map((result, i) => (
                  <div key={i} class="search-result-item">
                    <FileText size={12} class="result-icon" />
                    <span class="result-name">{result.name}</span>
                    <span class="result-path">{result.path}</span>
                  </div>
                ))}
              </Show>
            }
          >
            <div class="search-result-item searching">Searching...</div>
          </Show>
        </div>
      </Show>

      <div class="sessions-list">
        {filteredWorkspaces.map((workspace) => (
          <div
            class={`session-item ${
              props.activeWorkspaceId === workspace.id ? "selected" : ""
            }`}
            onClick={() => props.onSelectWorkspace(workspace)}
          >
            <div class="session-icon">
              <TerminalSquare
                size={15}
                class="session-terminal-icon"
              />
            </div>
            <div class="session-info">
              <span class="session-name">{workspace.name}</span>
              <span class="session-detail">
                {workspace.rootPath} &middot; {workspace.paneIds.length}
                pane{workspace.paneIds.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              class="session-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                props.onDeleteWorkspace(workspace.id);
              }}
              title="Close workspace"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
