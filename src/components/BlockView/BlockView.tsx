/* @solid */
import { createEffect, createMemo, Show, For } from "solid-js";
import type { AgentTask, CommandBlock } from "../../types";
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
  agentTasks?: AgentTask[];
  renderAgentTask?: (task: AgentTask) => import("solid-js").JSX.Element;
}

export function BlockView(props: BlockViewProps) {
  let scrollRef: HTMLDivElement | undefined;

  const feedItems = createMemo(() => {
    const commandItems = props.blocks
      .filter((block) => block.status !== "running")
      .map((block) => ({
        id: `command-${block.id}`,
        type: "command" as const,
        timestamp: block.startedAt ?? block.timestamp.getTime(),
        block,
      }));

    const activeCommandItem = props.activeBlock
      ? [{
          id: `command-${props.activeBlock.id}`,
          type: "active-command" as const,
          timestamp: props.activeBlock.startedAt ?? props.activeBlock.timestamp.getTime(),
          block: props.activeBlock,
        }]
      : [];

    const agentItems = (props.agentTasks ?? []).map((task) => ({
      id: `agent-${task.id}`,
      type: "agent" as const,
      timestamp: task.startedAt,
      task,
    }));

    return [...commandItems, ...activeCommandItem, ...agentItems]
      .sort((a, b) => a.timestamp - b.timestamp);
  });

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

  const isEmpty = () => feedItems().length === 0;

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
          <For each={feedItems()}>
            {(item) => (
              item.type === "agent"
                ? props.renderAgentTask?.(item.task)
                : item.type === "active-command"
                  ? props.activeBlockNode?.()
                  : (
                      <CompletedBlock
                        block={item.block}
                        onCopyCommand={props.onCopyCommand}
                      />
                    )
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
