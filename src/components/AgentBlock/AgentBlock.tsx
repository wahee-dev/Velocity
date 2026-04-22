/* @solid */
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  FilePenLine,
  FileSearch,
  RotateCcw,
  TerminalSquare,
} from "lucide-solid";
import { Show } from "solid-js";
import type { AgentTask, AgentTaskStep } from "../../types";
import "./AgentBlock.css";

function statusLabel(task: AgentTask): string {
  switch (task.status) {
    case "running": return "Running";
    case "completed": return "Complete";
    case "error": return "Failed";
    case "reverted": return "Reverted";
    default: return task.status;
  }
}

function stepIcon(step: AgentTaskStep) {
  switch (step.kind) {
    case "read_file":
      return <FileSearch size={13} />;
    case "write_file":
      return <FilePenLine size={13} />;
    case "execute_command":
      return <TerminalSquare size={13} />;
    default:
      return <Brain size={13} />;
  }
}

interface AgentBlockProps {
  task: AgentTask;
  onUndo: (taskId: string) => void;
}

export function AgentBlock({ task, onUndo }: AgentBlockProps) {
  const recentSteps = [...task.steps].slice(-4).reverse();
  const latestStep = recentSteps[0];

  return (
    <article
      class={`agent-block agent-block-${task.status}`}
    >
      <div class="agent-block-header">
        <div class="agent-block-title">
          <span
            class={`agent-block-dot ${task.status === "running" ? "is-live" : ""}`}
          />
          <span>Velocity Agent</span>
        </div>
        <span class={`agent-block-status agent-block-status-${task.status}`}>
          {statusLabel(task)}
        </span>
      </div>

      <p class="agent-block-prompt">{task.prompt}</p>

      <Show when={!!(task.summary || task.error)}>
        <div
          class={`agent-block-summary ${task.error ? "has-error" : ""}`}
        >
          {task.error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          <span>{task.error ?? task.summary}</span>
        </div>
      </Show>

      <Show when={!!latestStep}>
        <div class="agent-block-current-step">
          <span class="agent-block-section-label">Current</span>
          <div class="agent-step-row is-current">
            <span class="agent-step-icon">{stepIcon(latestStep)}</span>
            <div class="agent-step-copy">
              <span class="agent-step-label">{latestStep.label}</span>
              <Show when={!!latestStep.detail}>
                <span class="agent-step-detail">{latestStep.detail}</span>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <Show when={recentSteps.length > 1}>
        <div class="agent-block-history">
          <span class="agent-block-section-label">Recent steps</span>
          <div class="agent-step-list">
            {recentSteps.slice(1).map((step) => (
              <div key={step.id} class="agent-step-row">
                <span class="agent-step-icon">{stepIcon(step)}</span>
                <div class="agent-step-copy">
                  <span class="agent-step-label">{step.label}</span>
                  <Show when={!!step.detail}>
                    <span class="agent-step-detail">{step.detail}</span>
                  </Show>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Show>

      <Show when={task.changes.length > 0}>
        <div class="agent-block-files">
          <span class="agent-block-section-label">Changed files</span>
          <div class="agent-file-list">
            {task.changes.map((change) => (
              <div key={change.path} class="agent-file-row">
                <div class="agent-file-copy">
                  <span class="agent-file-path">{change.path}</span>
                  <span class="agent-file-summary">{change.summary}</span>
                </div>
                <div class="agent-file-stats">
                  <span class="agent-file-added">+{change.addedLines}</span>
                  <span class="agent-file-removed">-{change.removedLines}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Show>

      <div class="agent-block-actions">
        <button
          type="button"
          class="agent-undo-btn"
          onClick={() => onUndo(task.id)}
          disabled={!task.canUndo}
        >
          <RotateCcw size={13} />
          <span>Undo changes</span>
        </button>
      </div>
    </article>
  );
}
