/* @solid */
import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  MoreVertical,
  X,
  GitBranch,
  Folder,
} from "lucide-solid";
import { AgentBlock } from "../AgentBlock/AgentBlock";
import { BlockView } from "../BlockView/BlockView";
import { ActiveBlockNode } from "./ActiveBlockNode";
import { useTerminalContext } from "../../context/TerminalContext";
import { useAutocompleteV2 } from "../../hooks/useAutocompleteV2";
import { useGhostCommand } from "../../hooks/useGhostCommand";
import { AutocompleteMenu } from "../AutocompleteMenu/AutocompleteMenu";
import { createOutputCapture } from "../../hooks/useOutputCapture";
import {
  consumeExitMarkerChunk,
  createMarkerState,
  flushMarkerCarry,
  type InteractiveShellKind,
  wrapInteractiveCommand,
} from "../../utils/exitMarker";
import { createPromptDetector, type PromptDetector } from "../../utils/promptDetector";
import type { CommandBlock, CommandBlockStatus, SessionHealthMetrics, TerminalInputIntent } from "../../types";
import "./TerminalPane.css";

interface TerminalPaneProps {
  sessionId: string;
  onClosePane?: () => void;
}

const TERMINATED_BANNER = "\r\n\x1b[90m[Session terminated]\x1b[0m\r\n";

function createErrorBlock(command: string, error: unknown): CommandBlock {
  const message = String(error);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    command,
    rawOutput: message,
    htmlOutput: undefined,
    isTruncated: false,
    lineCount: message ? message.split(/\r?\n/).length : 0,
    outputSizeBytes: new TextEncoder().encode(message).length,
    status: "error",
    timestamp: new Date(now),
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  };
}

