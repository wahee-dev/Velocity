/* @solid */
import {
  createContext,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
  useContext,
} from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  AgentTask,
  CommandBlock,
  TerminalSession,
} from "../types";

// ── State ────────────────────────────────────────────────────────────

interface TerminalState {
  sessions: Map<string, TerminalSession>;
  activeSessionId: string | null;
}

function createDefaultSession(id: string, path: string): TerminalSession {
  return {
    id,
    path,
    blocks: [],
    agentTasks: [],
    inputValue: "",
    showWelcome: true,
    isActive: false,
    gitStatus: { branch: "main", changes: 0 },
  };
}

function isCompactableStatus(status: CommandBlock["status"]): boolean {
  return status === "success" || status === "error" || status === "interrupted";
}

/** Compact older completed blocks into a single summary block. Returns null if nothing to compact. */
function compactOlderBlocks(
  blocks: CommandBlock[],
  keepLastN: number
): CommandBlock[] | null {
  if (blocks.length <= keepLastN) return null;

  const recentBlocks = blocks.slice(-keepLastN);
  const olderBlocks = blocks.slice(0, -keepLastN);
  const compactable = olderBlocks.filter((b) => isCompactableStatus(b.status));
  if (compactable.length === 0) return null;

  const keptOlder = olderBlocks.filter((b) => !isCompactableStatus(b.status));
  const compactedBlock: CommandBlock = {
    id: `gc-${Date.now()}`,
    command: `${compactable.length} earlier command${compactable.length > 1 ? "s" : ""} (compacted)`,
    status: "success",
    timestamp:
      compactable[compactable.length - 1]?.timestamp ?? new Date(),
    compacted: true,
    compactedCount: compactable.length,
    isTruncated: false,
    lineCount: 0,
    outputSizeBytes: 0,
  };

  return [...keptOlder, compactedBlock, ...recentBlocks];
}

/** Update a single field on a session — eliminates repeated get/spread/set boilerplate. */
function updateSessionField<K extends keyof TerminalSession>(
  state: () => TerminalState,
  setState: (next: TerminalState) => void,
  sessionId: string,
  field: K,
  value: TerminalSession[K]
): void {
  const s = state();
  const session = s.sessions.get(sessionId);
  if (!session) return;
  setState({
    ...s,
    sessions: new Map(s.sessions).set(sessionId, {
      ...session,
      [field]: value,
    }),
  });
}

// ── Context ─────────────────────────────────────────────────────────

interface TerminalContextValue {
  state: () => TerminalState;
  setState: (next: TerminalState) => void;

  createSession: (path: string, id?: string) => string;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  setSessionPath: (sessionId: string, path: string) => void;
  appendBlock: (sessionId: string, block: CommandBlock) => void;
  upsertAgentTask: (sessionId: string, task: AgentTask) => void;
  updateBlock: (
    sessionId: string,
    blockId: string,
    partial: Partial<CommandBlock>
  ) => void;
  setBlockOutput: (
    sessionId: string,
    blockId: string,
    output: Pick<
      CommandBlock,
      "htmlOutput" | "rawOutput" | "isTruncated" | "lineCount" | "outputSizeBytes"
    >
  ) => void;
  setInputValue: (sessionId: string, value: string) => void;
  setShowWelcome: (sessionId: string, show: boolean) => void;
  setGitStatus: (
    sessionId: string,
    gitStatus: { branch: string; changes: number }
  ) => void;
  gcBlocks: (sessionId: string, keepLastN?: number) => void;
  onExecute: (sessionId: string, command: string) => void;
  startAgentTask: (
    sessionId: string,
    prompt: string,
    cwd: string
  ) => Promise<AgentTask>;
  revertAgentTask: (taskId: string) => Promise<AgentTask>;
}

const Ctx = createContext<TerminalContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

