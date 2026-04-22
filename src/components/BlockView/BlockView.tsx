/* @solid */
import { createEffect, createMemo, Show } from "solid-js";
import type { CommandBlock } from "../../types";
import { CompletedBlock } from "./CompletedBlock";
import "./BlockView.css";
import "./CompletedBlock.css";
import "./ActiveBlock.css";

interface BlockViewProps {
  blocks: CommandBlock[];
  activeBlock?: CommandBlock | null;
  activeBlockNode?: () => import("solid-js").JSX.Element;
  liveOutputVersion: number;
  onCopyCommand: (command: string) => void;
}

export function BlockView(props: BlockViewProps) {
  let scrollRef: HTMLDivElement | undefined;

  const completedBlocks = createMemo(
    () => props.blocks.filter((block) => block.status !== "running"),
  );

  // Auto-scroll to bottom when blocks change or live output updates
  createEffect(() => {
    const container = scrollRef;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom < 200 || props.activeBlock) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: props.liveOutputVersion === 0 ? "auto" : "smooth",
      });
    }
  });

  const isEmpty = () => completedBlocks().length === 0 && !props.activeBlock;

  return (
    <Show
      when={!isEmpty()}
      fallback={
        <div class="block-view block-view-empty" ref={scrollRef!}>
          <div class="block-empty-state">
            <p>Run a command to start building terminal blocks.</p>
            <p>Completed commands settle into static blocks. The live command stays GPU-rendered.</p>
          </div>
        </div>
      }
    >
      <div class="block-view" ref={scrollRef!}>
        <div class="block-list">
          {completedBlocks().map((block) => (
            <CompletedBlock
              key={block.id}
              block={block}
              onCopyCommand={props.onCopyCommand}
            />
          ))}

          <Show when={props.activeBlock && props.activeBlockNode}>
            {props.activeBlockNode?.()}
          </Show>
        </div>
      </div>
    </Show>
  );
}
