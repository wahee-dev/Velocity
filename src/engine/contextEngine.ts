/**
 * Context parser & suggestion provider for Warp-style autocomplete.
 * Tokenizes shell input, matches against COMMAND_SPECS, returns contextual suggestions.
 */

import { COMMAND_SPECS } from '../data/commandSpecs';
import type {
  CommandSpec,
  SubcommandSpec,
  ArgSpec,
  ParsedToken,
  ParseResult,
  Suggestion,
} from '../types';
import { fuzzyFilter, fuzzyMatch } from '../utils/fuzzyMatch';

// ── Importance Constants ──

export const IMPORTANT_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'Cargo.toml', 'Cargo.lock', '.env', '.env.local',
  'tsconfig.json', 'vite.config.ts', 'tailwind.config.js',
  'next.config.js', '.gitignore', 'README.md', 'Dockerfile',
  'docker-compose.yml', 'Makefile',
]);

const COMMON_SUBCOMMANDS = new Set([
  'commit', 'push', 'pull', 'checkout', 'add', 'status', 'diff', 'log',
  'install', 'run', 'test', 'build', 'dev', 'up', 'down', 'logs', 'ps',
]);

// ── Tokenizer ──

const BOUNDARY_CHARS = new Set([' ', '\t', '|', '>', '<', '&', ';', '(', ')']);

function tokenize(input: string, cursorPos: number): ParsedToken[] {
  const tokens: ParsedToken[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  let tokenStart = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      continue;
    }

    if (BOUNDARY_CHARS.has(ch)) {
      if (current.length > 0) {
        tokens.push({
          value: current,
          type: 'unknown',
          index: tokens.length,
          isPartial: cursorPos >= tokenStart && cursorPos < i,
        });
        current = '';
        tokenStart = i + 1;
      } else {
        tokenStart = i + 1;
      }
      continue;
    }

    if (!current) tokenStart = i;
    current += ch;
  }

  // Handle last token
  if (current.length > 0 || (tokens.length === 0 && !input.trim())) {
    const endPos = input.length;
    const isPartial = cursorPos >= tokenStart && cursorPos >= tokenStart && cursorPos <= endPos;
    // If we're at the very end after the last char, it's a partial (typing new token)
    const atEnd = cursorPos === endPos && (current.length > 0 || !input.endsWith(' '));
    tokens.push({
      value: current,
      type: 'unknown',
      index: tokens.length,
      isPartial: isPartial || atEnd,
    });
  }

  return tokens;
}

// ── Parser ──

/**
 * Parse shell input into structured context for autocomplete.
 */
