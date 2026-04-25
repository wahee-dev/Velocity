/* @solid */
import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { SessionsSidebar } from "./components/SessionsSidebar/SessionsSidebar";
import { FileExplorer } from "./components/FileExplorer/FileExplorer";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { EditorPane } from "./components/EditorPane/EditorPane";
import { GlobalSearchOverlay } from "./components/GlobalSearchOverlay/GlobalSearchOverlay";
import { TerminalProvider, useTerminalContext } from "./context/TerminalContext";
import { invoke } from "@tauri-apps/api/core";
import type { Workspace, EditorTab } from "./types";

const DEFAULT_PATH = "";

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    const home = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
      ? "" // Tauri can resolve this natively; keep as-is for now
      : "";
    return path.replace("~", home || "");
  }
  return path;
}

function AppInner() {
  const context = useTerminalContext();

  const [workspaces, setWorkspaces] = createSignal<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = createSignal<string | null>(null);
  const [showFileExplorer, setShowFileExplorer] = createSignal(false);
  const [showGlobalSearch, setShowGlobalSearch] = createSignal(false);
  const [editorTabs, setEditorTabs] = createSignal<EditorTab[]>([]);

  const activeWorkspace = () =>
    workspaces().find((w) => w.id === activeWorkspaceId()) ?? null;

  // Initialize default workspaces on mount
  onMount(() => {
    if (workspaces().length > 0) return;

    const names = ["Claude Code", "clear", "New session", "New session"];
    const initial: Workspace[] = names.map((name) => {
      const paneId = crypto.randomUUID();
      return {
        id: crypto.randomUUID(),
        name,
        rootPath: DEFAULT_PATH,
        paneIds: [paneId],
      };
    });

    initial.forEach((w) => {
      w.paneIds.forEach((paneId) => {
        context.createSession(DEFAULT_PATH, paneId);
      });
    });

    setWorkspaces(initial);
    setActiveWorkspaceId(initial[initial.length - 1].id);
    context.setActiveSession(
      initial[initial.length - 1].paneIds[0]
    );
  });

  function handleSelectWorkspace(workspace: Workspace) {
    setActiveWorkspaceId(workspace.id);
    if (workspace.paneIds.length > 0)
      context.setActiveSession(workspace.paneIds[0]);
  }

  async function handleDeleteWorkspace(id: string) {
    const ws = workspaces().find((w) => w.id === id);
    if (!ws) return;

    for (const paneId of ws.paneIds) {
      try {
        await invoke("kill_pty", { sessionId: paneId });
      } catch {}
      context.removeSession(paneId);
    }

    let next: Workspace | undefined;
    setWorkspaces((prev) => {
      const filtered = prev.filter((w) => w.id !== id);
      next = filtered[filtered.length - 1];
      return filtered;
    });

    if (activeWorkspaceId() === id) {
      if (next) {
        setActiveWorkspaceId(next.id);
        if (next.paneIds.length > 0)
          context.setActiveSession(next.paneIds[0]);
      } else {
        setActiveWorkspaceId(null);
      }
    }
  }

  function handleCreateWorkspace() {
    const paneId = crypto.randomUUID();
    const newWs: Workspace = {
      id: crypto.randomUUID(),
      name: "New workspace",
      rootPath: DEFAULT_PATH,
      paneIds: [paneId],
    };

    context.createSession(DEFAULT_PATH, paneId);

    setWorkspaces((prev) => [...prev, newWs]);
    setActiveWorkspaceId(newWs.id);
    context.setActiveSession(paneId);
  }

  function handleAddPane() {
    const aw = activeWorkspace();
    if (!aw) return;

    const paneId = crypto.randomUUID();
    context.createSession(DEFAULT_PATH, paneId);

    setWorkspaces((prev) =>
      prev.map((w) =>
        w.id === aw.id ? { ...w, paneIds: [...w.paneIds, paneId] } : w
      )
    );
    context.setActiveSession(paneId);
  }

  // ── Editor tab management ──
  function getLanguageFromExt(fileName: string): string {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex === -1) return "plaintext";
    const ext = fileName.slice(dotIndex + 1).toLowerCase();
    const map: Record<string, string> = {
      ts: "typescript", tsx: "typescriptreact", js: "javascript", jsx: "javascriptreact",
      json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
      rust: "rs", python: "python", toml: "toml", yaml: "yaml", yml: "yaml",
      sh: "shellscript", bash: "shellscript", sql: "sql", xml: "xml", go: "go",
      rs: "rust", java: "java", rb: "ruby", php: "php", lua: "lua",
      env: "plaintext", txt: "plaintext", dockerfile: "dockerfile",
    };
    return map[ext] ?? "plaintext";
  }

  function openEditorTab(filePath: string, fileName: string) {
    const existing = editorTabs().find((t) => t.filePath === filePath);
    if (existing) return;

    const newTab: EditorTab = {
      id: crypto.randomUUID(),
      filePath,
      fileName,
      isDirty: false,
      language: getLanguageFromExt(fileName),
    };
    setEditorTabs((prev) => [...prev, newTab]);
  }

  function closeEditorTab(tabId: string) {
    setEditorTabs((prev) => prev.filter((t) => t.id !== tabId));
  }

  function markSaved(tabId: string) {
    setEditorTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t))
    );
  }

  async function saveEditorTab(tabId: string) {
    markSaved(tabId);
  }

  async function handleRemovePane(paneId: string) {
    const aw = activeWorkspace();
    if (!aw) return;

    try {
      await invoke("kill_pty", { sessionId: paneId });
    } catch {}
    context.removeSession(paneId);

    let remainingPanes: string[] = [];
    setWorkspaces((prev) => {
      const next = prev.map((w) =>
        w.id === aw.id
          ? { ...w, paneIds: w.paneIds.filter((pid) => pid !== paneId) }
          : w
      );
      const updated = next.find((w) => w.id === aw.id);
      remainingPanes = updated?.paneIds ?? [];
      return next;
    });

    if (context.state().activeSessionId === paneId) {
      if (remainingPanes.length > 0)
        context.setActiveSession(remainingPanes[remainingPanes.length - 1]);
    }
  }

  const handleToggleExplorer = () => setShowFileExplorer((v) => !v);
  const handleToggleGlobalSearch = () => setShowGlobalSearch((v) => !v);

  // Ctrl+Shift+D -> add pane
  createEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        handleAddPane();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Derive file explorer paths from active workspace panes' sessions
  const explorerPaths = (): string[] => {
    const paths: string[] = [];
    const aw = activeWorkspace();
    if (aw) {
      for (const paneId of aw.paneIds) {
        const session = context.state().sessions.get(paneId);
        if (session) paths.push(expandPath(session.path));
      }
    }
    if (paths.length === 0) paths.push(expandPath(aw?.rootPath ?? DEFAULT_PATH));
    return paths;
  };

  return (
    <div class="app-container">
      <div class="app-body">
        <SessionsSidebar
          workspaces={workspaces()}
          activeWorkspaceId={activeWorkspaceId()}
          onSelectWorkspace={handleSelectWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onCreateWorkspace={handleCreateWorkspace}
          onToggleExplorer={handleToggleExplorer}
          onToggleGlobalSearch={handleToggleGlobalSearch}
        />
        <Show when={showFileExplorer()}>
          <FileExplorer
            isOpen={showFileExplorer()}
            rootPaths={explorerPaths()}
            onClose={() => setShowFileExplorer(false)}
            onFileOpen={openEditorTab}
          />
        </Show>
        <div class="terminal-area">
          <For each={editorTabs()}>
            {(tab) => (
              <EditorPane
                tab={tab}
                onClose={() => closeEditorTab(tab.id)}
                onSave={(tabId) => saveEditorTab(tabId)}
              />
            )}
          </For>
          <For each={activeWorkspace()?.paneIds ?? []}>
            {(id) => (
              <TerminalPane sessionId={id} onClosePane={() => handleRemovePane(id)} />
            )}
          </For>
        </div>
        <Show when={showGlobalSearch()}>
          <GlobalSearchOverlay
            isOpen={showGlobalSearch()}
            rootPath={expandPath(activeWorkspace()?.rootPath ?? DEFAULT_PATH)}
            onClose={() => setShowGlobalSearch(false)}
          />
        </Show>
      </div>
    </div>
  );
}

function App() {
  return (
    <TerminalProvider>
      <AppInner />
    </TerminalProvider>
  );
}

export default App;
