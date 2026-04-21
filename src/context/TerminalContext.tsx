import { createContext, useContext, useReducer, useCallback } from 'react';
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
  | { type: 'SET_SHOW_WELCOME'; sessionId: string; show: boolean };

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
      // Deactivate all, activate target
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
  onExecute: (sessionId: string, command: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(terminalReducer, {
    sessions: new Map(),
    activeSessionId: null,
  });

  const createSession = useCallback((path: string) => {
    const id = crypto.randomUUID();
    dispatch({ type: 'CREATE_SESSION', id, path });
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

  const onExecute = useCallback((sessionId: string, command: string) => {
    console.log(`[TerminalContext] onExecute: sessionId=${sessionId} command="${command}"`);
    // Stub — will be replaced by Tauri invoke() when backend is ready
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
