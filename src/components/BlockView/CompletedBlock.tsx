/* @solid */
import type { CommandBlock } from "../../types";
import { BlockOutput } from "./BlockOutput";
import { matchErrorPattern } from "../../utils/errorPatterns";
import { KnowledgeToast } from "../KnowledgeToast/KnowledgeToast";
import { Info } from "lucide-solid";
import { Show, createSignal } from "solid-js";

interface CompletedBlockProps {
  block: CommandBlock;
  onCopyCommand: (command: string) => void;
}

export function CompletedBlock(props: CompletedBlockProps) {
  const [showKnowledge, setShowKnowledge] = createSignal(false);

  // Match error pattern only for error blocks with output
  const errorPattern = () => {
    if (props.block.status !== "error") return null;
    const output = props.block.rawOutput ?? props.block.htmlOutput ?? "";
    return matchErrorPattern(output, props.block.command);
  };

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
          <span class="command-text">{props.block.command}</span>
        </button>

        <BlockOutput block={props.block} />

        {/* Error knowledge toast toggle */}
        <Show when={errorPattern()}>
          {(pattern) => (
            <>
              <button
                type="button"
                class="knowledge-toggle"
                onClick={() => setShowKnowledge(!showKnowledge())}
                title={showKnowledge() ? "Hide error details" : "What went wrong?"}
              >
                <Info size={13} />
              </button>

              <Show when={showKnowledge()}>
                <KnowledgeToast
                  pattern={pattern()}
                  command={props.block.command}
                  onFixCommand={(cmd) => props.onCopyCommand(cmd)}
                />
              </Show>
            </>
          )}
        </Show>
      </article>
    </Show>
  );
}
