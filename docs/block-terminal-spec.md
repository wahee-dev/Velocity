# Block-Based Terminal Architecture — Implementation Spec

## 1. Overview

Transform Velocity from a streaming xterm.js terminal into a **Warp-style block-based terminal**. Each shell command becomes a discrete, scrollable block. Completed commands render as lightweight static HTML. Only the active (running/current) block uses xterm.js + WebGL.

### Current Architecture (What We Have Today)

```
TerminalPane
├── xterm.js canvas (full streaming terminal)
│   └── All PTY output paints here in real-time
├── Command input (HTML <input>)
├── Agent task overlays
└── Status bar
```

User types command -> sends to PTY via `write_to_pty` -> PTY streams output back via `pty://output` events -> xterm.js paints everything to one canvas. No concept of "command boundaries."

### Target Architecture (What We're Building)

```
TerminalPane
├── BlockList (scrollable container, virtualized)
│   ├── Block[0]  (completed)  → Static HTML  ← ansi-to-html
│   ├── Block[1]  (completed)  → Static HTML
│   ├── Block[2]  (active)     → xterm.js + WebGL  ← only ONE instance
│   └── [virtualized: off-screen blocks not rendered]
├── Command input (HTML <input>) — same as now
├── Agent task overlays
└── Status bar
```

---

## 2. Core Concepts

### 2.1 What Is a "Block"?

A block represents **one command cycle**: user typed a command, pressed Enter, got output, shell returned to prompt.

```
┌─ Block ─────────────────────────────────────┐
│  $ npm test                                 │  ← command text (read-only)
│                                             │
│  > @velocity/cli@0.1.0 test               │  ← output (static HTML)
│  > jest                                     │
│                                             │
│  PASS  src/utils/test.ts                    │
│  PASS  src/components/test.tsx              │
│                                             │
│  Test Suites: 2 passed, 2 total            │
│  Tests:       12 passed, 12 total          │
│  Time:        1.234 s                      │
│                                             │
│  ✓ exit code 0  ·  1.2s  ·  12 lines      │  ← metadata footer
└─────────────────────────────────────────────┘
```

### 2.2 Block Lifecycle

```
[input] → [running] → [success | error | interrupted]
   ↑         ↓
   │    PTY streams output in real-time
   │    (rendered by xterm.js active block)
   ↓
 User presses Enter
```

| State | Meaning | Rendering |
|-------|---------|-----------|
| `input` | Command typed but not submitted | N/A (lives in input field) |
| `running` | Command executing, PTY active | **xterm.js + WebGL** (live) |
| `success` | Command finished, exit code 0 | **Static HTML** (ansi-to-html) |
| `error` | Command finished, non-zero exit | **Static HTML** (red-tinted) |
| `interrupted` | User sent Ctrl+C | **Static HTML** (partial output) |

### 2.3 Completed Blocks Are Dumb HTML

Once a command finishes:
- Capture the raw ANSI output from the PTY
- Convert to styled `<span>` elements via `ansi-to-html`
- Store as a string of HTML
- Render as `dangerouslySetInnerHTML` (or a React component wrapping it)
- **No xterm instance. No canvas. No event listeners. No WebGL context.**

A completed block with 500 lines of `ls -la` output = ~10-50KB of DOM. Negligible.

---

## 3. Prompt Detection (The Hardest Problem)

Shells do not natively signal "I'm at a prompt now." We must detect it from PTY output patterns.

### 3.1 Primary Signal: OSC 7 CWD Escape Sequence

**We already have this working.** The Rust backend (`pty.rs`) detects OSC 7 sequences and emits `cwd-changed` events.

```rust
// pty.rs line 218-225 — already implemented
if let Some(new_cwd) = extract_osc7_cwd(data) {
    *emit_cwd.lock().unwrap() = new_cwd.clone();
    let _ = app.emit("cwd-changed", serde_json::json!({
        "sessionId": &emit_session,
        "paneId": &emit_pane_id,
        "cwd": &new_cwd,
    }));
}
```

**Strategy:** When we receive a `cwd-changed` event AND we have a running block, the shell has likely returned to prompt. Debounce by 300-500ms to avoid false positives during rapid `cd` commands.

