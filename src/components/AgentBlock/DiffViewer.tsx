/* @solid */
import { For, Show, createSignal } from "solid-js";
import { ChevronDown, ChevronRight } from "lucide-solid";
import "./DiffViewer.css";

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
}

function parseUnifiedDiff(diff: string): { fileHeader: string; hunks: DiffHunk[] } {
  const lines = diff.split("\n");
  let fileHeader = "";
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++")) {
      if (!fileHeader) fileHeader = line;
      continue;
    }
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
      continue;
    }
    if (currentHunk) {
      const type = line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context";
      currentHunk.lines.push({ type, content: line.slice(1) });
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  return { fileHeader, hunks };
}

interface DiffViewerProps {
  diff: string;
}

export function DiffViewer(props: DiffViewerProps) {
  const [expanded, setExpanded] = createSignal(true);
  const parsed = () => parseUnifiedDiff(props.diff);
  const totalAdded = () =>
    parsed().hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === "add").length, 0);
  const totalRemoved = () =>
    parsed().hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.type === "remove").length, 0);

  return (
    <div class="diff-viewer">
      <button
        type="button"
        class="diff-toggle"
        onClick={() => setExpanded(!expanded())}
      >
        {expanded() ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Unified Diff</span>
        <span class="diff-stats">
          <span class="diff-stat-added">+{totalAdded()}</span>
          <span class="diff-stat-removed">-{totalRemoved()}</span>
        </span>
      </button>

      <Show when={expanded()}>
        <div class="diff-content">
          <For each={parsed().hunks}>
            {(hunk) => (
              <div class="diff-hunk">
                <div class="diff-hunk-header">{hunk.header}</div>
                <For each={hunk.lines}>
                  {(line) => (
                    <div class={`diff-line diff-${line.type}`}>
                      <span class="diff-line-prefix">
                        {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                      </span>
                      <span class="diff-line-content">{line.content}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
