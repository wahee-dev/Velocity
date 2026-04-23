/* @solid */
import { createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { AutocompleteEntry, AutocompleteIndex, AutocompleteMatch, CommandBlock } from "../types";

const EMPTY_INDEX: AutocompleteIndex = {
  cwd: "",
  generatedAt: 0,
  entries: [],
};

const MAX_HISTORY_ENTRIES = 50;

function extractHistoryEntries(blocks: CommandBlock[]): AutocompleteEntry[] {
  const seen = new Set<string>();
  const results: AutocompleteEntry[] = [];

  // Walk backwards so most recent commands come first
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const cmd = blocks[i].command.trim();
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);
    results.push({ value: cmd, kind: "history" });
    if (results.length >= MAX_HISTORY_ENTRIES) break;
  }

  return results;
}

function getMatchBuckets(entries: AutocompleteEntry[], query: string): AutocompleteEntry[][] {
  const prefersFiles = query.startsWith(".") || query.includes("/") || query.includes("\\");
  if (!prefersFiles) return [entries];

  return [
    entries.filter((e) => e.kind === "file"),
    entries.filter((e) => e.kind !== "file"),
  ];
}

function findAutocompleteMatch(
  index: AutocompleteIndex,
  historyEntries: AutocompleteEntry[],
  inputValue: string,
): AutocompleteMatch | null {
  const leadingWhitespace = inputValue.match(/^\s*/)?.[0] ?? "";
  const query = inputValue.slice(leadingWhitespace.length);
  if (!query) return null;

  const normalizedQuery = query.toLowerCase();

  // Check static index (files, scripts, aliases) first
  for (const bucket of getMatchBuckets(index.entries, query)) {
    for (const entry of bucket) {
      if (entry.value.length <= query.length) continue;
      if (!entry.value.toLowerCase().startsWith(normalizedQuery)) continue;
      return {
        value: `${leadingWhitespace}${entry.value}`,
        completion: entry.value.slice(query.length),
        entry,
      };
    }
  }

  // Fall back to recent prompt history
  for (const entry of historyEntries) {
    if (entry.value.length <= query.length) continue;
    if (!entry.value.toLowerCase().startsWith(normalizedQuery)) continue;
    return {
      value: `${leadingWhitespace}${entry.value}`,
      completion: entry.value.slice(query.length),
      entry,
    };
  }

  return null;
}

export function useAutocomplete(
  cwd: () => string,
  inputValue: () => string,
  blocks: () => CommandBlock[],
) {
  const [index, setIndex] = createSignal<AutocompleteIndex>(EMPTY_INDEX);

  createEffect(() => {
    const nextCwd = cwd().trim();
    if (!nextCwd) {
      setIndex(EMPTY_INDEX);
      return;
    }

    let cancelled = false;
    setIndex({
      cwd: nextCwd,
      generatedAt: Date.now(),
      entries: [],
    });

    invoke<AutocompleteIndex>("build_autocomplete_index", { path: nextCwd })
      .then((result) => {
        if (!cancelled) setIndex(result);
      })
      .catch(() => {
        if (!cancelled)
          setIndex({
            cwd: nextCwd,
            generatedAt: Date.now(),
            entries: [],
          });
      });

    return () => {
      cancelled = true;
    };
  });

  const historyEntries = () => extractHistoryEntries(blocks());

  const suggestion = () => findAutocompleteMatch(index(), historyEntries(), inputValue());
  const acceptSuggestion = () => suggestion()?.value ?? null;

  return { suggestion, acceptSuggestion };
}
