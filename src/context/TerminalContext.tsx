import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { TerminalSession, CommandBlock } from '../types';

// ── State & Actions ──────────────────────────────────────────────

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;
}

type TerminalAction =
  | { type: 'CREATE_SESSION'; id: string; path: string }
  | { type: 'REMOVE_SESSION'; id: string }
  | { type: 'SET_ACTIVE_SESSION'; id: string }
  | { type: 'APPEND_BLOCK'; sessionId: string; block: CommandBlock }
  | { type: 'UPDATE_BLOCK'; sessionId: string; blockId: string; partial: Partial<CommandBlock> }
  | { type: 'SET_INPUT_VALUE'; sessionId: string; value: string }
  | { type: 'SET_SHOW_WELCOME'; sessionId: string; show: boolean }
  | { type: 'SET_GIT_STATUS'; sessionId: string; gitStatus: { branch: string; changes: number } };

function createDefaultSession(id: string, path: string): TerminalSession {
  return {
    id,
    path,
    blocks: [],
    inputValue: '',
    showWelcome: true,
    isActive: false,
    gitStatus: { branch: 'main', changes: 0 },
  };
}

function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  const next = new Map(state.sessions);

  switch (action.type) {
    case 'CREATE_SESSION':
      next.set(action.id, createDefaultSession(action.id, action.path));
      return { ...state, sessions: next };

    case 'REMOVE_SESSION':
      next.delete(action.id);
      return {
        ...state,
        sessions: next,
        activeSessionId: state.activeSessionId === action.id ? null : state.activeSessionId,
      };

    case 'SET_ACTIVE_SESSION': {
      for (const [k, s] of next) {
        next.set(k, { ...s, isActive: k === action.id });
      }
      return { ...state, sessions: next, activeSessionId: action.id };
    }

    case 'APPEND_BLOCK': {
      const session = next.get(action.sessionId);
      if (!session) return state;
      next.set(action.sessionId, {
        ...session,
        blocks: [...session.blocks, action.block],
      });
      return { ...state, sessions: next };
    }

    case 'UPDATE_BLOCK': {
      const session = next.get(action.sessionId);
      if (!session) return state;
      next.set(action.sessionId, {
        ...session,
        blocks: session.blocks.map(b =>
          b.id === action.blockId ? { ...b, ...action.partial } : b
        ),
      });
      return { ...state, sessions: next };
    }

    case 'SET_INPUT_VALUE': {
      const session = next.get(action.sessionId);
      if (!session) return state;
      next.set(action.sessionId, { ...session, inputValue: action.value });
      return { ...state, sessions: next };
    }

    case 'SET_SHOW_WELCOME': {
      const session = next.get(action.sessionId);
      if (!session) return state;
      next.set(action.sessionId, { ...session, showWelcome: action.show });
      return { ...state, sessions: next };
    }

    case 'SET_GIT_STATUS': {
      const session = next.get(action.sessionId);
      if (!session) return state;
      next.set(action.sessionId, { ...session, gitStatus: action.gitStatus });
      return { ...state, sessions: next };
    }

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────

interface TerminalContextValue {
  state: TerminalState;
  dispatch: React.Dispatch<TerminalAction>;
  createSession: (path: string) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  appendBlock: (sessionId: string, block: CommandBlock) => void;
  updateBlock: (sessionId: string, blockId: string, partial: Partial<CommandBlock>) => void;
  setInputValue: (sessionId: string, value: string) => void;
  setShowWelcome: (sessionId: string, show: boolean) => void;
  setGitStatus: (sessionId: string, gitStatus: { branch: string; changes: number }) => void;
  onExecute: (sessionId: string, command: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(terminalReducer, {
    sessions: new Map(),
    activeSessionId: null,
  });

  // Keep a stable ref to the latest dispatch for use in event listeners
  const dispatchRef = useRef(dispatch);
  const stateRef = useRef(state);
  dispatchRef.current = dispatch;

  // Sync stateRef so event listeners can read current state
  useEffect(() => { stateRef.current = state; }, [state]);

  // ── Listen for Rust-side command lifecycle events ─────────────
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    async function setupListeners() {
      // When Rust finishes a one-shot command, update the matching block
      const unlistenFinish = await listen<{
        blockId: string;
        command: string;
        output: string;
        status: string;
      }>('command-finish', (event) => {
        const { blockId, output, status } = event.payload;
        const currentState = stateRef.current;

        // Find which session owns this block and update it
        for (const [sid, sess] of currentState.sessions) {
          if (sess.blocks.some(b => b.id === blockId)) {
            dispatchRef.current({
              type: 'UPDATE_BLOCK',
              sessionId: sid,
              blockId,
              partial: {
                output,
                status: status === 'success' ? ('success' as const) : ('error' as const),
              },
            });
            break;
          }
        }
      });

      unlisteners.push(unlistenFinish);
    }

    setupListeners();

    return () => { unlisteners.forEach(fn => fn()); };
  }, []);

  const createSession = useCallback((path: string) => {
    const id = crypto.randomUUID();
    dispatch({ type: 'CREATE_SESSION', id, path });

    // Fetch real git status for this session's directory
    invoke<{ branch: string; changes: number }>('get_git_status', { path })
      .then((gs) => {
        dispatch({ type: 'SET_GIT_STATUS', sessionId: id, gitStatus: gs });
      })
      .catch(() => {});

    return id;
  }, []);

  const removeSession = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_SESSION', id });
  }, []);

  const setActiveSession = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_SESSION', id });
  }, []);

  const appendBlock = useCallback((sessionId: string, block: CommandBlock) => {
    dispatch({ type: 'APPEND_BLOCK', sessionId, block });
  }, []);

  const updateBlock = useCallback((sessionId: string, blockId: string, partial: Partial<CommandBlock>) => {
    dispatch({ type: 'UPDATE_BLOCK', sessionId, blockId, partial });
  }, []);

  const setInputValue = useCallback((sessionId: string, value: string) => {
    dispatch({ type: 'SET_INPUT_VALUE', sessionId, value });
  }, []);

  const setShowWelcome = useCallback((sessionId: string, show: boolean) => {
    dispatch({ type: 'SET_SHOW_WELCOME', sessionId, show });
  }, []);

  const setGitStatus = useCallback((sessionId: string, gitStatus: { branch: string; changes: number }) => {
    dispatch({ type: 'SET_GIT_STATUS', sessionId, gitStatus });
  }, []);

  /**
   * Execute a command.
   * - For PTY sessions: TerminalPane writes directly to the PTY via write_to_pty.
   *   This callback also fires a one-shot execute_command for block tracking.
   * - Blocks are created as 'running' before this fires; they get updated
   *   when Rust emits 'command-finish'.
   */
  const onExecute = useCallback((_sessionId: string, command: string) => {
    // Fire the one-shot command for output capture + block status updates.
    // The PTY (XTerm) handles interactive I/O separately.
    invoke('execute_command', { command }).catch((err) => {
      console.error('[TerminalContext] execute_command error:', err);
    });
  }, []);

  const value: TerminalContextValue = {
    state,
    dispatch,
    createSession,
    removeSession,
    setActiveSession,
    appendBlock,
    updateBlock,
    setInputValue,
    setShowWelcome,
    setGitStatus,
    onExecute,
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────

export function useTerminalContext(): TerminalContextValue {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error('useTerminalContext must be used within a <TerminalProvider>');
  }
  return ctx;
}