**This is our main prompt detection mechanism. It works for:**
- bash (via `PROMPT_COMMAND`)
- zsh (via `precmd`)
- cmd.exe (via `$P$G` prompt pattern — partially)

### 3.2 Secondary Signal: Idle Timeout

If no PTY output for N seconds (configurable, default 2s) AND we have a running block, assume prompt returned.

Useful as a fallback when OSC 7 isn't available or reliable.

### 3.3 What Breaks Detection

These scenarios will confuse prompt detection:

| Scenario | Issue | Mitigation |
|----------|-------|------------|
| vim / nano / htop | Full-screen app takes over terminal | Detect alternate screen buffer mode, skip blockification |
| `sudo` password prompt | Pauses waiting for input, no CWD change | Idle timeout won't fire if user is typing; accept imperfection |
| Interactive prompts (yes/no) | Same as above | Accept imperfection |
| Multi-line commands (heredocs) | Multiple "prompts" before execution | Debounce helps here |
| `ssh` into another machine | Remote shell's OSC 7 may not propagate | Fall back to idle timeout |

**Phase 1 stance:** Handle the common cases well (normal command execution). Edge cases can be improved later. Warp spent years on this — we don't need to match them day one.

---

## 4. Output Capture Strategy

### 4.1 The Fundamental Challenge

Currently, PTY output goes directly to xterm.js via `term.write()`:

```typescript
// TerminalPane.tsx line 172-173 — current code
if (event.payload.sessionId === ptySessionIdRef.current) {
  term.write(event.payload.data);  // straight to canvas, gone forever
}
```

We lose the output. Once painted to the xterm canvas, we can't extract it back reliably (xterm's buffer API is limited and slow).

### 4.2 Solution: Intercept Before xterm

```
PTY Output Event
     │
     ▼
┌─────────────┐
│ OutputBuffer │  ← NEW: accumulate raw bytes per active block
│ (per-block)  │
└──────┬──────┘
       │
       ├─→ term.write(data)  → xterm renders live (existing behavior)
       │
       └─→ buffer.append(data)  → capture for later HTML conversion (NEW)
```

Every byte that goes to xterm also gets appended to an output buffer tied to the currently running block.

### 4.3 OutputBuffer Interface

```typescript
interface OutputCapture {
  /** Raw ANSI string accumulated since command start */
  rawOutput: string;
  /** Byte size tracker for large-output guard */
  byteSize: number;
  /** Whether we hit the size limit */
  isTruncated: boolean;
  /** Line count estimate */
  lineCount: number;
}

// Constants
const MAX_RAW_OUTPUT_BYTES = 50 * 1024 * 1024; // 50MB hard cap per block
const SMALL_OUTPUT_THRESHOLD = 100 * 1024;      // 100KB = "small", fully render as HTML
```

### 4.4 When Command Finishes

```
Block transitions from 'running' → 'success'/'error'

1. Take captured rawOutput from OutputCapture
2. If byteSize < SMALL_OUTPUT_THRESHOLD:
   → Convert ENTIRE output to HTML via ansi-to-html
   → Store as block.htmlOutput (string)
   → Render as static DOM
3. If byteSize >= SMALL_OUTPUT_THRESHOLD:
   → Keep rawOutput (capped at MAX_RAW_OUTPUT_BYTES)
   → Store as block.rawOutput
   → Render virtualized (only visible lines)
   → Show "[output truncated — show more]" banner if needed
4. Dispose xterm visual state for this block
5. New empty block becomes "active" (or reuse existing xterm)
```

---

## 5. Large Output Handling

### 5.1 Size Tiers

| Size | Behavior | Storage |
|------|----------|---------|
| < 100 KB | Full HTML rendering | `htmlOutput: string` (complete) |
| 100 KB – 5 MB | Virtualized HTML rendering | `rawOutput: string` + render window |
| > 5 MB | Truncated preview + "Show more" | `rawOutput: string` (last N lines kept) |
| > 50 MB | Banner only, offer save-to-file | `isTruncated: true`, minimal storage |

