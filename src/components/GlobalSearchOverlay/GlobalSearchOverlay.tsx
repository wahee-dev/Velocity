/* @solid */
import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
  For,
} from "solid-js";
import {
  Search,
  X,
  FileText,
  CaseSensitive,
  Regex,
  Type,
  FileSearch,
} from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import type { SearchResult, ContentSearchResult } from "../../types";
import "./GlobalSearchOverlay.css";

interface GlobalSearchOverlayProps {
  isOpen: boolean;
  rootPath: string;
  onClose: () => void;
}

type SearchMode = "filename" | "content";

export function GlobalSearchOverlay(props: GlobalSearchOverlayProps) {
  const [query, setQuery] = createSignal("");
  const [mode, setMode] = createSignal<SearchMode>("filename");
  const [isCaseSensitive, setIsCaseSensitive] = createSignal(false);
  const [isRegex, setIsRegex] = createSignal(false);
  
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [contentResults, setContentResults] = createSignal<ContentSearchResult[]>([]);
  
  const [isSearching, setIsSearching] = createSignal(false);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  let inputRef: HTMLInputElement | undefined;
  let overlayRef: HTMLDivElement | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  const currentResultsCount = () => 
    mode() === "filename" ? results().length : contentResults().length;

  // Focus input when opened
  createEffect(() => {
    if (props.isOpen) {
      requestAnimationFrame(() => inputRef?.focus());
      setSelectedIndex(0);
    }
  });

  // Keyboard navigation
  createEffect(() => {
    if (!props.isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (currentResultsCount() || 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + (currentResultsCount() || 1)) % (currentResultsCount() || 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (mode() === "filename") {
          const selected = results()[selectedIndex()];
          if (selected) handleSelectResult(selected);
        } else {
          const selected = contentResults()[selectedIndex()];
          if (selected) handleSelectContentResult(selected);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // Click outside to close
  createEffect(() => {
    if (!props.isOpen || !overlayRef) return;

    function onClick(e: MouseEvent) {
      if (overlayRef && !overlayRef.contains(e.target as Node)) props.onClose();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  });

  // Debounced search
  createEffect(() => {
    const q = query();
    const m = mode();
    const cs = isCaseSensitive();
    const rx = isRegex();
    
    if (searchTimer) clearTimeout(searchTimer);

    if (!q.trim()) {
      setResults([]);
      setContentResults([]);
      return;
    }

    searchTimer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (m === "filename") {
          const r = await invoke<SearchResult[]>("search_files", {
            path: props.rootPath,
            query: q.trim(),
          });
          setResults(r);
          setContentResults([]);
        } else {
          const r = await invoke<ContentSearchResult[]>("grep_files", {
            path: props.rootPath,
            pattern: q.trim(),
            isCaseSensitive: cs,
            isRegex: rx,
          });
          setContentResults(r);
          setResults([]);
        }
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search failed:", err);
        setResults([]);
        setContentResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    onCleanup(() => {
      if (searchTimer) clearTimeout(searchTimer);
    });
  });

  async function handleSelectResult(result: SearchResult) {
    try {
      await invoke("open_file", { path: result.path });
      props.onClose();
    } catch {}
  }

  async function handleSelectContentResult(result: ContentSearchResult) {
    try {
      // open_file might need expansion to support line numbers if backend supports it
      // for now just open the file
      await invoke("open_file", { path: result.path });
      props.onClose();
    } catch {}
  }

  if (!props.isOpen) return null;

  return (
    <div
      class="global-search-overlay"
      ref={overlayRef!}
      style={{ opacity: 1 }}
    >
      <div class="search-modal" style={{ opacity: 1 }}>
        <div class="search-input-row">
          <Search size={16} class="modal-search-icon" />
          <input
            ref={inputRef!}
            type="text"
            class="modal-search-input"
            placeholder={mode() === "filename" ? "Search files by name..." : "Search file contents..."}
            value={query()}
            onInput={(e) =>
              setQuery((e.target as HTMLInputElement).value)
            }
          />
          <div class="search-options">
            <button 
              class={`option-btn ${mode() === "content" ? "active" : ""}`}
              onClick={() => setMode(m => m === "filename" ? "content" : "filename")}
              title="Toggle File Content Search"
            >
              <FileSearch size={16} />
            </button>
            <Show when={mode() === "content"}>
              <button 
                class={`option-btn ${isCaseSensitive() ? "active" : ""}`}
                onClick={() => setIsCaseSensitive(v => !v)}
                title="Match Case"
              >
                <CaseSensitive size={16} />
              </button>
              <button 
                class={`option-btn ${isRegex() ? "active" : ""}`}
                onClick={() => setIsRegex(v => !v)}
                title="Use Regular Expression"
              >
                <Regex size={16} />
              </button>
            </Show>
          </div>
          <button class="modal-close-btn" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>

        <div class="search-results-list">
          <Show when={!query().trim()} fallback={
            <Show
              when={isSearching()}
              fallback={
                currentResultsCount() > 0 ? (
                  <Show when={mode() === "filename"} fallback={
                    <For each={contentResults()}>
                      {(result, i) => (
                        <div
                          class={`result-item content-result ${i() === selectedIndex() ? "highlighted" : ""}`}
                          onClick={() => handleSelectContentResult(result)}
                          onMouseEnter={() => setSelectedIndex(i())}
                        >
                          <FileText size={14} class="result-file-icon" />
                          <div class="result-info">
                            <div class="result-header">
                              <span class="result-filename">{result.name}</span>
                              <span class="result-line-number">Line {result.lineNumber}</span>
                            </div>
                            <span class="result-line-content">{result.lineContent}</span>
                            <span class="result-fullpath">{result.path}</span>
                          </div>
                        </div>
                      )}
                    </For>
                  }>
                    <For each={results()}>
                      {(result, i) => (
                        <div
                          class={`result-item ${i() === selectedIndex() ? "highlighted" : ""}`}
                          onClick={() => handleSelectResult(result)}
                          onMouseEnter={() => setSelectedIndex(i())}
                        >
                          <FileText size={14} class="result-file-icon" />
                          <div class="result-info">
                            <span class="result-filename">{result.name}</span>
                            <span class="result-fullpath">{result.path}</span>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                ) : (
                  <div class="results-placeholder">
                    No results found for &ldquo;{query()}&rdquo;
                  </div>
                )
              }
            >
              <div class="results-placeholder">Searching...</div>
            </Show>
          }>
            <div class="results-placeholder">
              Type to start searching {mode() === "filename" ? "files" : "contents"} in this workspace...
            </div>
          </Show>
        </div>

        <div class="search-footer">
          <div class="footer-hints">
            <span>ESC to close</span>
            <span>&uarr;&darr; to navigate</span>
            <span>Enter to open</span>
          </div>
          <span>{currentResultsCount()} result{currentResultsCount() !== 1 ? "s" : ""} found</span>
        </div>
      </div>
    </div>
  );
}

