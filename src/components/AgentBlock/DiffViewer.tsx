/* @solid */
import { For, Show, createMemo, createSignal } from "solid-js";
import { Columns2, FileCode2, Split } from "lucide-solid";
import "./DiffViewer.css";

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
}

interface DiffViewerProps {
  diff: string;
  title?: string;
  reverted?: boolean;
}

function parseUnifiedDiff(diff: string): { hunks: DiffHunk[]; added: number; removed: number } {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let added = 0;
  let removed = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { header: line, lines: [] };
      continue;
    }
    if (!currentHunk || line.length === 0) continue;

    const type = line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context";
    if (type === "add") added += 1;
    if (type === "remove") removed += 1;
    currentHunk.lines.push({ type, content: line.slice(1) });
  }

  if (currentHunk) hunks.push(currentHunk);
  return { hunks, added, removed };
}

function SplitRows(props: { lines: DiffLine[] }) {
  const rows = createMemo(() => {
    const output: { left?: DiffLine; right?: DiffLine }[] = [];

    for (let i = 0; i < props.lines.length; i += 1) {
      const line = props.lines[i];
      const next = props.lines[i + 1];

      if (line.type === "remove" && next?.type === "add") {
        output.push({ left: line, right: next });
        i += 1;
      } else if (line.type === "remove") {
        output.push({ left: line });
      } else if (line.type === "add") {
        output.push({ right: line });
      } else {
        output.push({ left: line, right: line });
      }
    }

    return output;
  });

  return (
    <For each={rows()}>
      {(row) => (
        <div class="diff-split-row">
          <div class={`diff-split-cell ${row.left ? `diff-${row.left.type}` : "diff-empty"}`}>
            <Show when={row.left}>
              {(line) => <code>{line().content}</code>}
            </Show>
          </div>
          <div class={`diff-split-cell ${row.right ? `diff-${row.right.type}` : "diff-empty"}`}>
            <Show when={row.right}>
              {(line) => <code>{line().content}</code>}
            </Show>
          </div>
        </div>
      )}
    </For>
  );
}

export function DiffViewer(props: DiffViewerProps) {
  const [mode, setMode] = createSignal<"unified" | "split">("unified");
  const parsed = createMemo(() => parseUnifiedDiff(props.diff));

  return (
    <div class="diff-viewer">
      <div class="diff-header">
        <div class="diff-title">
          <FileCode2 size={13} />
          <span>{props.title ?? "Diff"}</span>
          <Show when={props.reverted}>
            <span class="diff-reverted">reverted</span>
          </Show>
        </div>
        <div class="diff-stats">
          <span class="diff-stat-added">+{parsed().added}</span>
          <span class="diff-stat-removed">-{parsed().removed}</span>
        </div>
        <div class="diff-mode-switch">
          <button
            type="button"
            class={mode() === "unified" ? "active" : ""}
            onClick={() => setMode("unified")}
            title="Unified view"
          >
            <Columns2 size={12} />
            <span>Unified</span>
          </button>
          <button
            type="button"
            class={mode() === "split" ? "active" : ""}
            onClick={() => setMode("split")}
            title="Split view"
          >
            <Split size={12} />
            <span>Split</span>
          </button>
        </div>
      </div>

      <div class="diff-content">
        <Show
          when={mode() === "split"}
          fallback={
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
          }
        >
          <div class="diff-split-view">
            <div class="diff-split-labels">
              <span>Current</span>
              <span>Suggested</span>
            </div>
            <For each={parsed().hunks}>
              {(hunk) => (
                <div class="diff-hunk">
                  <div class="diff-hunk-header">{hunk.header}</div>
                  <SplitRows lines={hunk.lines} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
