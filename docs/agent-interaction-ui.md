# Agent Interaction UI Specification

## Overview
This specification outlines the modular architecture for the Agent Interaction UI in Velocity. The UI aims to provide clarity, transparency, and control during AI-driven coding tasks.

## 1. Agent Interaction Block
Each agent interaction will be encapsulated as a discrete `AgentBlock` in the Main Feed. It will feature three primary sections:

### 1.1 The Thought/Plan (Collapsible)
- **State:** Collapsed by default to avoid clutter.
- **Header:** "Reasoning" with a toggle icon (Chevron).
- **Content:** Markdown-rendered text explaining the agent's strategy.
- **UX:** Smooth height transition on collapse/expand.

### 1.2 Proposed Actions
- **Command Cards:** A grid or list of executable commands.
- **Syntax:** Each card shows the command in a highlighted `<code>` block.
- **Control:** "Run" button per card, allowing targeted execution of suggested steps.

### 1.3 File Diffs
- **View Mode:** Unified (inline) or Split (v-split) view.
- **Toggle:** A mode switcher button ("Unified" vs "Split") to control display.
- **Split View:** Left side displays "Current," Right side displays "Suggested" (with `+`/`-` highlighting).

## 2. Feedback Loop
- **Control Panel:** Pinned to the bottom of each `AgentBlock`.
- **Options:** 
  - **Approve:** Executes all proposed actions.
  - **Refine:** Opens a text prompt to provide feedback.
  - **Cancel:** Aborts the current task.

## 3. Global Agent Controls
- **Model Selector:** A dropdown menu located in the terminal footer (or `TitleBar`).
  - **Configuration:** Fetches available models from the backend.
  - **State:** Synchronized with the current terminal session/pane.

## 4. Layout & Styling
- **Feed Integration:** Blocks must align with the terminal stream but remain visually distinct using subtle borders (`var(--border-subtle)`).
- **Split Pane:** Uses flexbox columns (`flex-direction: row`) with a resizable divider.
- **Visuals:** Uses standard `lucide-solid` icons for clarity (e.g., `Sparkle`, `Split`, `CheckCircle2`).