### 5.2 Virtualization for Medium Outputs

For outputs between 100KB–5MB, don't render all lines at once:

```typescript
// Pseudocode for virtualized block rendering
function VirtualizedBlockOutput({ rawOutput }: { rawOutput: string }) {
  const lines = rawOutput.split('\n');
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 });

  // IntersectionObserver or scroll event → update visibleRange
  // Only render lines[visibleRange.start..visibleRange.end]
  // Off-screen lines = not in DOM
}
```

Use `@tanstack/react-virtual` for this. It handles scroll position calculation, measurement, and windowing efficiently.

### 5.3 Truncation Guard

While capturing output in real-time:

```typescript
function appendToOutput(capture: OutputCapture, data: string): OutputCapture {
  const newSize = capture.byteSize + data.length;

  if (newSize > MAX_RAW_OUTPUT_BYTES) {
    // Stop accumulating. Keep what we have.
    return { ...capture, isTruncated: true };
  }

  return {
    ...capture,
    rawOutput: capture.rawOutput + data,
    byteSize: newSize,
    lineCount: capture.lineCount + (data.match(/\n/g)?.length ?? 0),
  };
}
```

---

## 6. Data Model Changes

### 6.1 Updated CommandBlock Type

```typescript
// types/index.ts — updated CommandBlock

export interface CommandBlock {
  id: string;
  command: string;

  // ── Output storage (mutually exclusive based on size) ──
  /** Pre-rendered HTML for small outputs (< 100KB). Fastest rendering. */
  htmlOutput?: string;

  /** Raw ANSI string for medium/large outputs. Rendered on-demand/virtualized. */
  rawOutput?: string;

  /** True if output exceeded size limit and was truncated */
  isTruncated: boolean;

  /** Approximate line count for scrollbar/virtualization math */
  lineCount: number;

  /** Byte size of stored output */
  outputSizeBytes: number;

  // ── Metadata ──
  status: 'input' | 'running' | 'success' | 'error' | 'interrupted';
  timestamp: Date;

  /** Unix timestamp when command started (ms) */
  startedAt?: number;

  /** Unix timestamp when command finished (ms) */
  finishedAt?: number;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Exit code from shell (0 = success) */
  exitCode?: number;

  // ── Existing fields (unchanged) ──
  compacted?: boolean;
  compactedCount?: number;
}
```

### 6.2 New Types to Add

```typescript
// types/index.ts — new additions

/** Live output capture for the currently running block */
export interface OutputCapture {
  rawOutput: string;
  byteSize: number;
  lineCount: number;
  isTruncated: boolean;
}

/** Configuration constants for block behavior */
export const BLOCK_CONFIG = {
  MAX_RAW_OUTPUT_BYTES: 50 * 1024 * 1024,  // 50MB hard cap
  SMALL_OUTPUT_THRESHOLD: 100 * 1024,       // 100KB = fully render as HTML
  PROMPT_DEBOUNCE_MS: 500,                  // debounce cwd-changed events
  IDLE_TIMEOUT_MS: 2000,                    // fallback prompt detection
  VIRTUALIZED_PAGE_SIZE: 50,                // lines per virtualized page
} as const;
```

---

## 7. Component Architecture

### 7.1 Component Tree

```
App
└── TerminalProvider (context)
    └── AppInner
        └── TerminalPane (per pane/session)
            └── BlockView (NEW — replaces current flat layout)
                ├── BlockList (scrollable, virtualized container)
                │   ├── CompletedBlock (N instances, static HTML)
                │   │   └── BlockOutput (renders htmlOutput or virtualized rawOutput)
                │   ├── ActiveBlock (exactly 1 instance)
                │   │   └── xterm.js canvas (existing TerminalPane logic)
                │   └── InputBar (command input — lifted from footer)
                └── BlockListControls (search, filter, etc. — future)
```

### 7.2 Key Components

#### `BlockView` (NEW)
Main container for the block-based UI. Replaces the current `pane-content` layout.

**Responsibilities:**
- Scrollable container for all blocks
- Manages which block is "active" (has the xterm instance)
- Handles scroll-to-bottom on new output
- Passes down session/blocks context