export function parseInput(input: string, cursorPos: number): ParseResult {
  const trimmedLeading = input.slice(0, cursorPos);
  const rawInput = trimmedLeading;
  const tokens = tokenize(rawInput, cursorPos);

  // Determine query — text of the partial/current token
  let query = '';
  let currentToken: ParsedToken | null = null;

  for (const tok of tokens) {
    if (tok.isPartial) {
      currentToken = tok;
      query = tok.value;
      break;
    }
  }

  // If no partial token, cursor is after last complete token → empty query (new token)
  if (!currentToken && tokens.length > 0) {
    const lastTok = tokens[tokens.length - 1]!;
    // Check if cursor is right after this token (space after it)
    if (cursorPos > rawInput.lastIndexOf(lastTok.value) + lastTok.value.length) {
      query = '';
      currentToken = { value: '', type: 'unknown', index: tokens.length, isPartial: true };
    }
  }

  // If no tokens at all or only whitespace
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0]!.value === '' && !query)) {
    return {
      tokens,
      command: null,
      activeSubcommand: null,
      currentToken: currentToken ?? { value: '', type: 'command', index: 0, isPartial: true },
      currentArgSpec: null,
      rawInput,
      query: rawInput.trim() || '',
    };
  }

  // Match first token as command
  const firstToken = tokens[0]!;
  const command: CommandSpec | null = COMMAND_SPECS.get(firstToken.value.toLowerCase()) ?? null;

  if (!command) {
    // Unknown command — treat first token as command-type query
    if (!currentToken || currentToken.index === 0) {
      return {
        tokens,
        command: null,
        activeSubcommand: null,
        currentToken: currentToken ?? firstToken,
        currentArgSpec: null,
        rawInput,
        query: currentToken?.value ?? firstToken.value,
      };
    }
    return {
      tokens,
      command: null,
      activeSubcommand: null,
      currentToken,
      currentArgSpec: null,
      rawInput,
      query,
    };
  }

  // Classify tokens: command → subcommands → flags → args
  let activeSubcommand: SubcommandSpec | null = null;
  let currentFlags: string[] = [];
  let argIndex = 0;
  let currentArgSpec: ArgSpec | null = null;

  // Walk tokens starting from index 1 (after command)
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;

    if (tok.isPartial) {
      // This is the token under cursor — determine what it should be
      if (activeSubcommand?.subcommands && !hasConsumedSubcommand(tokens, i)) {
        tok.type = 'subcommand';
      } else if (tok.value.startsWith('-')) {
        tok.type = 'flag';
      } else {
        tok.type = 'arg';
        // Find which arg spec we're at
        const specSource = activeSubcommand ?? command;
        const allArgs = specSource?.args ?? [];
        if (argIndex < allArgs.length) {
          currentArgSpec = allArgs[argIndex]!;
        }
      }
      continue;
    }

    // Classify completed tokens
    if (tok.value.startsWith('-')) {
      tok.type = 'flag';
      currentFlags.push(tok.value.replace(/^-+/, '').split('=')[0] ?? '');
      continue;
    }

    // Check if this could be a subcommand
    if (activeSubcommand === null && command.subcommands) {
      const match = command.subcommands.find(
        (s) => s.name === tok.value || s.name.startsWith(tok.value),
      );
      if (match) {
        tok.type = 'subcommand';
        activeSubcommand = match;
        currentFlags = [];
        argIndex = 0;
        continue;
      }
    }

    // Deeper subcommands
    if (activeSubcommand?.subcommands) {
      const deepMatch: SubcommandSpec | undefined = activeSubcommand.subcommands.find(
        (s) => s.name === tok.value,
      );
      if (deepMatch) {
        tok.type = 'subcommand';
        activeSubcommand = deepMatch;
        currentFlags = [];
        argIndex = 0;
        continue;
      }
    }

    // It's an argument
    tok.type = 'arg';
    const specSource = activeSubcommand ?? command;
    const allArgs = specSource?.args ?? [];
    if (argIndex < allArgs.length) {
      currentArgSpec = allArgs[argIndex]!;
    }
    argIndex++;
  }

  // If currentToken wasn't set yet but we have a command with subcommands and only 1 token
  if (!currentToken && tokens.length === 1 && command.subcommands) {
    currentToken = { value: '', type: 'subcommand', index: 1, isPartial: true };
  }

  return {
    tokens,
    command,
    activeSubcommand,
    currentToken: currentToken ?? { value: '', type: 'unknown', index: tokens.length, isPartial: true },
    currentArgSpec,
    rawInput,
    query,
  };
}

function hasConsumedSubcommand(tokens: ParsedToken[], upTo: number): boolean {
  for (let i = 1; i < upTo; i++) {
    if (tokens[i]?.type === 'subcommand') return true;
  }
  return false;
}

// ── Smart Ranking ──

/**
 * Re-rank suggestions by context: recent history, important files, common subcommands.
 * Combined score = fuzzyScore (implicit via ordering) + contextBonus.
 */
export function rankSuggestions(
  suggestions: Suggestion[],
  opts: { historyEntries?: string[]; query: string },
): Suggestion[] {
  const { historyEntries, query } = opts;
  if (suggestions.length === 0) return suggestions;

  const q = query.toLowerCase();
  const scored = suggestions.map((s, i) => {
    let bonus = 0;
    const val = s.value.toLowerCase();

    // History recency bonus
    if (historyEntries) {
      for (let h = 0; h < historyEntries.length && h < 50; h++) {
        const entry = historyEntries[h]!.toLowerCase();
        // Exact match with history entry
        if (entry === val || entry.startsWith(val + ' ') || entry.endsWith(' ' + val)) {
          bonus += h < 10 ? 60 : 20;
          break;
        }
        // Command in history (first word matches)
        const histCmd = entry.split(/[\s|&;]/)[0];
        if (histCmd === val) {
          bonus += h < 10 ? 50 : 20;
          break;
        }
      }
    }

    // Important file bonus
    if (IMPORTANT_FILES.has(s.value) || IMPORTANT_FILES.has(s.display)) {
      bonus += 40;
    }

    // Common subcommand bonus
    if (COMMON_SUBCOMMANDS.has(val)) {
      bonus += 30;
    }

    // Prefix match bonus
    if (val.startsWith(q) && q.length > 0) {
      bonus += 15;
    }

    // Preserve relative fuzzy order as base score (higher index = lower original rank)
    const baseScore = (suggestions.length - i) * 10;

    return { suggestion: s, score: baseScore + bonus };
  });

  // Sort by combined score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.suggestion);
}

// ── Suggestion Provider ──

/**
 * Given parsed context, return appropriate suggestions.
 */
