/**
 * Floating autocomplete menu — Warp-style dropdown.
 */

/* @solid */
import { Show, For, createEffect, Accessor } from 'solid-js';
import type { Suggestion } from '../../types';
import './AutocompleteMenu.css';

interface AutocompleteMenuProps {
  suggestions: Accessor<Suggestion[]>;
  selectedIndex: Accessor<number>;
  position: Accessor<{ x: number; y: number }>;
  visible: Accessor<boolean>;
  onSelect: (suggestion: Suggestion) => void;
  onHighlight: (index: number) => void;
}

const TYPE_ICONS: Record<string, string> = {
  command: '>',
  subcommand: '→',
  flag: '⚡',
  arg: '◇',
  file: '📄',
  history: '🕐',
};

export function AutocompleteMenu(props: AutocompleteMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  let selectedItemRef: HTMLDivElement | undefined;

  // Scroll selected item into view
  createEffect(() => {
    const idx = props.selectedIndex();
    if (idx >= 0 && selectedItemRef) {
      selectedItemRef.scrollIntoView({ block: 'nearest' });
    }
  });

  function handleClick(suggestion: Suggestion) {
    props.onSelect(suggestion);
  }

  function renderHighlightedText(text: string, matchedIndices?: number[]) {
    if (!matchedIndices || matchedIndices.length === 0) {
      return text;
    }

    const chars = text.split('');
    return chars.map((ch, i) => {
      const isMatch = matchedIndices.includes(i);
      return isMatch
        ? <mark class="autocomplete-menu__highlight">{ch}</mark>
        : ch;
    });
  }

  return (
    <Show when={props.visible() && props.suggestions().length > 0}>
      <div
        ref={menuRef!}
        class="autocomplete-menu"
        style={{
          left: `${props.position().x}px`,
          top: `${props.position().y}px`,
        }}
        role="listbox"
        aria-label="Autocomplete suggestions"
      >
        <For each={props.suggestions()}>
          {(suggestion, index) => (
            <div
              ref={index() === props.selectedIndex() ? (selectedItemRef!) : undefined}
              class={`autocomplete-menu__item ${index() === props.selectedIndex() ? 'autocomplete-menu__item--selected' : ''}`}
              role="option"
              aria-selected={index() === props.selectedIndex()}
              onMouseDown={(e) => {
                e.preventDefault();
                handleClick(suggestion);
              }}
              onMouseEnter={() => props.onHighlight(index())}
            >
              <span class="autocomplete-menu__icon">
                {suggestion.icon ?? TYPE_ICONS[suggestion.type] ?? ''}
              </span>
              <span class="autocomplete-menu__text">
                {renderHighlightedText(suggestion.display, suggestion.matchedIndices)}
              </span>
              <Show when={suggestion.description}>
                <span class="autocomplete-menu__desc">
                  {suggestion.description}
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
