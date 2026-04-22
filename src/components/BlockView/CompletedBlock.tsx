/* @solid */
import type { CommandBlock } from "../../types";
import { BlockOutput } from "./BlockOutput";

interface CompletedBlockProps {
  block: CommandBlock;
  onCopyCommand: (command: string) => void;
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function formatBytes(size: number): string | null {
  if (size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusLabel(block: CommandBlock): string {
  if (block.status === "interrupted") return "interrupted";
  if (typeof block.exitCode === "number") return `exit code ${block.exitCode}`;
  if (block.status === "error") return "error";
  return "completed";
}

export function CompletedBlock(props: CompletedBlockProps) {
  const durationLabel = () => formatDuration(props.block.durationMs);
  const bytesLabel = () => formatBytes(props.block.outputSizeBytes);

  return (
    <Show
      when={!props.block.compacted}
      fallback={
        <div class="command-block compacted">
          <div class="block-command">
            <span class="command-text">{props.block.command}</span>
          </div>
        </div>
      }
    >
      <article class={`command-block status-${props.block.status}`}>
        <button
          type="button"
          class="block-command"
          onClick={() => props.onCopyCommand(props.block.command)}
          title="Copy command back into the input"
        >
          <span class={`block-status-indicator status-${props.block.status}`} aria-hidden="true" />
          <span class="prompt-symbol">$</span>
          <span class="command-text">{props.block.command}</span>
        </button>

        <BlockOutput block={props.block} />

        <footer class="block-meta">
          <span>{getStatusLabel(props.block)}</span>
          <Show when={durationLabel()}>
            <span>{durationLabel()}</span>
          </Show>
          <Show when={props.block.lineCount > 0}>
            <span>{props.block.lineCount} lines</span>
          </Show>
          <Show when={bytesLabel()}>
            <span>{bytesLabel()}</span>
          </Show>
        </footer>
      </article>
    </Show>
  );
}
