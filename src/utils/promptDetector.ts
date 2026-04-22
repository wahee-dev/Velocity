import { BLOCK_CONFIG } from '../types';

interface PromptDetectorOptions {
  debounceMs?: number;
  idleTimeoutMs?: number;
  isDetectionEnabled?: () => boolean;
  shouldIgnorePrompt?: () => boolean;
  onPromptDetected: () => void;
}

export interface PromptDetector {
  noteCommandStart: () => void;
  noteOutput: () => void;
  noteCwdChange: () => void;
  cancel: () => void;
  flush: () => void;
}

export function createPromptDetector({
  debounceMs = BLOCK_CONFIG.PROMPT_DEBOUNCE_MS,
  idleTimeoutMs = BLOCK_CONFIG.IDLE_TIMEOUT_MS,
  isDetectionEnabled = () => true,
  shouldIgnorePrompt = () => false,
  onPromptDetected,
}: PromptDetectorOptions): PromptDetector {
  let cwdTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (cwdTimer) {
      clearTimeout(cwdTimer);
      cwdTimer = null;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function canTrigger(): boolean {
    return isDetectionEnabled() && !shouldIgnorePrompt();
  }

  function scheduleIdle() {
    if (!isDetectionEnabled()) {
      return;
    }

    if (idleTimer) {
      clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (canTrigger()) {
        onPromptDetected();
      }
    }, idleTimeoutMs);
  }

  return {
    noteCommandStart() {
      clearTimers();
      scheduleIdle();
    },

    noteOutput() {
      scheduleIdle();
    },

    noteCwdChange() {
      if (!isDetectionEnabled()) {
        return;
      }

      if (cwdTimer) {
        clearTimeout(cwdTimer);
      }

      cwdTimer = setTimeout(() => {
        cwdTimer = null;
        if (canTrigger()) {
          onPromptDetected();
        }
      }, debounceMs);
    },

    cancel() {
      clearTimers();
    },

    flush() {
      clearTimers();
      if (canTrigger()) {
        onPromptDetected();
      }
    },
  };
}
