/* @solid */
import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { Search, X, FileText } from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import type { SearchResult } from "../../types";
import "./GlobalSearchOverlay.css";

interface GlobalSearchOverlayProps {
  isOpen: boolean;
  rootPath: string;
  onClose: () => void;
}

export function GlobalSearchOverlay(props: GlobalSearchOverlayProps) {
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [isSearching, setIsSearching] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let overlayRef: HTMLDivElement | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Focus input when opened
  createEffect(() => {
    if (props.isOpen) {
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // Escape key to close
  createEffect(() => {
    if (!props.isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    if (searchTimer) clearTimeout(searchTimer);

    if (!q.trim()) {
      setResults([]);
      return;
    }

    searchTimer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const r = await invoke<SearchResult[]>("search_files", {
          path: props.rootPath,
          query: q.trim(),
        });
        setResults(r);
      } catch {
        setResults([]);
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
            placeholder="Search files by name..."
            value={query()}
            onInput={(e) =>
              setQuery((e.target as HTMLInputElement).value)
            }
          />
          <button class="modal-close-btn" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>

        <div class="search-results-list">
          <Show when={!query().trim()} fallback={
            <Show
              when={isSearching()}
              fallback={
                results().length > 0 ? (
                  results().map((result, i) => (
                    <div
                      key={`${result.path}-${i}`}
                      class={`result-item ${i === 0 ? "highlighted" : ""}`}
                      onClick={() => handleSelectResult(result)}
                    >
                      <FileText size={14} class="result-file-icon" />
                      <div class="result-info">
                        <span class="result-filename">{result.name}</span>
                        <span class="result-fullpath">{result.path}</span>
                      </div>
                    </div>
                  ))
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
              Type to start searching files in this workspace...
            </div>
          </Show>
        </div>

        <div class="search-footer">
          <span>ESC to close</span>
          <span>{results().length} file{results().length !== 1 ? "s" : ""} found</span>
        </div>
      </div>
    </div>
  );
}
