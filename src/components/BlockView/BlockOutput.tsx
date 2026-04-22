/* @solid */
import { createMemo, For, Show } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { BLOCK_CONFIG, type CommandBlock } from "../../types";
import { convertAnsiToHtml } from "../../hooks/useOutputCapture";

interface BlockOutputProps {
  block: CommandBlock;
}

export function BlockOutput(props: BlockOutputProps) {
  if (props.block.compacted) return null;

  if (props.block.htmlOutput) {
    return (
      <div
        class="block-output block-output-html"
        innerHTML={props.block.htmlOutput}
      />
    );
  }

  if (!props.block.rawOutput) return null;

  return <VirtualizedRawOutput block={props.block} />;
}

function VirtualizedRawOutput({ block }: BlockOutputProps) {
  let parentRef: HTMLDivElement | undefined;
  const isLargePreview = block.outputSizeBytes > BLOCK_CONFIG.LARGE_OUTPUT_THRESHOLD;

  const lines = createMemo(() => {
    const normalized = block.rawOutput!
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");

    if (isLargePreview) {
      return normalized.slice(-BLOCK_CONFIG.LARGE_OUTPUT_PREVIEW_LINES);
    }

    return normalized;
  });

  const rowVirtualizer = createVirtualizer({
    count: lines().length,
    getScrollElement: () => parentRef ?? null,
    estimateSize: () => 20,
    overscan: 12,
  });

  // Small outputs: show everything up to 600px. Large outputs: cap at 60vh.
  const maxHeight = isLargePreview ? window.innerHeight * 0.6 : 600;
  const viewportHeight = Math.min(Math.max(lines().length, 1) * 20, maxHeight);

  return (
    <div class="block-output-virtualized-shell">
      <Show when={(isLargePreview || block.isTruncated)}>
        <div class="block-output-banner">
          {block.isTruncated
            ? "Output truncated after the capture limit. Showing the stored tail."
            : `Large output detected. Showing the last ${Math.min(lines().length, BLOCK_CONFIG.LARGE_OUTPUT_PREVIEW_LINES)} lines.`}
        </div>
      </Show>

      <div
        ref={parentRef!}
        class="block-output block-output-virtualized"
        style={{ height: viewportHeight }}
      >
        <div
          class="block-output-virtualized-inner"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          <For each={rowVirtualizer.getVirtualItems()}>
            {(virtualLine) => {
              const line = lines()[virtualLine.index] ?? "";
              return (
                <div
                  class="block-output-line"
                  style={{ transform: `translateY(${virtualLine.start}px)` }}
                >
                  <div
                    innerHTML={line.length > 0 ? convertAnsiToHtml(line) : "&nbsp;"}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
