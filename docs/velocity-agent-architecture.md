# Velocity Inline Agent (VIA) — Architecture

## 1. Core Philosophy

The terminal is a **Sequential Layout Engine** where:

- **Completed command blocks** are rendered as static SolidJS components (`CompletedBlock`) with HTML/ANSI output display.
- **The active/running block** uses **xterm.js** with WebGL acceleration for real-time PTY output (`ActiveBlockNode`).
- **Agent task blocks** are rendered as rich SolidJS cards (`AgentBlock`) in a separate layer below the block list.

This hybrid approach gives GPU-accelerated rendering for live terminal I/O while keeping completed history as lightweight DOM nodes.

---

## 2. System Architecture: Dual-Channel Event Model

### A. Rust Backend (`src-tauri/src/`)

#### PTY Manager (`pty.rs`)
- Uses `portable_pty` to spawn interactive shell processes (cmd.exe on Windows, bash/zsh on Unix).
- Each session runs on a background thread that reads stdout in 8KB chunks.
- Output is **batched**: accumulated in a 32KB buffer, flushed every 8ms of silence or when full.
- Emits `pty://output` events with batched data to reduce Tauri event firehose.
- Tracks CWD via OSC 7 escape sequence parsing → emits `cwd-changed` events.
- Emits `pty://closed` on EOF/process exit with exit code.
- Per-session metrics: bytes read, commands seen, uptime, alive status.

#### Agent Manager (`ai.rs`)
- Manages agent tasks via `AgentManager` struct (Arc<Mutex<>> shared state).
- Connects to **Groq API** (`llama-3.3-70b-versatile` model) for LLM responses.
- Tool-use loop: up to 8 iterations of think → tool_call (read_file/write_file/execute_command) → result → final answer.
- Tools: `read_file`, `write_file`, `execute_command` — all with path sandboxing (cannot escape CWD).
- File backup system: before any write, backs up original to `%TEMP%/velocity-agent-backups/{task-id}/`. Undo restores from backup.
- Command validation: blocks destructive patterns (`rm -rf`, `del /f`, `git reset --hard`, etc.).
- Workspace context builder: scans file tree (depth 4, max 200 files) + package.json scripts for agent context.
- API key resolution: searches `.env` in CWD, `src-tauri/.env`, exe directory, and `CARGO_MANIFEST_DIR`.
- **AI utilities** (non-agent):
  - `ai_prompt`: simple chat completion — sends user prompt + generic coding assistant system prompt to Groq, returns response text.
  - `ai_to_command`: natural-language-to-shell converter — sends NL request with instructions to return only a Windows shell command.
  - `predict_next_command`: terminal autocomplete engine — uses `llama-3.1-8b-instant` (~150ms) to predict the next likely command based on command history, CWD, and file listing. Returns sanitized command text.

#### Input Classifier (`ai.rs` → `classify_terminal_input`)
Determines if input should go to shell or agent:
1. Explicit `/agent` prefix → Agent
2. Contains newlines or ends with `?` → Agent
3. Starts with natural language prefixes ("add ", "fix ", "refactor ", etc.) → Agent
4. Contains shell operators (`&&`, `||`, `|`, `>`) → Shell
5. Matches known shell builtins (cd, ls, dir, etc.) → Shell
6. Resolvable executable on PATH or as file path → Shell
7. Multi-word unknown input → Agent
8. Fallback → Agent

#### App State (`lib.rs` → `AppState`)
- Sessions, workspaces, folders, tabs, command history.
- All managed via Tauri's `.manage(Mutex<AppState>)`.
- **35 Tauri commands registered across 13 groups**:

