/* @solid */
import {
  BookOpen,
  ExternalLink,
  Lightbulb,
  Terminal,
  X,
} from "lucide-solid";
import { Show, createSignal, onCleanup } from "solid-js";
import type { ErrorPattern } from "../../utils/errorPatterns";
import "./KnowledgeToast.css";

interface KnowledgeToastProps {
  pattern: ErrorPattern;
  command: string;
  onFixCommand?: (command: string) => void;
}

export function KnowledgeToast(props: KnowledgeToastProps) {
  const [visible, setVisible] = createSignal(true);
  const [dismissed, setDismissed] = createSignal(false);

  // Auto-dismiss after 15 seconds
  const timer = window.setTimeout(() => {
    setDismissed(true);
    setTimeout(() => setVisible(false), 300);
  }, 15_000);

  onCleanup(() => clearTimeout(timer));

  function handleDismiss() {
    setDismissed(true);
    setTimeout(() => setVisible(false), 300);
  }

  return (
    <Show when={visible()}>
      <div class={`knowledge-toast ${dismissed() ? "is-dismissed" : ""}`}>
        <button
          type="button"
          class="knowledge-toast-close"
          onClick={handleDismiss}
          title="Dismiss"
        >
          <X size={14} />
        </button>

        <div class="knowledge-toast-header">
          <Lightbulb size={14} />
          <span class="knowledge-toast-title">{props.pattern.title}</span>
        </div>

        <p class="knowledge-toast-explanation">{props.pattern.explanation}</p>

        <p class="knowledge-toast-suggestion">{props.pattern.suggestion}</p>

        <Show when={props.pattern.commandFix}>
          {(fix) => (
            <button
              type="button"
              class="knowledge-toast-fix-btn"
              onClick={() => props.onFixCommand?.(fix())}
            >
              <Terminal size={12} />
              <span>Run fix</span>
            </button>
          )}
        </Show>

        <Show when={props.pattern.docsUrl}>
          {(url) => (
            <a
              class="knowledge-toast-docs-link"
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={11} />
              <span>Learn more</span>
            </a>
          )}
        </Show>
      </div>
    </Show>
  );
}