export function TerminalPane(props: TerminalPaneProps) {
  const {
    state,
    appendBlock,
    removeSession,
    revertAgentTask,
    setBlockOutput,
    setInputValue,
    setSessionPath,
    startAgentTask,
    updateBlock,
  } = useTerminalContext();

  const session = () => state().sessions.get(props.sessionId);

  let inputRef: HTMLInputElement | undefined;
  let paneContentRef: HTMLDivElement | undefined;
  const isInputFocusedRef = { current: false };
  let activeTerminalHandle: ActiveBlockHandle | null = null;
  let ptySessionId: string | null = null;
  let resolvePtyReady!: () => void;
  const ptyReadyPromise = new Promise<void>((resolve) => { resolvePtyReady = resolve; });
  let promptDetector: PromptDetector | null = null;
  let activeBlock: CommandBlock | null = null;
  const pendingOutput: string[] = [];
  let exitCode: number | undefined;
  let interruptRequested = false;
  let markerState = createMarkerState();
  let shellKind: InteractiveShellKind = "cmd";
  const unlisteners: (() => void)[] = [];

  const [liveOutputVersion, setLiveOutputVersion] = createSignal(0);
  const [health, setHealth] = createSignal<SessionHealthMetrics | null>(null);

  const outputCapture = createOutputCapture();

  const blocks = () => session()?.blocks ?? [];
  const agentTasks = () => session()?.agentTasks ?? [];
  const inputValue = () => session()?.inputValue ?? "";
  const gitStatus = () => session()?.gitStatus ?? { branch: "main", changes: 0 };
  const isActive = () => session()?.isActive ?? false;
  const autocompletePath = () => session()?.path ?? "";
  const hasRunningAgentTask = () => agentTasks().some((task) => task.status === "running");
  const [cursorPos, setCursorPos] = createSignal(0);
  const autocompleteV2 = useAutocompleteV2(autocompletePath, inputValue, cursorPos, blocks);
  const ghostCmd = useGhostCommand(() => props.sessionId, autocompletePath, blocks);

  // Register input element for menu positioning
  onMount(() => {
    // Will be set when inputRef is available
  });
  createEffect(() => {
    // Keep input element registered
    if (inputRef) {
      autocompleteV2.registerInputElement(inputRef);
    }
  });

  // Idle prediction: show ghost text after 150ms of empty, idle prompt
  let idlePredictionTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const input = inputValue();
    const running = hasRunningCommand();
    const existingGhost = autocompleteV2.ghostText();

    // Only predict when: input empty, no running command, no existing ghost text
    if (!input.trim() && !running && !existingGhost) {
      if (idlePredictionTimer) clearTimeout(idlePredictionTimer);
      idlePredictionTimer = setTimeout(() => {
        // Re-check conditions haven't changed
        if (!inputValue().trim() && !hasRunningCommand() && !autocompleteV2.ghostText()) {
          const recentCommands = blocks()
            .filter((b) => b.command && b.status === "success")
            .slice(-5)
            .map((b) => b.command!);
          void autocompleteV2.triggerPrediction(recentCommands, autocompletePath());
        }
      }, 150);
    }

    onCleanup(() => {
      if (idlePredictionTimer) clearTimeout(idlePredictionTimer);
    });
  });

  const activeBlockMemo = createMemo<CommandBlock | null>(() => {
    const b = blocks();
    for (let index = b.length - 1; index >= 0; index -= 1) {
      if (b[index].status === "running") return b[index];
    }
    return null;
  });

  const hasRunningCommand = () => activeBlockMemo() !== null;
  const visibleAgentTasks = () => agentTasks().slice(-3).reverse();
  const fullDisplayPath = () => session()?.path ?? "";

  // Sync active block ref
  createEffect(() => { activeBlock = activeBlockMemo(); });

  function finalizeRunningBlock(statusOverride?: CommandBlockStatus, exitCodeOverride?: number) {
    const runningBlock = activeBlock;
    if (!runningBlock) return;

    const trailingMarkerCarry = flushMarkerCarry(markerState);
    if (trailingMarkerCarry) {
      outputCapture.appendOutput(trailingMarkerCarry);
      pendingOutput.push(trailingMarkerCarry);
    }

    const { blockId, output } = outputCapture.finalizeCapture(runningBlock.command);
    if (blockId !== runningBlock.id) return;

    const finishedAt = Date.now();
    const ec = exitCodeOverride ?? exitCode;
    const status = statusOverride
      ?? (typeof ec === "number" ? (ec === 0 ? "success" : "error") : "success");

    activeBlock = null;
    promptDetector?.cancel();
    pendingOutput.length = 0;
    exitCode = undefined;
    interruptRequested = false;

    if (activeTerminalHandle) {
      activeTerminalHandle.clear();
    }

    setBlockOutput(props.sessionId, runningBlock.id, output);
    updateBlock(props.sessionId, runningBlock.id, {
      status,
      exitCode: ec,
      finishedAt,
      durationMs: typeof runningBlock.startedAt === "number"
        ? finishedAt - runningBlock.startedAt
        : undefined,
    });

    requestAnimationFrame(() => inputRef?.focus());

    // Trigger next-command prediction on successful exit
    if ((status === "success" || ec === 0) && !inputValue().trim()) {
      const recentCommands = blocks()
        .filter((b) => b.command && b.status === "success")
        .slice(-5)
        .map((b) => b.command!);
      void autocompleteV2.triggerPrediction(recentCommands, autocompletePath());
      ghostCmd.triggerPrediction();
    }
  }

  // PTY initialization
  onMount(async () => {
    try {
      const ptyInfo = await invoke<{ id: string; cwd: string; shellKind: InteractiveShellKind }>("spawn_pty", {
        paneId: props.sessionId,
      });

      ptySessionId = ptyInfo.id;
      shellKind = ptyInfo.shellKind;
      resolvePtyReady();
      setSessionPath(props.sessionId, ptyInfo.cwd);

      promptDetector = createPromptDetector({
        isDetectionEnabled: () => Boolean(activeBlock),
        shouldIgnorePrompt: () => outputCapture.getCapture().isAlternateScreenActive,
        onPromptDetected: () => finalizeRunningBlock(),
      });

      const unlistenOutput = await listen<{
        sessionId: string;
        paneId: string;
        data: string;
      }>("pty://output", (event) => {
        if (event.payload.sessionId !== ptySessionId) return;

        const runningBlock = activeBlock;
        if (!runningBlock) return;

        const markerResult = consumeExitMarkerChunk(
          markerState,
          runningBlock.id,
          event.payload.data,
        );

        if (markerResult.cleanedOutput) {
          outputCapture.appendOutput(markerResult.cleanedOutput);
        }
        promptDetector?.noteOutput();

        if (activeTerminalHandle && markerResult.cleanedOutput) {
          activeTerminalHandle.write(markerResult.cleanedOutput);
          activeTerminalHandle.scrollToBottom();
        } else if (markerResult.cleanedOutput) {
          pendingOutput.push(markerResult.cleanedOutput);
        }

        if (markerResult.cleanedOutput) setLiveOutputVersion((v) => v + 1);

        if (typeof markerResult.exitCode === "number") {
          exitCode = markerResult.exitCode;
          const statusOverride = interruptRequested ? "interrupted" : undefined;
          finalizeRunningBlock(statusOverride, markerResult.exitCode);
        }
      });

      const unlistenClosed = await listen<{
        sessionId: string;
        paneId: string;
        exitCode?: number | null;
      }>("pty://closed", (event) => {
        if (event.payload.sessionId !== ptySessionId) return;

        if (activeBlock) {
          const trailingMarkerCarry = flushMarkerCarry(markerState);
          if (trailingMarkerCarry) {
            outputCapture.appendOutput(trailingMarkerCarry);
          }
          outputCapture.appendOutput(TERMINATED_BANNER);
          if (activeTerminalHandle) {
            if (trailingMarkerCarry) activeTerminalHandle.write(trailingMarkerCarry);
            activeTerminalHandle.write(TERMINATED_BANNER);
            activeTerminalHandle.scrollToBottom();
          } else {
            if (trailingMarkerCarry) pendingOutput.push(trailingMarkerCarry);
            pendingOutput.push(TERMINATED_BANNER);
          }

          const ec = typeof event.payload.exitCode === "number" ? event.payload.exitCode : undefined;
          const statusOverride = interruptRequested ? "interrupted" : undefined;
          finalizeRunningBlock(statusOverride ?? "error", ec);
        }

        requestAnimationFrame(() => inputRef?.focus());
      });

      const unlistenCwd = await listen<{
        sessionId: string;
        paneId: string;
        cwd: string;
      }>("cwd-changed", (event) => {
        if (event.payload.sessionId !== ptySessionId) return;

        setSessionPath(props.sessionId, event.payload.cwd);
        if (activeBlock) promptDetector?.noteCwdChange();
      });

      unlisteners.push(unlistenOutput, unlistenClosed, unlistenCwd);
    } catch (error) {
      console.error("[TerminalPane] failed to initialize PTY session:", error);
    }
  });

  onCleanup(() => {
    promptDetector?.cancel();
    promptDetector = null;
    unlisteners.forEach((unlisten) => unlisten());
    unlisteners.length = 0;
    activeTerminalHandle = null;
    activeBlock = null;
    pendingOutput.length = 0;
    exitCode = undefined;
    interruptRequested = false;
    markerState = createMarkerState();
    outputCapture.clearCapture();

    if (ptySessionId) {
      invoke("kill_pty", { sessionId: ptySessionId }).catch(() => {});
      ptySessionId = null;
    }
  });

  // Health polling (only when PTY session exists)
  let healthInterval: ReturnType<typeof setInterval>;
  createEffect(() => {
    if (!ptySessionId) return;
    let cancelled = false;

    async function pollHealth() {
      if (cancelled || !ptySessionId) return;

      try {
        const metrics = await invoke<{
          bytesRead: number;
          commandCount: number;
          createdAtSecs: number;
          lastActivitySecs: number;
          isAlive: boolean;
        }>("get_session_metrics", { sessionId: ptySessionId });

        if (cancelled) return;

        const now = Date.now();
        const lastActivity = metrics.lastActivitySecs * 1000;
        const nextHealth = {
          uptime: now - (metrics.createdAtSecs * 1000),
          bytesRead: metrics.bytesRead,
          commandCount: metrics.commandCount,
          lastActivity,
          isIdle: now - lastActivity > 5 * 60 * 1000,
        };

        // Only update state when values actually change
        const prev = health();
        if (
          !prev ||
          prev.uptime !== nextHealth.uptime ||
          prev.bytesRead !== nextHealth.bytesRead ||
          prev.isIdle !== nextHealth.isIdle
        ) {
          setHealth(nextHealth);
        }
      } catch {
        // Ignore health probe failures for dead sessions
      }
    }

    void pollHealth();
    healthInterval = window.setInterval(() => { void pollHealth(); }, 30_000);

    onCleanup(() => {
      cancelled = true;
      window.clearInterval(healthInterval);
    });
  });

  // Focus management
  createEffect(() => {
    if (isActive()) {
      if (hasRunningCommand()) {
        activeTerminalHandle?.focus();
      } else {
        inputRef?.focus();
      }
    }
  });

  // Input mousedown focus
  createEffect(() => {
    const input = inputRef;
    if (!input) return;

    function forceFocus(event: MouseEvent) {
      event.preventDefault();
      isInputFocusedRef.current = true;
      setTimeout(() => input.focus(), 0);
    }

    input.addEventListener("mousedown", forceFocus);
    onCleanup(() => input.removeEventListener("mousedown", forceFocus));
  });

  async function ensurePtyReady(): Promise<string> {
    await ptyReadyPromise;
    if (!ptySessionId) throw new Error("PTY session is not available");
    return ptySessionId;
  }

  async function writeToPty(data: string) {
    const ptyId = await ensurePtyReady();
    await invoke("write_to_pty", { sessionId: ptyId, data });
  }

  function handleCopyCommand(command: string) {
    setInputValue(props.sessionId, command);
    requestAnimationFrame(() => {
      if (!inputRef) return;
      inputRef.focus();
      inputRef.setSelectionRange(command.length, command.length);
    });
  }

  async function handleStartAgentTask(prompt: string) {
    try {
      await startAgentTask(props.sessionId, prompt, autocompletePath());
      inputRef?.focus();
    } catch (error) {
      console.error("[TerminalPane] start_agent_task failed:", error);
      appendBlock(props.sessionId, createErrorBlock(prompt, error));
    }
  }

  async function handleExecuteCommand(forceAgent: boolean = false) {
    if (!inputValue().trim()) return;

    const submitted = inputValue().trim();
    setInputValue(props.sessionId, "");

    const explicitAgentPrompt = submitted === "/agent"
      ? ""
      : submitted.startsWith("/agent ")
        ? submitted.slice("/agent ".length).trim()
        : null;

    if (forceAgent || explicitAgentPrompt !== null) {
      await handleStartAgentTask(explicitAgentPrompt || submitted);
      return;
    }

    try {
      const intent = await invoke<TerminalInputIntent>("classify_terminal_input", {
        input: submitted,
        cwd: autocompletePath(),
      });

      if (intent.kind === "agent") {
        await handleStartAgentTask(submitted);
        return;
      }
    } catch (error) {
      console.error("[TerminalPane] classify_terminal_input failed:", error);
    }

    const startedAt = Date.now();
    const block: CommandBlock = {
      id: crypto.randomUUID(),
      command: submitted,
      htmlOutput: undefined,
      rawOutput: undefined,
      isTruncated: false,
      lineCount: 0,
      outputSizeBytes: 0,
      status: "running",
      timestamp: new Date(startedAt),
      startedAt,
    };

    activeBlock = block;
    pendingOutput.length = 0;
    exitCode = undefined;
    interruptRequested = false;
    markerState = createMarkerState();
    outputCapture.startCapture(block.id);
    promptDetector?.noteCommandStart();
    appendBlock(props.sessionId, block);

    try {
      await writeToPty(wrapInteractiveCommand(shellKind, submitted, block.id));
    } catch (error) {
      console.error("[TerminalPane] write_to_pty failed:", error);
      promptDetector?.cancel();
      outputCapture.clearCapture();
      activeBlock = null;
      updateBlock(props.sessionId, block.id, {
        status: "error",
        rawOutput: String(error),
        outputSizeBytes: new TextEncoder().encode(String(error)).length,
        lineCount: String(error).split(/\r?\n/).length,
        finishedAt: Date.now(),
      });
    }
  }

  async function handleUndoAgentTask(taskId: string) {
    try {
      await revertAgentTask(taskId);
    } catch (error) {
      console.error("[TerminalPane] revert_agent_task failed:", error);
    }
  }

  function handleAcceptSuggestionV2(): boolean {
    const nextValue = autocompleteV2.acceptSuggestion();
    if (!nextValue) return false;

    setInputValue(props.sessionId, nextValue);
    requestAnimationFrame(() => {
      if (!inputRef) return;
      inputRef.setSelectionRange(nextValue.length, nextValue.length);
    });
    return true;
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Track cursor position for navigation keys
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const target = event.currentTarget as HTMLInputElement;
      // Update after browser processes the key
      requestAnimationFrame(() => {
        setCursorPos(target.selectionStart ?? inputValue().length);
      });
    }

    // Delegate to V2 autocomplete handler first
    const autocompleteHandled = autocompleteV2.handleKeyDown(event);
    if (autocompleteHandled) {
      // Tab was handled by the hook — apply the accepted suggestion value
      if (event.key === "Tab") {
        handleAcceptSuggestionV2();
      }
      return;
    }

    // Tab — accept AI ghost command when input empty, ghost exists, menu not visible
    if (
      event.key === "Tab" &&
      !inputValue().trim() &&
      ghostCmd.ghostCommand() &&
      !autocompleteV2.menuVisible()
    ) {
      event.preventDefault();
      const accepted = ghostCmd.acceptGhostCommand();
      if (accepted) {
        setInputValue(props.sessionId, accepted);
        requestAnimationFrame(() => {
          if (!inputRef) return;
          inputRef.setSelectionRange(accepted.length, accepted.length);
        });
      }
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      void handleExecuteCommand(true);
      return;
    }

    if (
      event.key === "ArrowRight" &&
      (autocompleteV2.ghostText() || ghostCmd.ghostCommand()) &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      const target = event.currentTarget as HTMLInputElement;
      const selectionStart = target.selectionStart ?? inputValue().length;
      const selectionEnd = target.selectionEnd ?? inputValue().length;

      if (selectionStart === inputValue().length && selectionEnd === inputValue().length) {
        event.preventDefault();
        // Accept AI ghost command if input is empty and ghost exists
        if (!inputValue().trim() && ghostCmd.ghostCommand()) {
          const accepted = ghostCmd.acceptGhostCommand();
          if (accepted) {
            setInputValue(props.sessionId, accepted);
            requestAnimationFrame(() => {
              if (!inputRef) return;
              inputRef.setSelectionRange(accepted.length, accepted.length);
            });
          }
        } else {
          handleAcceptSuggestionV2();
        }
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void handleExecuteCommand();
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();

      if (hasRunningCommand()) {
        interruptRequested = true;
        void writeToPty("\x03").finally(() => {
          window.setTimeout(() => finalizeRunningBlock("interrupted"), 300);
        });
      }
    }
  }

  async function handleClosePane() {
    if (ptySessionId) {
      await invoke("kill_pty", { sessionId: ptySessionId }).catch(() => {});
    }
    removeSession(props.sessionId);
    props.onClosePane?.();
  }

  function setActiveTerminalHandle(handle: ActiveBlockHandle | null) {
    activeTerminalHandle = handle;
    if (!handle) return;

    handle.clear();
    for (const chunk of pendingOutput) {
      handle.write(chunk);
    }
    pendingOutput.length = 0;
    handle.scrollToBottom();
    handle.fit();
  }

  async function handleActiveTerminalResize({ cols, rows }: { cols: number; rows: number }) {
    if (!ptySessionId || cols <= 0 || rows <= 0) return;

    try {
      await invoke("resize_pty", {
        sessionId: ptySessionId,
        cols,
        rows,
      });
    } catch (error) {
      console.debug("[TerminalPane] resize_pty failed:", error);
    }
  }

  return (
    <div class={`terminal-pane ${isActive() ? "active" : ""}`}>
      <div class="pane-header">
        <div class="pane-actions">
          <button class="pane-btn" title={`Session ${health() ? (health().isIdle ? "idle" : "active") : ""} — ${fullDisplayPath()}`}>
            <MoreVertical size={13} />
          </button>
          <button class="pane-btn pane-btn-close" onClick={handleClosePane} title="Close pane">
            <X size={13} />
          </button>
        </div>
      </div>

      <div
        class="pane-content"
        ref={paneContentRef!}
        data-terminal-id={props.sessionId}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest(".pane-footer")) return;

          if (hasRunningCommand()) {
            activeTerminalHandle?.focus();
          } else {
            inputRef?.focus();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (hasRunningCommand()) {
              inputRef?.focus();
            } else {
              activeTerminalHandle?.focus();
            }
          }
        }}
        tabIndex={0}
      >
        <BlockView
          blocks={blocks()}
          activeBlock={activeBlockMemo()}
          liveOutputVersion={liveOutputVersion()}
          onCopyCommand={handleCopyCommand}
          activeBlockNode={
            activeBlockMemo()
              ? () => (
                  <ActiveBlockNode
                    key={activeBlockMemo()!.id}
                    onReady={(handle) => setActiveTerminalHandle(handle)}
                    onResize={handleActiveTerminalResize}
                  />
                )
              : undefined
          }
        />

        <Show when={visibleAgentTasks().length > 0}>
          <div class="agent-blocks-layer">
            {visibleAgentTasks().map((task) => (
              <AgentBlock key={task.id} task={task} onUndo={handleUndoAgentTask} />
            ))}
          </div>
        </Show>

        <div class="pane-footer">
          <div class="status-bar">
            <span class="version-badge">v25.8.1</span>
            <div class="path-info">
              <Folder size={12} />
              <span>{fullDisplayPath()}</span>
            </div>
            <div class="git-info">
              <GitBranch size={12} />
              <span class="branch-name">{gitStatus().branch}</span>
            </div>
            <span class="git-changes">+/- {gitStatus().changes}</span>
            <Show when={hasRunningAgentTask()}>
              <span class="running-hint status-hint-agent">
                <span class="running-indicator-inline" />
                <span>agent active</span>
              </span>
            </Show>
          </div>

          <div
            class="input-container"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div class="command-input-shell">
              <Show when={ghostCmd.ghostCommand() && !inputValue().trim()}>
                <div class="command-ghost command-ghost-ai" aria-hidden="true">
                  <span class="command-ghost-typed">{inputValue()}</span>
                  <span class="command-ghost-completion">{ghostCmd.ghostCommand()}</span>
                </div>
              </Show>
              <Show when={!ghostCmd.ghostCommand() && autocompleteV2.ghostText()}>
                <div class="command-ghost" aria-hidden="true">
                  <span class="command-ghost-typed">{inputValue()}</span>
                  <span class="command-ghost-completion">{autocompleteV2.ghostText()}</span>
                </div>
              </Show>

              <input
                ref={inputRef!}
                type="text"
                class="command-input"
                placeholder={hasRunningCommand() ? "Command running... type next command" : "Warp anything e.g. Create unit tests for my authentication service"}
                value={inputValue()}
                onInput={(e) => {
                  const target = e.target as HTMLInputElement;
                  setInputValue(props.sessionId, target.value);
                  setCursorPos(target.selectionStart ?? target.value.length);
                  // Dismiss AI ghost command when user types
                  if (target.value.length > 0) {
                    ghostCmd.dismissGhostCommand();
                  }
                }}
                onKeyDown={handleKeyDown}
                onClick={(e) => {
                  setCursorPos((e.target as HTMLInputElement).selectionStart ?? inputValue().length);
                }}
                onFocus={() => { isInputFocusedRef.current = true; }}
                onBlur={() => { isInputFocusedRef.current = false; }}
              />
            </div>

            <div class="input-hint">
              <Show when={hasRunningCommand()} fallback={
                <Show when={hasRunningAgentTask()} fallback={
                  <Show when={ghostCmd.isPredicting()} fallback={
                    <Show when={ghostCmd.ghostCommand()} fallback={
                      <Show when={autocompleteV2.ghostText()} fallback={
                        <>
                          <span>Ctrl+Shift+Enter</span>
                          <span class="hint-action">new /agent conversation</span>
                        </>
                      }>
                        <span>tab / ↑↓ / RightArrow</span>
                        <span class="hint-action">accept suggestion</span>
                      </Show>
                    }>
                      <span>Tab / RightArrow</span>
                      <span class="hint-action">accept AI suggestion</span>
                    </Show>
                  }>
                    <span>Predicting...</span>
                    <span class="hint-action">AI thinking</span>
                  </Show>
                }>
                  <span class="running-hint">
                    <span class="running-indicator-inline" />
                    <span>agent is thinking</span>
                  </span>
                </Show>
              }>
                <span class="running-hint">
                  <span class="running-indicator-inline" />
                  <span>command in progress</span>
                </span>
              </Show>
            </div>

            <AutocompleteMenu
              suggestions={autocompleteV2.suggestions}
              selectedIndex={autocompleteV2.selectedIndex}
              position={autocompleteV2.menuPosition}
              visible={autocompleteV2.menuVisible}
              onSelect={(suggestion) => {
                const val = suggestion.value;
                const currentInput = inputValue();
                setInputValue(props.sessionId, currentInput + (currentInput.endsWith(' ') ? '' : ' ') + val);
                autocompleteV2.dismissMenu();
                inputRef?.focus();
              }}
              onHighlight={(index) => {
                autocompleteV2.highlightIndex(index);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ActiveBlockHandle interface (used by TerminalPane) ──
export interface ActiveBlockHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
  scrollToBottom: () => void;
  fit: () => void;
  getSize: () => { cols: number; rows: number };
}