| Group | # | Commands |
|-------|---|----------|
| 1 — Window Controls | 3 | `minimize_window`, `maximize_window`, `close_window` |
| 2 — Sessions | 3 | `search_sessions`, `create_session`, `switch_session` |
| 3 — Terminal Execution (legacy) | 2 | `execute_command` (deprecated), `cancel_command` (deprecated) |
| 4 — Workspace & Folder Mgmt | 4 | `create_workspace`, `create_folder`, `delete_folder`, `rename_folder` |
| 5 — Tab Management | 3 | `open_tab`, `close_tab`, `switch_tab` |
| 6 — AI Features | 7 | `ai_prompt`, `ai_to_command`, `classify_terminal_input`, `predict_next_command`, `start_agent_task`, `revert_agent_task`, `respond_agent_confirmation` |
| 7 — Clipboard & Utilities | 4 | `copy_to_clipboard`, `clear_history`, `open_settings`, `get_system_info` |
| 8 — Pane Controls | 1 | `close_pane` |
| 9 — File Explorer | 3 | `read_dir`, `get_git_status`, `open_file` |
| 9.5 — File Search | 1 | `search_files` |
| 9.75 — Autocomplete | 1 | `build_autocomplete_index` |
| 10 — PTY Multi-Session Manager | 6 | `spawn_pty`, `write_to_pty`, `resize_pty`, `kill_pty`, `list_ptys`, `get_session_metrics` |
| 11 — State Sync | 2 | `get_cwd`, `change_directory` |

### B. Frontend (`src/`)

#### Terminal Context (`context/TerminalContext.tsx`)
Central state provider using SolidJS signals + Map-based session store:
- `sessions: Map<string, TerminalSession>` — each session has blocks, agentTasks, inputValue, gitStatus.
- Actions: createSession, removeSession, appendBlock, updateBlock, setBlockOutput, startAgentTask, revertAgentTask, gcBlocks.
- **Optimistic UI**: `startAgentTask()` inserts a pending placeholder immediately before awaiting Rust invoke, then swaps it for the real task on response (with 3-layer dedup to prevent duplicates from race between invoke resolve and `agent://update` events).
- **Block GC**: `compactOlderBlocks()` keeps last 20 blocks, compacts older success/error/interrupted blocks into a single summary entry.

#### Terminal Pane (`components/TerminalPane/TerminalPane.tsx`)
Main orchestrator (~719 lines):
- Spawns PTY on mount via `spawn_pty` command.
- Listens to `pty://output`, `pty://closed`, `cwd-changed` events.
- Routes input through classification: shell commands go to PTY, agent prompts go to `startAgentTask`.
- **Calls `invoke()` directly** — does NOT use `useTauri.ts` bridge layer (see note below).
- Manages active block lifecycle: creates running block → writes to PTY with exit marker wrapping → captures output via `OutputCapture` hook → detects prompt return via `PromptDetector` → finalizes block with status/duration/exit code.
- Ctrl+C sends `\x03` to PTY, marks block as "interrupted" after 300ms grace period.
- Health polling every 30s for session metrics (uptime, bytes read, idle detection).

> **Architectural Note — IPC Bridge Inconsistency**: `src/hooks/useTauri.ts` provides a typed IPC wrapper used by TitleBar, SessionsSidebar, and FileExplorer. However, **TerminalPane bypasses it entirely**, calling `invoke()` directly for all PTY and agent operations. This means there are two parallel IPC paths: the typed bridge (used by chrome/UI components) and direct invoke (used by the terminal core). The `handleExecuteCommand` / `handleCancelCommand` wrappers in `useTauri.ts` wrap the deprecated legacy `execute_command` / `cancel_command` Rust commands that nothing consumes.

#### Block View (`components/BlockView/BlockView.tsx`)
Renders the scrollable block list:
- Filters blocks into `completedBlocks` (status !== "running") memo.
- Renders each completed block via `<CompletedBlock>`.
- Renders active block via `<ActiveBlockNode>` (xterm.js instance) when present.
- Auto-scrolls to bottom when blocks change or live output updates (smooth scroll for live, auto for initial).

#### Active Block Node (`components/TerminalPane/ActiveBlockNode.tsx`)
xterm.js instance for live terminal rendering:
- Terminal config: Cascadia Code 13px, dark theme, WebGL addon, 5000 line scrollback.
- FitAddon + ResizeObserver for responsive sizing, reports cols/rows back to PTY.
- Exposes `ActiveBlockHandle` interface: write, clear, focus, scrollToBottom, fit, getSize.
- Custom key handler defers to input field when focused.

