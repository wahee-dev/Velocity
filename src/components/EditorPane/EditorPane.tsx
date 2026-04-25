/* @solid */
import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Circle } from "lucide-solid";
import type { EditorTab } from "../../types";
import "./EditorPane.css";

interface EditorPaneProps {
  tab: EditorTab;
  onClose: () => void;
  onSave: (tabId: string) => void;
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  json: "json",
  md: "markdown",
  html: "html",
  css: "css",
  scss: "scss",
  less: "less",
  rust: "rs",
  python: "python",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "shellscript",
  bash: "shellscript",
  ps1: "powershell",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  vue: "html",
  svelte: "html",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  h: "cpp",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  lua: "lua",
  env: "plaintext",
  gitignore: "plaintext",
  dockerfile: "dockerfile",
  txt: "plaintext",
  log: "plaintext",
  lock: "json",
};

function detectLanguage(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return "plaintext";
  const ext = fileName.slice(dotIndex + 1).toLowerCase();
  return EXT_LANG_MAP[ext] ?? "plaintext";
}

export function EditorPane(props: EditorPaneProps) {
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [cursorPos, setCursorPos] = createSignal({ line: 1, column: 1 });
  let editorContainerRef: HTMLDivElement | undefined;
  let editorInstance: monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoDispose: (() => void) | undefined;

  const language = () => detectLanguage(props.tab.fileName);

  // Load file content into Monaco on mount
  onMount(async () => {
    try {
      // Dynamic import for tree-shaking / lazy loading
      const monaco = await import("monaco-editor/esm/vs/editor/editor.main.js");

      // Define a dark theme matching Velocity's color scheme
      monaco.editor.defineTheme("velocity-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#000000",
          "editor.foreground": "#e8e8e8",
          "editorLineNumber.foreground": "#444444",
          "editorLineNumber.activeForeground": "#888888",
          "editorCursor.foreground": "#f97316",
          "editor.selectionBackground": "#264f7840",
          "editor.lineHighlightBackground": "#111111",
          "editorIndentGuide.background": "#222222",
          "editorIndentGuide.activeBackground": "#333333",
          "scrollbar.shadow": "#00000000",
          "scrollbarSlider.background": "#33333380",
          "scrollbarSlider.hoverBackground": "#4444480",
          "scrollbarSlider.activeBackground": "#5555580",
          "minimap.background": "#00000000",
          "editor.inactiveSelectionBackground": "#264f7820",
          "editorBracketMatch.background": "#264f7830",
          "editorBracketMatch.border": "#444444",
          "editorGutter.modifiedBackground": "#c084fc30",
          "editorGutter.addedBackground": "#22c55e30",
          "editorGutter.deletedBackground": "#ef444430",
        },
      });

      monaco.editor.setTheme("velocity-dark");

      editorInstance = monaco.editor.create(editorContainerRef!, {
        value: "",
        language: language(),
        theme: "velocity-dark",
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
        fontLigatures: true,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "off",
        tabSize: 2,
        insertSpaces: true,
        renderWhitespace: "selection",
        folding: true,
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, bracketPairs: true },
        padding: { top: 8, bottom: 8 },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        suggest: {
          showKeywords: true,
          showSnippets: true,
        },
        quickSuggestions: {
          other: true,
          comments: false,
          strings: true,
        },
        parameterHints: { enabled: true },
        formatOnPaste: true,
        formatOnType: true,
      });

      // Track cursor position
      editorInstance.onDidChangeCursorPosition((e) => {
        setCursorPos({
          line: e.position.lineNumber,
          column: e.position.column,
        });
      });

      // Mark dirty on content change
      editorInstance.onDidChangeModelContent(() => {
        // Parent manages dirty state via the model value comparison
      });

      // Ctrl+S → save
      editorInstance.addAction({
        id: "save-file",
        label: "Save File",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          handleSave();
          return true;
        },
      });

      // Load file content
      const content = await invoke<string>("read_file_content", {
        path: props.tab.filePath,
      });
      editorInstance.setValue(content);
    } catch (error) {
      console.error("[EditorPane] Failed to initialize:", error);
    }
  });

  onCleanup(() => {
    editorInstance?.dispose();
    monacoDispose?.();
  });

  async function handleSave() {
    if (isSaving()) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const content = editorInstance?.getValue() ?? "";
      await invoke("write_file_content", {
        path: props.tab.filePath,
        content,
      });
      props.onSave(props.tab.id);
    } catch (error) {
      setSaveError(String(error));
      console.error("[EditorPane] Save failed:", error);
    } finally {
      setIsSaving(false);
      // Clear save success feedback after delay
      setTimeout(() => setSaveError(null), 3000);
    }
  }

  function handleClose() {
    props.onClose();
  }

  return (
    <div class="editor-pane">
      <div class="pane-header">
        <div class="editor-title">
          <Show when={props.tab.isDirty}>
            <Circle size={8} class="dirty-dot" fill="#f97316" />
          </Show>
          <span class="editor-filename">{props.tab.fileName}</span>
        </div>
        <div class="pane-actions">
          <button
            class="pane-btn pane-btn-save"
            onClick={handleSave}
            title="Save (Ctrl+S)"
            disabled={isSaving() || !props.tab.isDirty}
          >
            <Save size={13} />
          </button>
          <button class="pane-btn pane-btn-close" onClick={handleClose} title="Close editor">
            <X size={13} />
          </button>
        </div>
      </div>

      <div class="pane-content" ref={editorContainerRef!} />

      <div class="pane-footer">
        <div class="status-bar">
          <span class="path-info">
            <span>{props.tab.filePath}</span>
          </span>
          <span class="cursor-pos">
            Ln {cursorPos().line}, Col {cursorPos().column}
          </span>
          <Show when={isSaving()}>
            <span class="save-status saving">Saving...</span>
          </Show>
          <Show when={saveError() && !isSaving()}>
            <span class="save-status error">{saveError()}</span>
          </Show>
          <Show when={!isSaving() && !saveError() && !props.tab.isDirty}>
            <span class="save-status saved">Saved</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