export function getSuggestions(parseResult: ParseResult, historyEntries?: string[]): Suggestion[] {
  const { command, activeSubcommand, currentToken, currentArgSpec, query } = parseResult;

  if (!currentToken || query === undefined) return [];

  const q = query.toLowerCase();

  switch (currentToken.type) {
    case 'command': {
      // Suggest commands matching query
      const cmds = Array.from(COMMAND_SPECS.keys());
      const filtered = fuzzyFilter(q, cmds);
      const suggs = filtered.map((f) => ({
        display: f.item,
        value: f.item,
        description: COMMAND_SPECS.get(f.item)?.description,
        type: 'command' as const,
        matchedIndices: f.matches,
      }));
      return rankSuggestions(suggs, { historyEntries, query: q });
    }

    case 'subcommand': {
      // Suggest subcommands
      const subs = (activeSubcommand?.subcommands ?? command?.subcommands) ?? [];
      if (subs.length === 0) return [];

      const names = subs.map((s) => s.name);
      const filtered = fuzzyFilter(q, names);

      const suggs = filtered.map((f) => {
        const spec = subs.find((s) => s.name === f.item)!;
        return {
          display: f.item,
          value: f.item,
          description: spec.description,
          type: 'subcommand' as const,
          matchedIndices: f.matches,
        };
      });
      return rankSuggestions(suggs, { historyEntries, query: q });
    }

    case 'flag': {
      // Suggest available flags not yet used
      const specSource = activeSubcommand ?? command;
      const flags = specSource?.flags ?? [];
      if (flags.length === 0) return [];

      const flagPrefix = query.startsWith('--') ? '--' : query.startsWith('-') ? '-' : '';
      const flagQuery = flagPrefix ? query.slice(flagPrefix.length) : query;

      const available = flags.filter(() => {
        // Show all flags, let user pick
        return true;
      });

      const results: Suggestion[] = [];
      for (const flag of available) {
        const longName = `--${flag.name}`;
        const shortName = flag.short ? `-${flag.short}` : '';

        // Match against both long and short form
        const longMatch = flagQuery ? fuzzyMatch(flagQuery, flag.name) : null;
        const shortMatch = flagQuery && flag.short ? fuzzyMatch(flagQuery, flag.short) : null;

        if (!flagQuery || longMatch || shortMatch) {
          results.push({
            display: longName,
            value: flag.takesValue ? `${longName}=` : longName,
            description: flag.description,
            icon: '⚡',
            type: 'flag' as const,
            matchedIndices: longMatch?.matches,
          });
          if (shortName && shortName !== longName) {
            results.push({
              display: shortName,
              value: flag.takesValue ? `${shortName} ` : shortName,
              description: flag.description,
              icon: '⚡',
              type: 'flag' as const,
              matchedIndices: shortMatch?.matches,
            });
          }
        }
      }

      // Sort: prefix matches first, then by relevance
      results.sort((a, b) => {
        const aStartsWith = a.display.toLowerCase().startsWith(flagQuery);
        const bStartsWith = b.display.toLowerCase().startsWith(flagQuery);
        if (aStartsWith !== bStartsWith) return aStartsWith ? -1 : 1;
        return a.display.localeCompare(b.display);
      });

      return rankSuggestions(results.slice(0, 20), { historyEntries, query: q });
    }

    case 'arg': {
      // For ls + folder arg: let hook handle filesystem suggestions exclusively
      if (command?.name === 'ls' && currentArgSpec?.template === 'folder') {
        return [];
      }

      const results: Suggestion[] = [];

      // Static suggestions from arg spec
      if (currentArgSpec?.suggestions) {
        const staticFiltered = fuzzyFilter(q, currentArgSpec.suggestions);
        for (const f of staticFiltered) {
          results.push({
            display: f.item,
            value: f.item,
            type: 'arg' as const,
            matchedIndices: f.matches,
          });
        }
      }

      // History entries as fallback
      if (historyEntries && historyEntries.length > 0) {
        const histFiltered = fuzzyFilter(q, historyEntries).slice(0, 5);
        for (const f of histFiltered) {
          if (!results.some((r) => r.value === f.item)) {
            results.push({
              display: f.item,
              value: f.item,
              type: 'history' as const,
              icon: '🕐',
              matchedIndices: f.matches,
            });
          }
        }
      }

      return rankSuggestions(results, { historyEntries, query: q });
    }

    default:
      // Unknown / fallback: suggest commands
      if (q.length === 0) return [];
      const cmds = Array.from(COMMAND_SPECS.keys());
      const filtered = fuzzyFilter(q, cmds).slice(0, 10);
      const suggs = filtered.map((f) => ({
        display: f.item,
        value: f.item,
        description: COMMAND_SPECS.get(f.item)?.description,
        type: 'command' as const,
        matchedIndices: f.matches,
      }));
      return rankSuggestions(suggs, { historyEntries, query: q });
  }
}
