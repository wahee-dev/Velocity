/* @solid */
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Send,
  X,
} from "lucide-solid";
import { For, Show, createMemo, createSignal } from "solid-js";
import { useTerminalContext } from "../../context/TerminalContext";
import type { AgentTask, AgentTaskStep } from "../../types";
import { DiffViewer } from "./DiffViewer";
import "./AgentBlock.css";

interface AgentBlockProps {
  task: AgentTask;
  onUndo: (taskId: string) => void;
  onRunCommand: (command: string) => void;
  onRefine: (task: AgentTask, feedback: string) => void;
  onCancel: (taskId: string) => void;
}

function commandFromStep(step: AgentTaskStep): string | null {
  if (step.kind !== "execute_command" || !step.detail) return null;
  const [command] = step.detail.split(": ");
  return command.trim() || null;
}

function reasoningText(task: AgentTask): string {
  const lines = task.steps
    .filter((step) => step.kind === "thinking" || step.kind === "read_file" || step.kind === "write_file")
    .map((step) => {
      const detail = step.detail ? ` - ${step.detail}` : "";
      return `- ${step.label}${detail}`;
    });

  if (task.summary) lines.push(`- ${task.summary}`);
  return lines.join("\n") || "No reasoning details yet.";
}

function MarkdownLite(props: { text: string }) {
  const lines = () => props.text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  return (
    <div class="agent-markdown">
      <For each={lines()}>
        {(line) => (
          <Show
            when={line.trim().startsWith("- ")}
            fallback={<p>{line}</p>}
          >
            <p class="agent-markdown-list">{line.trim().slice(2)}</p>
          </Show>
        )}
      </For>
    </div>
  );
}

export function AgentBlock(props: AgentBlockProps) {
  const { state, respondConfirmation } = useTerminalContext();
  const [responded, setResponded] = createSignal(false);
  const [reasoningOpen, setReasoningOpen] = createSignal(false);
  const [refining, setRefining] = createSignal(false);
  const [feedback, setFeedback] = createSignal("");

  const confirmStep = () => props.task.steps.find((s) => s.status === "awaiting_confirmation");
  const confirmation = () => {
    if (!confirmStep()) return undefined;
    for (const confirmation of state().pendingConfirmations.values()) {
      if (confirmation.taskId.startsWith(`confirm-${props.task.id}-`)) {
        return confirmation;
      }
    }
    return undefined;
  };

  const commandActions = createMemo(() =>
    props.task.steps
      .map((step) => ({ step, command: commandFromStep(step) }))
      .filter((item): item is { step: AgentTaskStep; command: string } => Boolean(item.command))
  );

  const canApprove = () => commandActions().length > 0;

  async function handleRespond(allowed: boolean) {
    setResponded(true);
    const conf = confirmation();
    if (conf) await respondConfirmation(conf.taskId, allowed);
  }

  function handleApprove() {
    for (const action of commandActions()) {
      props.onRunCommand(action.command);
    }
  }

  function handleRefineSubmit() {
    const value = feedback().trim();
    if (!value) return;
    props.onRefine(props.task, value);
    setFeedback("");
    setRefining(false);
  }

  return (
    <article class={`agent-block agent-block-${props.task.status}`}>
      <header class="agent-block-header">
        <div class="agent-block-title">
          <Sparkles size={14} />
          <span>Agent</span>
        </div>
        <span class="agent-block-status">{props.task.status}</span>
      </header>

      <p class="agent-block-prompt">{props.task.prompt}</p>

      <section class={`agent-reasoning ${reasoningOpen() ? "is-open" : ""}`}>
        <button
          type="button"
          class="agent-section-toggle"
          onClick={() => setReasoningOpen(!reasoningOpen())}
        >
          {reasoningOpen() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Reasoning</span>
        </button>
        <div class="agent-reasoning-panel">
          <MarkdownLite text={reasoningText(props.task)} />
        </div>
      </section>

      <Show when={commandActions().length > 0}>
        <section class="agent-section">
          <div class="agent-section-heading">Proposed Actions</div>
          <div class="agent-command-grid">
            <For each={commandActions()}>
              {(action) => (
                <div class="agent-command-card">
                  <code>{action.command}</code>
                  <button
                    type="button"
                    class="agent-card-run"
                    onClick={() => props.onRunCommand(action.command)}
                    title="Run command"
                  >
                    <Play size={13} />
                    <span>Run</span>
                  </button>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.task.changes.some((change) => change.diff)}>
        <section class="agent-section">
          <div class="agent-section-heading">File Diffs</div>
          <For each={props.task.changes.filter((change) => change.diff)}>
            {(change) => (
              <DiffViewer
                title={change.path}
                diff={change.diff!}
                reverted={change.reverted}
              />
            )}
          </For>
        </section>
      </Show>

      <Show when={confirmStep() && !responded()}>
        <div class="agent-confirmation-card">
          <div class="agent-confirmation-header">
            <ShieldAlert size={14} />
            <span>Confirmation Required</span>
          </div>
          <Show when={confirmation()}>
            {(conf) => (
              <>
                <code class="agent-confirmation-command">{conf().command}</code>
                <p class="agent-confirmation-reason">{conf().reason}</p>
              </>
            )}
          </Show>
          <div class="agent-confirmation-actions">
            <button type="button" class="agent-confirm-deny" onClick={() => handleRespond(false)}>
              <X size={13} />
              <span>Deny</span>
            </button>
            <button type="button" class="agent-confirm-allow" onClick={() => handleRespond(true)}>
              <CheckCircle2 size={13} />
              <span>Allow</span>
            </button>
          </div>
        </div>
      </Show>

      <Show when={!!(props.task.summary || props.task.error)}>
        <div class={`agent-block-output ${props.task.error ? "has-error" : ""}`}>
          {props.task.error ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          <span>{props.task.error ?? props.task.summary}</span>
        </div>
      </Show>

      <Show when={refining()}>
        <div
          class="agent-refine-box"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <textarea
            value={feedback()}
            onInput={(event) => setFeedback(event.currentTarget.value)}
            placeholder="Tell the agent what to change..."
            rows={3}
          />
          <button type="button" onClick={handleRefineSubmit} title="Send feedback">
            <Send size={13} />
            <span>Send</span>
          </button>
        </div>
      </Show>

      <footer class="agent-control-panel">
        <button type="button" class="agent-control-approve" disabled={!canApprove()} onClick={handleApprove}>
          <CheckCircle2 size={13} />
          <span>Approve</span>
        </button>
        <button type="button" onClick={() => setRefining(!refining())}>
          <Sparkles size={13} />
          <span>Refine</span>
        </button>
        <button type="button" onClick={() => props.onCancel(props.task.id)} disabled={props.task.status !== "running"}>
          <CircleStop size={13} />
          <span>Cancel</span>
        </button>
        <Show when={props.task.canUndo}>
          <button type="button" onClick={() => props.onUndo(props.task.id)}>
            <RotateCcw size={12} />
            <span>Undo</span>
          </button>
        </Show>
      </footer>
    </article>
  );
}