#### Completed Block (`components/BlockView/CompletedBlock.tsx`)
Static command block display:
- Shows command text (clickable to copy back to input), status indicator, prompt symbol.
- Renders output via `<BlockOutput>` component (HTML for small, raw ANSI for large).
- Footer metadata: status label, duration, line count, output size.
- Compacted blocks show summary only ("N earlier commands (compacted)").

#### Agent Block (`components/AgentBlock/AgentBlock.tsx`)
Rich agent task card:
- Header: live pulse dot (animated when running), "Velocity Agent" title, status badge.
- Prompt display, summary/error message with icon.
- Current step: icon + label + detail (last 4 steps shown, most recent first).
- Changed files list: path, summary, +/- line counts.
- Undo button (enabled when `canUndo = true`, i.e., agent made file changes).

### C. Event Flow Diagram

```
User Input
    │
    ├─ /agent prefix or classified as agent ──→ startAgentTask()
    │                                             │
    │                     ┌───────────────────────┘
    │                     ▼
    │              [Pending Task] ← immediate UI feedback
    │                     │
    │              invoke("start_agent_task") ──→ Rust AgentManager
    │                     │                          │
    │                     │                    Groq API (LLM)
    │                     │                          │
    │              agent://update ◄──────────────────┘
    │              (streaming step updates)
    │                     │
    │              [Real Task replaces pending]
    │
    └─ Shell command ──→ wrapInteractiveCommand() ──→ writeToPty()
                           │                              │
                      [Running Block]              portable-pty (cmd.exe)
                           │                              │
                      pty://output ◄────────────────────┘
                           │
                      xterm.js writes (live render)
                           │
                      Prompt detected ──→ finalizeRunningBlock()
                                              │
                                         [Completed Block]
```

---

## 3. Data Model

### CommandBlock (Terminal Blocks)

**Two shapes exist — Rust struct is a legacy subset; the full model lives entirely on the frontend:**

**Rust shape** (`lib.rs:65-73`) — used only by deprecated `execute_command` path:
```
id, command, output?, status (Input|Running|Success|Error), timestamp
```
Note: No `Interrupted` variant in Rust's `CommandStatus` enum (`lib.rs:77-82`).

**TypeScript shape** (`types/index.ts:100-129`) — the real model used everywhere:
```
id, command, htmlOutput?, rawOutput?, isTruncated,
lineCount, outputSizeBytes, status (input|running|success|error|interrupted),
timestamp, startedAt?, finishedAt?, durationMs?, exitCode?,
compacted?, compactedCount?
```
The block lifecycle (status transitions, timing, truncation) is managed entirely on the frontend by `TerminalPane` + `useOutputCapture`. Rust never sees these fields.

### AgentTask (Agent Blocks)
```
id, sessionId, prompt, status (running|completed|error|reverted),
startedAt, updatedAt, summary?, error?,
steps: [{ id, kind (thinking|read_file|write_file|execute_command|complete|revert),
         label, detail?, status, timestamp }],
changes: [{ path, kind (created|modified), summary, addedLines, removedLines, reverted }],
lastTool?, canUndo
```

### TerminalSession
```
id, path, blocks: CommandBlock[], agentTasks: AgentTask[],
inputValue, showWelcome, isActive, gitStatus: { branch, changes }
```

---

## 4. Special Block UI Components (Current State)

| Component | Status | Description |
|-----------|--------|-------------|
| **Agent Card** | IMPLEMENTED | Rich card with pulse indicator, step timeline, file changes list, undo button |
| **Interactive Diff** | IMPLEMENTED | Syntax-highlighted unified diff viewer in AgentBlock |
| **Action Confirmation** | IMPLEMENTED | Server-side blocks destructive patterns + client-side confirmation dialog via `agent://confirm` event |
| **Knowledge Toast** | IMPLEMENTED | Error popover with docs/fix suggestions |
| **Ghost Command** | IMPLEMENTED | AI-predicted next command via Groq (`llama-3.1-8b-instant`), blue ghost text with Tab/ArrowRight to accept |

