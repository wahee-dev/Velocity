/**
 * Ghost Command hook — AI-predicted next command via Groq.
 * Shows blue-ish ghost text in terminal input when idle.
 */

/* @solid */
import {
  createSignal,
  Accessor,
} from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import type { CommandBlock } from '../types';

interface UseGhostCommandReturn {
  ghostCommand: Accessor<string>;
  isPredicting: Accessor<boolean>;
  triggerPrediction: () => void;
  acceptGhostCommand: () => string | null;
  dismissGhostCommand: () => void;
}

const GHOST_TTL_MS = 120_000;

export function useGhostCommand(
  sessionId: () => string,
  cwd: () => string,
  blocks: () => CommandBlock[],
): UseGhostCommandReturn {
  const [ghostCommand, setGhostCommand] = createSignal('');
  const [isPredicting, setIsPredicting] = createSignal(false);

  let abortController: AbortController | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;

  function clearDismissTimer() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function scheduleAutoDismiss() {
    clearDismissTimer();
    dismissTimer = setTimeout(() => {
      setGhostCommand('');
    }, GHOST_TTL_MS);
  }

  function triggerPrediction() {
    // Cancel any in-flight request
    if (abortController) {
      abortController.abort();
      abortController = null;
    }

    const recentCommands = blocks()
      .filter((b) => b.command && b.status === 'success')
      .slice(-5)
      .map((b) => b.command!);

    if (recentCommands.length === 0) return;

    const currentCwd = cwd();
    if (!currentCwd) return;

    setIsPredicting(true);
    abortController = new AbortController();

    invoke<string>('predict_next_command', {
      history: recentCommands,
      cwd: currentCwd,
    })
      .then((result) => {
        if (abortController?.signal.aborted) return;

        // Validate response
        const trimmed = result.trim();
        if (trimmed && trimmed.length <= 300) {
          setGhostCommand(trimmed);
          scheduleAutoDismiss();
        }
      })
      .catch(() => {
        // Silently fail — no API key or network error
        setGhostCommand('');
      })
      .finally(() => {
        if (!abortController?.signal.aborted) {
          setIsPredicting(false);
        }
        abortController = null;
      });
  }

  function acceptGhostCommand(): string | null {
    const cmd = ghostCommand();
    if (!cmd) return null;
    setGhostCommand();
    clearDismissTimer();
    return cmd;
  }

  function dismissGhostCommand() {
    setGhostCommand('');
    clearDismissTimer();
  }

  return {
    ghostCommand,
    isPredicting,
    triggerPrediction,
    acceptGhostCommand,
    dismissGhostCommand,
  };
}