**Props:** `{ sessionId: string }`

#### `CompletedBlock` (NEW)
Renders a single finished command block as static HTML.

**Responsibilities:**
- Display command text (read-only, monospace)
- Display output (pre-rendered HTML or virtualized)
- Show metadata footer (exit code, duration, line count)
- Click handler: copy command text to input field
- Visual status indicator (green check / red X / orange dash)

**Props:** `{ block: CommandBlock; onCopyCommand: (cmd: string) => void }`

#### `ActiveBlock` (NEW)
Wraps the existing xterm.js instance. This is where the current TerminalPane's xterm logic lives.

**Responsibilities:**
- Host the single xterm.js + WebGL canvas
- Receive PTY output events (existing behavior)
- Capture output to OutputBuffer (NEW)
- Handle keyboard focus
- Report dimensions to parent for layout

**Props:** `{ sessionId: string; onOutputData: (data: string) => void }`

#### `BlockOutput` (NEW)
Smart renderer that chooses between full HTML and virtualized rendering based on output size.

**Props:** `{ block: CommandBlock }`

---

## 8. Interaction Model

### 8.1 Normal Flow (Happy Path)

```
1. User types "npm test" in input field
2. User presses Enter
3. → Create new Block { command: "npm test", status: "running" }
4. → Send "npm test\r\n" to PTY via write_to_pty
5. → Focus xterm.js (user sees live output)
6. PTY streams output → xterm.write() + OutputCapture.append()
7. Shell finishes → OSC 7 fires → cwd-changed event
8. → Debounce 500ms
9. → Convert OutputCapture.rawOutput → HTML via ansi-to-html
10. → Update Block: { status: "success", htmlOutput: "...", durationMs: ... }
11. → Focus input field for next command
12. → Auto-scroll to bottom
```

### 8.2 User Clicks Old Command

```
1. User clicks "$ ls -la" text in Block[3]
2. → Copy "ls -la" to input field value
3. → Set cursor at end of input
4. → Focus input field
5. User can edit and re-execute (new block, not editing old one)
```

### 8.3 Ctrl+C During Running Command

```
1. User presses Ctrl+C
2. → Send \x03 to PTY (existing behavior)
3. → Wait 300ms
4. → Mark running block as "interrupted"
5. → Convert whatever output was captured so far to HTML
6. → Focus input field
```

### 8.4 Large Output (cat hugefile.log)

```
1. User runs "cat massive.log" (2GB file)
2. PTY streams output → xterm renders live (xterm has its own scrollback limit, handles this fine)
3. OutputCapture tracks size:
   - Under 100KB: normal capture
   - Hits 100KB: switch to rawOutput mode
   - Hits 50MB: set isTruncated=true, stop capturing
4. Shell finishes → cwd-changed detected
5. Block finalized:
   - isTruncated: true
   - rawOutput: last ~50MB (or less)
   - Render as: truncated banner + virtualized viewer
6. User sees: "[Output truncated — 2.4 GB received] [Show last 10K lines] [Save to file]"
```

---

## 9. File-by-File Implementation Plan

### Phase 1: Foundation (Types + Output Capture + Prompt Detection)

**Files to modify:**

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `OutputCapture`, update `CommandBlock`, add `BLOCK_CONFIG` |
| `src/context/TerminalContext.tsx` | Add new actions for output capture state, add `SET_BLOCK_OUTPUT` action |

**New files:**

| File | Purpose |
|------|---------|
| `src/hooks/useOutputCapture.ts` | Hook that manages per-block output accumulation |
| `src/utils/promptDetector.ts` | Utility: debounce cwd-changed + idle timeout → "prompt detected" callback |

### Phase 2: Block Components

**New files:**

| File | Purpose |
|------|---------|
| `src/components/BlockView/BlockView.tsx` | Main scrollable block list container |
| `src/components/BlockView/BlockView.css` | Styles for block list |
| `src/components/BlockView/CompletedBlock.tsx` | Static HTML rendered command block |
| `src/components/BlockView/CompletedBlock.css` | Styles for completed blocks |
| `src/components/BlockView/ActiveBlock.tsx` | Wrapper around xterm.js for the live block |
| `src/components/BlockView/ActiveBlock.css` | Styles for active block area |
| `src/components/BlockView/BlockOutput.tsx` | Smart renderer (full HTML vs virtualized) |

