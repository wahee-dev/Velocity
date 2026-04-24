/**
 * Warp-style autocomplete hook (V2).
 * Integrates context engine + fuzzy matcher + file system.
 */

/* @solid */
import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  Accessor,
} from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { parseInput, getSuggestions, IMPORTANT_FILES } from '../engine/contextEngine';
import { fuzzyFilter } from '../utils/fuzzyMatch';
import type { Suggestion, CommandBlock, FileNode } from '../types';

interface UseAutocompleteV2Return {
  suggestions: Accessor<Suggestion[]>;
  selectedIndex: Accessor<number>;
  ghostText: Accessor<string>;
  menuVisible: Accessor<boolean>;
  menuPosition: Accessor<{ x: number; y: number }>;
  handleKeyDown: (e: KeyboardEvent) => boolean;
  acceptSuggestion: () => string | null;
  dismissMenu: () => void;
  highlightIndex: (index: number) => void;
  registerInputElement: (el: HTMLInputElement | null) => void;
  triggerPrediction: (lastCommands: string[], cwd: string) => Promise<void>;
}

const INPUT_DEBOUNCE_MS = 30;
const FILE_DEBOUNCE_MS = 200;
const MAX_SUGGESTIONS = 20;

export function useAutocompleteV2(
  cwd: () => string,
  inputValue: () => string,
  cursorPos: () => number,
  blocks: () => CommandBlock[],
): UseAutocompleteV2Return {
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [menuVisible, setMenuVisible] = createSignal(false);
  const [menuPosition, setMenuPosition] = createSignal({ x: 0, y: 0 });
  const [ghostText, setGhostText] = createSignal('');
  const [_fileSuggestions, setFileSuggestions] = createSignal<string[]>([]);
  const [predictionText, setPredictionText] = createSignal('');
  const [systemCommands, setSystemCommands] = createSignal<string[]>([]);
  let systemCommandsLoaded = false;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fileDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let predictionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPredictionTime = 0;
  const PREDICTION_COOLDOWN_MS = 3000;

  // Extract history entries from blocks
  const historyEntries = createMemo<string[]>(() => {
    const seen = new Set<string>();
    const results: string[] = [];
    const blks = blocks();
    for (let i = blks.length - 1; i >= 0; i--) {
      const cmd = blks[i]!.command.trim();
      if (!cmd || seen.has(cmd)) continue;
      seen.add(cmd);
      results.push(cmd);
      if (results.length >= 50) break;
    }
    return results;
  });

  // Parse result — recomputed on every input/cursor change
  const parseResult = createMemo(() => {
    const input = inputValue();
    const pos = cursorPos();
    return parseInput(input, pos);
  });

  // Compute suggestions when input changes
  createEffect(() => {
    const input = inputValue();
    const result = parseResult();

    // Debounce the suggestion computation
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      let suggs = getSuggestions(result, historyEntries());

      // ── Merge system commands for command-type queries ──
      if (result.currentToken?.type === 'command' && result.query) {
        // Lazy-load system commands once
        if (!systemCommandsLoaded) {
          systemCommandsLoaded = true;
          invoke<string[]>('get_system_commands')
            .then((cmds) => setSystemCommands(cmds))
            .catch(() => {}); // silently fail
        }

        // Merge: FIG specs first (with descriptions), then matching system commands
        const sysCmds = systemCommands();
        if (sysCmds.length > 0) {
          const figValues = new Set(suggs.map((s) => s.value));
          const filteredSys = fuzzyFilter(result.query, sysCmds)
            .filter((f) => !figValues.has(f.item))
            .slice(0, 10)
            .map((f) => ({
              display: f.item,
              value: f.item,
              type: 'command' as const,
              icon: '📦',
              matchedIndices: f.matches,
            }));
          suggs = [...suggs, ...filteredSys];
        }
      }

      setSuggestions(suggs.slice(0, MAX_SUGGESTIONS));
      setSelectedIndex(suggs.length > 0 ? 0 : -1);

      // Update ghost text to top suggestion
      if (suggs.length > 0 && result.query) {
        const top = suggs[0]!;
        const completion = top.value.startsWith(result.query)
          ? top.value.slice(result.query.length)
          : top.value;
        setGhostText(completion);
        setPredictionText(''); // clear prediction when user types
        setMenuVisible(true);
      } else if (suggs.length > 0 && !result.query && result.currentToken?.type === 'subcommand') {
        // Show subcommand list even with empty query after command
        setGhostText('');
        setMenuVisible(true);
      } else {
        // When input is empty, show AI prediction as ghost text
        const pred = predictionText();
        if (!input.trim() && pred) {
          setGhostText(pred);
        } else {
          setGhostText('');
        }
        setMenuVisible(input.trim().length > 0 && suggs.length > 0);
      }
    }, INPUT_DEBOUNCE_MS);

    // Check if we need file/folder suggestions
    const isLsFolderMode = result.command?.name === 'ls'
      && result.currentToken?.type === 'arg'
      && result.currentArgSpec?.template === 'folder';

    if (result.currentArgSpec?.template === 'file' || result.currentArgSpec?.template === 'folder') {
      if (fileDebounceTimer) clearTimeout(fileDebounceTimer);
      fileDebounceTimer = setTimeout(() => {
        const searchPath = cwd().trim() || '.';
        invoke<FileNode[]>('read_dir', { path: searchPath })
          .then((nodes) => {
            const q = result.query;

            if (isLsFolderMode) {
              // ── ls mode: folders FIRST, then files ──
              const folders = nodes.filter((n) => n.node_type === 'Folder');
              const files = nodes.filter((n) => n.node_type === 'File');

              let matchedFolders = folders.map((n) => n.name);
              let matchedFiles = files.map((n) => n.name);

              // Fuzzy filter by query
              if (q) {
                const fFolderResult = fuzzyFilter(q, matchedFolders);
                const fFileResult = fuzzyFilter(q, matchedFiles);
                matchedFolders = fFolderResult.map((f) => f.item);
                matchedFiles = fFileResult.map((f) => f.item);
              }

              // Build suggestions: folders first 📁, then files 📄
              const lsSuggs: Suggestion[] = [
                ...matchedFolders.slice(0, MAX_SUGGESTIONS).map((name) => ({
                  display: name,
                  value: name,
                  type: 'file' as const,
                  icon: '📁',
                  description: 'folder',
                })),
                ...matchedFiles.slice(0, MAX_SUGGESTIONS).map((name) => ({
                  display: name,
                  value: name,
                  type: 'file' as const,
                  icon: IMPORTANT_FILES.has(name) ? '⭐' : '📄',
                })),
              ].slice(0, MAX_SUGGESTIONS);

              // REPLACE suggestions (ls mode = filesystem is primary)
              setSuggestions(lsSuggs);
              setSelectedIndex(lsSuggs.length > 0 ? 0 : -1);
              setMenuVisible(lsSuggs.length > 0);

              // Update ghost text from top folder result
              if (lsSuggs.length > 0 && q) {
                const top = lsSuggs[0]!;
                const completion = top.value.startsWith(q)
                  ? top.value.slice(q.length)
                  : top.value;
                setGhostText(completion);
              } else if (lsSuggs.length > 0 && !q) {
                setGhostText('');
              }
            } else {
              // ── Standard mode: append to existing suggestions ──
              const allNames = nodes.map((n) => n.name);
              let filtered = allNames;
              if (q) {
                filtered = fuzzyFilter(q, allNames).map((f) => f.item);
              }
              setFileSuggestions(filtered.slice(0, MAX_SUGGESTIONS));

              const fileSuggs: Suggestion[] = filtered.slice(0, MAX_SUGGESTIONS)
                .map((name) => {
                  const node = nodes.find((n) => n.name === name);
                  return {
                    display: name,
                    value: name,
                    type: 'file' as const,
                    icon: node?.node_type === 'Folder' ? '📁'
                      : IMPORTANT_FILES.has(name) ? '⭐' : '📄',
                    score: (node?.node_type === 'Folder' ? 2 : 0)
                      + (IMPORTANT_FILES.has(name) ? 1 : 0),
                  };
                })
                .sort((a, b) => {
                  if ((a as any).score !== (b as any).score) return (b as any).score - (a as any).score;
                  return a.display.localeCompare(b.display);
                })
                .map(({ score, ...rest }: any) => rest);
              setSuggestions((prev) => {
                const existing = new Set(prev.map((s) => s.value));
                const newFiles = fileSuggs.filter((f) => !existing.has(f.value));
                return [...prev, ...newFiles].slice(0, MAX_SUGGESTIONS);
              });
            }
          })
          .catch(() => setFileSuggestions([]));
      }, FILE_DEBOUNCE_MS);
    } else {
      setFileSuggestions([]);
    }

    onCleanup(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (fileDebounceTimer) clearTimeout(fileDebounceTimer);
    });
  });

  function handleKeyDown(e: KeyboardEvent): boolean {
    const suggs = suggestions();
    const visible = menuVisible();

    // Arrow down — cycle through suggestions
    if (e.key === 'ArrowDown' && visible) {
      e.preventDefault();
      const next = selectedIndex() < suggs.length - 1 ? selectedIndex() + 1 : 0;
      setSelectedIndex(next);
      updateGhostFromSelection(next, suggs);
      return true;
    }

    // Arrow up — cycle backwards
    if (e.key === 'ArrowUp' && visible) {
      e.preventDefault();
      const prev = selectedIndex() <= 0 ? suggs.length - 1 : selectedIndex() - 1;
      setSelectedIndex(prev);
      updateGhostFromSelection(prev, suggs);
      return true;
    }

    // Tab — accept selected or top suggestion
    if (e.key === 'Tab' && visible && suggs.length > 0) {
      e.preventDefault();
      acceptCurrentSelection(suggs);
      return true;
    }

    // Escape — dismiss menu
    if (e.key === 'Escape' && visible) {
      e.preventDefault();
      dismissMenu();
      return true;
    }

    // Enter with menu open — accept selection
    if (e.key === 'Enter' && visible && suggs.length > 0 && selectedIndex() >= 0) {
      e.preventDefault();
      acceptCurrentSelection(suggs);
      return false; // Let caller handle actual execution
    }

    return false;
  }

  function updateGhostFromSelection(index: number, suggs: Suggestion[]) {
    if (index < 0 || index >= suggs.length) {
      setGhostText(ghostText()); // keep current ghost
      return;
    }
    const sel = suggs[index]!;
    const result = parseResult();
    const completion = sel.value.startsWith(result.query)
      ? sel.value.slice(result.query.length)
      : sel.value;
    setGhostText(completion);
  }

  function acceptCurrentSelection(suggs: Suggestion[]) {
    const idx = selectedIndex();
    const sel = idx >= 0 ? suggs[idx] : suggs[0];
    if (!sel) return;

    const result = parseResult();
    const q = result.query;
    const inputValueStr = inputValue();

    // Replace the partial token at cursor with the full suggestion value
    let newValue: string;
    if (q && result.currentToken) {
      // Find where the partial token starts in the input
      const tokenStart = findTokenStart(inputValueStr, cursorPos(), q);
      newValue = inputValueStr.slice(0, tokenStart) + sel.value + inputValueStr.slice(cursorPos());
    } else {
      // Appending after a space
      newValue = inputValueStr + (inputValueStr.endsWith(' ') ? '' : ' ') + sel.value;
    }

    setGhostText('');
    setMenuVisible(false);
    setSelectedIndex(-1);

    // Return the new value for the caller to apply
    // We store it temporarily so acceptSuggestion can return it
    (handleKeyDown as any).__acceptedValue = newValue;
  }

  function acceptSuggestion(): string | null {
    const val = (handleKeyDown as any).__acceptedValue ?? null;
    delete (handleKeyDown as any).__acceptedValue;
    return val;
  }

  function dismissMenu() {
    setMenuVisible(false);
    setSelectedIndex(-1);
  }

  function highlightIndex(index: number) {
    setSelectedIndex(index);
    const suggs = suggestions();
    if (index >= 0 && index < suggs.length) {
      updateGhostFromSelection(index, suggs);
    }
  }

  let inputElement: HTMLInputElement | null = null;

  function registerInputElement(el: HTMLInputElement | null) {
    inputElement = el;
  }

  // Update menu position when visibility changes
  createEffect(() => {
    if (menuVisible() && inputElement) {
      const rect = inputElement.getBoundingClientRect();
      setMenuPosition({
        x: rect.left,
        y: rect.bottom + 4,
      });
    }
  });

  async function triggerPrediction(lastCommands: string[], cwd: string): Promise<void> {
    // Cooldown: don't spam Groq API
    const now = Date.now();
    if (now - lastPredictionTime < PREDICTION_COOLDOWN_MS) return;
    lastPredictionTime = now;

    // Gather file snapshot (top 10 names)
    let lsSnapshot = '';
    try {
      const nodes = await invoke<FileNode[]>('read_dir', { path: cwd || '.' });
      lsSnapshot = nodes.slice(0, 10).map((n) => n.name).join(', ');
    } catch {
      // Silently continue without file context
    }

    try {
      const result = await invoke<string>('predict_next_command', {
        history: lastCommands.slice(-5),
        cwd,
        lsSnapshot,
      });
      setPredictionText(result);
      // If input is still empty, show prediction as ghost text
      if (!inputValue().trim()) {
        setGhostText(result);
      }
    } catch {
      // No API key or error — silently clear
      setPredictionText('');
    }
  }

  return {
    suggestions,
    selectedIndex,
    ghostText,
    menuVisible,
    menuPosition,
    handleKeyDown,
    acceptSuggestion,
    dismissMenu,
    highlightIndex,
    registerInputElement,
    triggerPrediction,
  };
}

function findTokenStart(input: string, cursorPos: number, _query: string): number {
  // Walk backwards from cursor to find start of current token
  let start = cursorPos;
  while (start > 0 && !isTokenBoundary(input[start - 1]!)) {
    start--;
  }
  return start;
}

function isTokenBoundary(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '|' || ch === '>' || ch === '<' || ch === '&' || ch === ';';
}