---

## 5. Execution Workflow (Actual "Vibe" Path)

1. **Input**: User types into the command input field at bottom of pane.
2. **Classification**: On Enter, input goes through `classify_terminal_input()` (Rust):
   - `/agent fix the login bug` → explicit agent
   - `fix the login bug` → heuristic match (natural language prefix) → agent
   - `npm test` → resolvable executable → shell
3. **Shell Path**: Command wrapped with exit marker → written to PTY → xterm renders live output → prompt detector finalizes block.
4. **Agent Path**:
   - Pending task appears immediately (optimistic UI)
   - Rust builds workspace context (file tree + scripts)
   - Groq LLM receives system prompt + user request + context
   - Agent loops: thinking → read files → write files → run commands → final answer
   - Each step emitted via `agent://update` → frontend updates AgentBlock in real-time
   - On completion: summary shown, undo enabled if files were changed

---

## 6. Key Technical Details

### Output Capture Pipeline
PTY raw bytes → exit marker stripping → ANSI accumulation → size/line counting → truncation at cap → stored as `rawOutput` (or `htmlOutput` for small outputs).

### Exit Marker System
Commands are wrapped in marker sequences that inject a unique exit-code payload into the PTY stream. The parser strips markers from display output while extracting completion signals. This enables reliable block finalization without polling.

### Autocomplete System
Built on-demand index per CWD: package.json scripts, common shell aliases, file tree (depth 3, max 256 entries). Fuzzy matching against input prefix. Tab or ArrowRight to accept.

### Block Compaction (GC)
When block count exceeds threshold (default 20), older completed blocks (success/error/interrupted) are collapsed into a single "N earlier commands (compacted)" entry. Triggered on every `appendBlock` and manually via `gcBlocks()`.

### Security Sandboxing
- Agent file operations confined to task's root CWD (canonical path check prevents traversal)
- Destructive command patterns blocked server-side
- File backups created before any agent write, enabling safe undo

---

## 7. File Map

```
src-tauri/src/
  main.rs          → Entry point
  lib.rs           → AppState, all Tauri commands (~1097 lines), plugin registration
  pty.rs           → PtyManager: spawn, write, resize, kill, metrics, OSC7 CWD tracking
  ai.rs            → AgentManager, AI tools, Groq API client, input classifier (~1483 lines)
  src/
    components/
      TerminalPane/
        TerminalPane.tsx      → Main pane: PTY lifecycle, input routing, block orchestration
        TerminalPane.css      → Pane layout styles
        ActiveBlockNode.tsx   → xterm.js live terminal renderer (WebGL)
      BlockView/
        BlockView.tsx         → Scrollable block list container
        CompletedBlock.tsx    → Static command block display
        BlockOutput.tsx       → Output rendering (HTML/raw/ANSI)
        *.css                 → Block styling (faint horizontal dividers)
      AgentBlock/
        AgentBlock.tsx        → Agent task card UI
        AgentBlock.css        → Agent card styling
      TitleBar/, SessionsSidebar/, FileExplorer/, GlobalSearchOverlay/
    context/
      TerminalContext.tsx     → Central state provider, optimistic UI, block GC
    hooks/
      useAutocomplete.ts      → Fuzzy autocomplete with file/script/alias index
      useAutocompleteV2.ts    → Warp-style autocomplete with context engine + fuzzy matcher
      useGhostCommand.ts      → AI-predicted next command (Groq) with ghost text display
      useOutputCapture.ts     → PTY output capture pipeline
      useTauri.ts             → Typed IPC bridge (used by UI chrome, NOT by TerminalPane)
    utils/
      exitMarker.ts           → Exit marker wrap/parse for block finalization
      promptDetector.ts       → Shell prompt detection for block completion
    types/index.ts            → All TypeScript interfaces
```