### Phase 3: Integrate Into TerminalPane

**File to modify:**

| File | Change |
|------|--------|
| `src/components/TerminalPane/TerminalPane.tsx` | Replace current layout with BlockView, wire up output capture, connect prompt detection to block lifecycle |

**Key changes in TerminalPane.tsx:**
1. Remove inline xterm initialization from TerminalPane body
2. Move xterm logic into `ActiveBlock` component
3. In PTY output listener: call `outputCapture.append(data)` BEFORE `term.write(data)`
4. In `cwd-changed` listener: trigger `promptDetector.onPrompt()` → finalize running block
5. In `handleExecuteCommand`: create block, send to PTY, switch active block
6. In Ctrl+C handler: interrupt running block after delay

### Phase 4: Polish

- Install `ansi-to-html` package
- Install `@tanstack/react-virtual` for virtualization
- Block metadata footer (duration, exit code, line count)
- Click-to-copy on command text
- Smooth scroll animations
- Keyboard navigation between blocks (Up/Down arrows when input focused)
- Search within blocks (future)

---

## 10. Dependencies to Install

```bash
npm install ansi-to-html @tanstack/react-virtual
```

| Package | Version | Purpose |
|---------|---------|---------|
| `ansi-to-html` | latest | Convert ANSI escape sequences to styled HTML `<span>` elements |
| `@tanstack/react-virtual` | ^3 | Virtualize long block lists (only render visible blocks) |

No other new dependencies needed. xterm.js and @xterm/addon-webgl are already installed.

---

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prompt detection false positives | Medium | Annoying (blocks split incorrectly) | Debounce + tune thresholds; allow manual merge |
| Prompt detection false negatives | Medium | Block never completes (stays "running") | Idle timeout fallback; manual "mark complete" action |
| ANSI-to-HTML rendering bugs | Low | Ugly output for some commands | Fallback to raw `<pre>` for problematic blocks |
| Memory leak in output capture | Low | Browser tab crash | Hard cap at 50MB; GC old blocks |
| xterm.js + block list scroll fighting | Medium | Jumpy scrolling | Careful scroll management; lock scroll position during updates |
| Full-screen apps (vim/tmux) break blocks | High | Garbage blocks | Detect alternate screen buffer; skip blockification entirely for these sessions |

---

## 12. What This Does NOT Cover (Future Work)

- **Inline block editing** — Not possible (shells don't support it). Copy-to-input only.
- **Block search/filter** — UI feature, can be added anytime.
- **Block persistence** — Save blocks to disk, restore on restart.
- **Block sharing** — Export blocks as markdown/images.
- **Multi-cursor/block selection** — Advanced UX.
- **AI integration with blocks** — Let AI read block output, suggest commands.
- **Custom prompt themes** — PS1 parsing for pretty prompt display.
- **Shell integration scripts** — Install bash/zsh hooks for better prompt detection.
- **Block collapsing/expand** — Fold long blocks.
- **Drag-and-drop block reorder** — Niche use case.

---

## 13. Implementation Order (Recommended)

```
Step 1: Update types (CommandBlock, OutputCapture, BLOCK_CONFIG)
   ↓
Step 2: Create useOutputCapture hook
   ↓
Step 3: Create promptDetector utility
   ↓
Step 4: Create CompletedBlock component (+ CSS)
   ↓
Step 5: Create ActiveBlock component (extract xterm logic from TerminalPane)
   ↓
Step 6: Create BlockOutput smart renderer
   ↓
   7: Create BlockView container (+ CSS)
   ↓
Step 8: Wire everything into TerminalPane.tsx
   ↓
Step 9: Install dependencies (ansi-to-html, react-virtual)
   ↓
Step 10: Test end-to-end flow
```

Each step is independently testable. Steps 1-3 are pure logic (no UI). Steps 4-7 are components. Step 8 is integration. Step 9-10 are verification.