export function TerminalProvider(props: { children: any }) {
  const [state, setStateRaw] = createSignal<TerminalState>({
    sessions: new Map(),
    activeSessionId: null,
  });

  let latestState: TerminalState = state();

  const setState = (next: TerminalState) => {
    latestState = next;
    setStateRaw(next);
  };

  createEffect(() => {
    latestState = state();
  });

  // ── Rust event listeners ───────────────────────────────────────
  onMount(() => {
    const unlisteners: (() => void)[] = [];

    listen<AgentTask>("agent://update", (event) => {
      const task = event.payload;
      const cur = latestState;
      const session = cur.sessions.get(task.sessionId);
      if (!session) return;

      const existingIndex = session.agentTasks.findIndex(
        (t) => t.id === task.id
      );
      const agentTasks =
        existingIndex >= 0
          ? session.agentTasks.map((t) => (t.id === task.id ? task : t))
          : [...session.agentTasks, task];
      agentTasks.sort((a, b) => a.startedAt - b.startedAt);

      setState({
        ...cur,
        sessions: new Map(cur.sessions).set(task.sessionId, {
          ...session,
          agentTasks,
        }),
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    onCleanup(() => unlisteners.forEach((fn) => fn()));
  });

  // ── Actions ───────────────────────────────────────────────────

  const createSession = (path: string, id?: string): string => {
    const sessionId = id ?? crypto.randomUUID();
    const s = state();
    const next = new Map(s.sessions);
    next.set(sessionId, createDefaultSession(sessionId, path));
    setState({ ...s, sessions: next });

    invoke<{ branch: string; changes: number }>("get_git_status", { path })
      .then((gs) => {
        const cur = state();
        const sess = cur.sessions.get(sessionId);
        if (sess)
          setState({
            ...cur,
            sessions: new Map(cur.sessions).set(sessionId, {
              ...sess,
              gitStatus: gs,
            }),
          });
      })
      .catch(() => {});

    return sessionId;
  };

  const removeSession = (id: string): void => {
    const s = state();
    const next = new Map(s.sessions);
    next.delete(id);
    setState({
      ...s,
      sessions: next,
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    });
  };

  const setActiveSession = (id: string): void => {
    const s = state();
    const next = new Map(s.sessions);
    for (const [k, sess] of next) next.set(k, { ...sess, isActive: k === id });
    setState({ ...s, sessions: next, activeSessionId: id });
  };

  const setSessionPath = (sessionId: string, path: string): void => {
    updateSessionField(state, setState, sessionId, "path", path);
    invoke<{ branch: string; changes: number }>("get_git_status", { path })
      .then((gs) =>
        updateSessionField(state, setState, sessionId, "gitStatus", gs)
      )
      .catch(() => {});
  };

  const appendBlock = (sessionId: string, block: CommandBlock): void => {
    const s = state();
    const session = s.sessions.get(sessionId);
    if (!session) return;

    let finalBlocks = [...session.blocks, block];

    // Auto-GC when block count exceeds threshold
    const compacted = compactOlderBlocks(finalBlocks, 20);
    if (compacted) finalBlocks = compacted;

    setState({
      ...s,
      sessions: new Map(s.sessions).set(sessionId, {
        ...session,
        blocks: finalBlocks,
      }),
    });
  };

  const upsertAgentTask = (sessionId: string, task: AgentTask): void => {
    const s = state();
    const session = s.sessions.get(sessionId);
    if (!session) return;

    const existingIndex = session.agentTasks.findIndex(
      (t) => t.id === task.id
    );
    const agentTasks =
      existingIndex >= 0
        ? session.agentTasks.map((t) => (t.id === task.id ? task : t))
        : [...session.agentTasks, task];
    agentTasks.sort((a, b) => a.startedAt - b.startedAt);

    setState({
      ...s,
      sessions: new Map(s.sessions).set(sessionId, {
        ...session,
        agentTasks,
      }),
    });
  };

  const updateBlock = (
    sessionId: string,
    blockId: string,
    partial: Partial<CommandBlock>
  ): void => {
    const s = state();
    const session = s.sessions.get(sessionId);
    if (!session) return;
    setState({
      ...s,
      sessions: new Map(s.sessions).set(sessionId, {
        ...session,
        blocks: session.blocks.map((b) =>
          b.id === blockId ? { ...b, ...partial } : b
        ),
      }),
    });
  };

  const setBlockOutput = (
    sessionId: string,
    blockId: string,
    output: Pick<
      CommandBlock,
      "htmlOutput" | "rawOutput" | "isTruncated" | "lineCount" | "outputSizeBytes"
    >
  ): void => {
    const s = state();
    const session = s.sessions.get(sessionId);
    if (!session) return;
    setState({
      ...s,
      sessions: new Map(s.sessions).set(sessionId, {
        ...session,
        blocks: session.blocks.map((block) =>
          block.id === blockId
            ? { ...block, ...output }
            : block
        ),
      }),
    });
  };

  const setInputValue = (sessionId: string, value: string): void =>
    updateSessionField(state, setState, sessionId, "inputValue", value);

  const setShowWelcome = (sessionId: string, show: boolean): void =>
    updateSessionField(state, setState, sessionId, "showWelcome", show);

  const setGitStatus = (
    sessionId: string,
    gitStatus: { branch: string; changes: number }
  ): void =>
    updateSessionField(state, setState, sessionId, "gitStatus", gitStatus);

  const gcBlocks = (sessionId: string, keepLastN = 20): void => {
    const s = state();
    const session = s.sessions.get(sessionId);
    if (!session) return;

    const compacted = compactOlderBlocks(session.blocks, keepLastN);
    if (!compacted) return;

    setState({
      ...s,
      sessions: new Map(s.sessions).set(sessionId, {
        ...session,
        blocks: compacted,
      }),
    });
  };

  const onExecute = (_sessionId: string, command: string): void => {
    invoke("execute_command", { command }).catch((err) =>
      console.error("[TerminalContext] execute_command error:", err)
    );
  };

  const startAgentTask = async (
    sessionId: string,
    prompt: string,
    cwd: string
  ): Promise<AgentTask> => {
    const task = await invoke<AgentTask>("start_agent_task", {
      sessionId,
      prompt,
      cwd,
    });
    upsertAgentTask(sessionId, task);
    return task;
  };

  const revertAgentTask = async (taskId: string): Promise<AgentTask> => {
    const task = await invoke<AgentTask>("revert_agent_task", { taskId });
    upsertAgentTask(task.sessionId, task);
    return task;
  };

  const value: TerminalContextValue = {
    state,
    setState,
    createSession,
    removeSession,
    setActiveSession,
    setSessionPath,
    appendBlock,
    upsertAgentTask,
    updateBlock,
    setBlockOutput,
    setInputValue,
    setShowWelcome,
    setGitStatus,
    gcBlocks,
    onExecute,
    startAgentTask,
    revertAgentTask,
  };

  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

// ── Hook ────────────────────────────────────────────────────────────

export function useTerminalContext(): TerminalContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTerminalContext must be used within a <TerminalProvider>");
  }
  return ctx;
}
