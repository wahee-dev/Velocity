export interface Session {
  id: string;
  name: string;
  path: string;
  icon?: 'claude' | 'terminal';
  isActive: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  paneIds: string[];
}

/** File search result — returned by the Rust search_files command */
export interface SearchResult {
  path: string;
  name: string;
}

/** Content search result — returned by the Rust grep_files command */
export interface ContentSearchResult {
  path: string;
  name: string;
  lineNumber: number;
  lineContent: string;
}

export interface AutocompleteEntry {
  value: string;
  kind: 'script' | 'alias' | 'file' | 'history';
}

export interface AutocompleteIndex {
  cwd: string;
  generatedAt: number;
  entries: AutocompleteEntry[];
}

export interface AutocompleteMatch {
  value: string;
  completion: string;
  entry: AutocompleteEntry;
}

export type TerminalInputIntentKind = 'shell' | 'agent';

export interface TerminalInputIntent {
  kind: TerminalInputIntentKind;
  reason: string;
}

export type AgentTaskStatus = 'running' | 'completed' | 'error' | 'reverted';
export type AgentStepKind = 'thinking' | 'read_file' | 'write_file' | 'execute_command' | 'complete' | 'revert';
export type AgentStepStatus = 'running' | 'completed' | 'error' | 'awaiting_confirmation';
export type AgentFileChangeKind = 'created' | 'modified';

export interface AgentTaskStep {
  id: string;
  kind: AgentStepKind;
  label: string;
  detail?: string;
  status: AgentStepStatus;
  timestamp: number;
}

export interface AgentFileChange {
  path: string;
  kind: AgentFileChangeKind;
  summary: string;
  addedLines: number;
  removedLines: number;
  reverted: boolean;
  diff?: string;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  prompt: string;
  status: AgentTaskStatus;
  startedAt: number;
  updatedAt: number;
  summary?: string;
  error?: string;
  steps: AgentTaskStep[];
  changes: AgentFileChange[];
  lastTool?: string;
  canUndo: boolean;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  isExpanded?: boolean;
}

export interface EditorTab {
  id: string;
  filePath: string;
  fileName: string;
  isDirty: boolean;
  language: string;
}

export interface TerminalPane {
  id: string;
  path: string;
  isActive: boolean;
}

export type CommandBlockStatus = 'input' | 'running' | 'success' | 'error' | 'interrupted';

export interface CommandBlock {
  id: string;
  command: string;

  /** Pre-rendered HTML for small outputs. */
  htmlOutput?: string;

  /** Raw ANSI output for medium / large blocks. */
  rawOutput?: string;

  /** True when output capture hit the configured cap. */
  isTruncated: boolean;

  /** Approximate line count for rendering and metadata. */
  lineCount: number;

  /** Stored output size after normalization. */
  outputSizeBytes: number;

  status: CommandBlockStatus;
  timestamp: Date;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  exitCode?: number;
  /** True when this block is a compacted summary of older blocks */
  compacted?: boolean;
  /** How many original blocks this compacted entry represents */
  compactedCount?: number;
}

export interface OutputCapture {
  _chunks: string[];
  byteSize: number;
  lineCount: number;
  isTruncated: boolean;
  isAlternateScreenActive: boolean;
}

export const BLOCK_CONFIG = {
  MAX_RAW_OUTPUT_BYTES: 50 * 1024 * 1024,
  SMALL_OUTPUT_THRESHOLD: 100 * 1024,
  LARGE_OUTPUT_THRESHOLD: 5 * 1024 * 1024,
  PROMPT_DEBOUNCE_MS: 50,
  IDLE_TIMEOUT_MS: 1500,
  VIRTUALIZED_PAGE_SIZE: 50,
  LARGE_OUTPUT_PREVIEW_LINES: 1000,
} as const;

export interface SessionHealthMetrics {
  uptime: number;        // ms since creation
  bytesRead: number;
  commandCount: number;
  lastActivity: number;  // timestamp (ms)
  isIdle: boolean;       // idle > 5 min
}

export interface GitStatus {
  branch: string;
  changes: number;
}

// ── Autocomplete V2 types ──

export interface FlagSpec {
  name: string;
  short?: string;
  description: string;
  takesValue?: boolean;
  repeatable?: boolean;
}

export interface ArgSpec {
  name: string;
  template?: 'file' | 'folder' | 'command';
  suggestions?: string[];
}

export interface SubcommandSpec {
  name: string;
  description: string;
  flags?: FlagSpec[];
  args?: ArgSpec[];
  subcommands?: SubcommandSpec[];
}

export interface CommandSpec {
  name: string;
  description: string;
  flags?: FlagSpec[];
  args?: ArgSpec[];
  subcommands?: SubcommandSpec[];
}

export type TokenType = 'command' | 'subcommand' | 'flag' | 'arg' | 'unknown';

export interface ParsedToken {
  value: string;
  type: TokenType;
  index: number;
  isPartial: boolean;
}

export interface ParseResult {
  tokens: ParsedToken[];
  command: CommandSpec | null;
  activeSubcommand: SubcommandSpec | null;
  currentToken: ParsedToken | null;
  currentArgSpec: ArgSpec | null;
  rawInput: string;
  query: string;
}

export interface Suggestion {
  display: string;
  value: string;
  description?: string;
  icon?: string;
  type: 'command' | 'subcommand' | 'flag' | 'arg' | 'file' | 'history';
  matchedIndices?: number[];
}

export interface FuzzyResult {
  score: number;
  matches: number[];
}

export interface TerminalSession {
  id: string;
  path: string;
  blocks: CommandBlock[];
  agentTasks: AgentTask[];
  inputValue: string;
  showWelcome: boolean;
  isActive: boolean;
  gitStatus: GitStatus;
}
