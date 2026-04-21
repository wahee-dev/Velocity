import { useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MoreVertical,
  X,
  GitBranch,
  Folder,
  Check
} from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTerminalContext } from '../../context/TerminalContext';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CommandBlock } from '../../types';
import './TerminalPane.css';

interface TerminalPaneProps {
  sessionId: string;
}

export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const context = useTerminalContext();
  const session = context.state.sessions.get(sessionId);

  const inputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // XTerm state
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptySessionIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void)[]>([]);

  // Fallback if session not yet in context
  const blocks = session?.blocks ?? [];
  const inputValue = session?.inputValue ?? '';
  const showWelcome = session?.showWelcome ?? true;
  const gitStatus = session?.gitStatus ?? { branch: 'main', changes: 0 };
  const isActive = session?.isActive ?? false;

  // ── Spawn PTY & initialize XTerm on mount ──────────────────────
  useEffect(() => {
    async function initTerminal() {
      if (!terminalRef.current) return;

      // Spawn PTY session on the Rust side
      const ptyInfo = await invoke<{ id: string; cwd: string }>('spawn_pty', {
        paneId: sessionId,
      });
      ptySessionIdRef.current = ptyInfo.id;

      // Create XTerm instance
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
        theme: {
          background: '#000000',
          foreground: '#e4e4e4',
          cursor: '#e4e4e4',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);

      // Auto-fit to container
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Listen for PTY output from Rust
      const unlistenOutput = await listen<{
        sessionId: string;
        paneId: string;
        data: string;
      }>('pty://output', (event) => {
        if (event.payload.sessionId === ptySessionIdRef.current) {
          term.write(event.payload.data);
        }
      });

      // Listen for PTY close event
      const unlistenClosed = await listen<{
        sessionId: string;
        paneId: string;
      }>('pty://closed', (event) => {
        if (event.payload.sessionId === ptySessionIdRef.current) {
          term.write('\r\n\x1b[90m[Session terminated]\x1b[0m\r\n');
        }
      });

      // Listen for CWD changes
      const unlistenCwd = await listen<{
        sessionId: string;
        paneId: string;
        cwd: string;
      }>('cwd-changed', (event) => {
        if (event.payload.sessionId === ptySessionIdRef.current) {
          // Could update path display here
        }
      });

      unlistenRef.current.push(unlistenOutput, unlistenClosed, unlistenCwd);

      // Focus the terminal
      term.focus();
    }

    initTerminal();

    return () => {
      // Cleanup listeners
      unlistenRef.current.forEach(fn => fn());
      unlistenRef.current = [];

      // Dispose XTerm
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
      }

      // Kill PTY session
      if (ptySessionIdRef.current) {
        invoke('kill_pty', { sessionId: ptySessionIdRef.current }).catch(() => {});
        ptySessionIdRef.current = null;
      }
    };
  }, [sessionId]);

  // ── Resize XTerm when container size changes ───────────────────
  useEffect(() => {
    function handleResize() {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    }

    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // ── Auto-focus active terminal ─────────────────────────────────
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.focus();
    } else if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  // ── Send input to PTY ──────────────────────────────────────────
  const sendToPty = useCallback((data: string) => {
    if (ptySessionIdRef.current) {
      invoke('write_to_pty', { sessionId: ptySessionIdRef.current, data });
    }
  }, []);

  function handleExecuteCommand() {
    if (!inputValue.trim()) return;

    const newBlock: CommandBlock = {
      id: crypto.randomUUID(),
      command: inputValue,
      status: 'running',
      timestamp: new Date(),
    };

    context.appendBlock(sessionId, newBlock);
    context.setInputValue(sessionId, '');
    context.setShowWelcome(sessionId, false);

    // Send command to PTY (with newline to execute)
    sendToPty(inputValue + '\r');

    // Scroll to bottom
    setTimeout(() => {
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleExecuteCommand();
    }
  }

  async function handleClosePane() {
    if (ptySessionIdRef.current) {
      await invoke('kill_pty', { sessionId: ptySessionIdRef.current });
    }
    context.removeSession(sessionId);
  }

  const fullDisplayPath = session?.path ?? '~\\Documents\\Code\\Big Apps\\Velocity\\velocity';

  return (
    <div className={`terminal-pane ${isActive ? 'active' : ''}`}>
      <div className="pane-header">
        <div className="pane-title">
          <span className="pane-path">{fullDisplayPath}</span>
        </div>
        <div className="pane-actions">
          <button className="pane-btn">
            <MoreVertical size={14} />
          </button>
          <button className="pane-btn" onClick={handleClosePane}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div
        className="pane-content"
        ref={containerRef}
        data-terminal-id={sessionId}
      >
        {/* XTerm.js canvas — the live terminal */}
        <div className="xterm-container active" ref={terminalRef} />

        {/* Warp-style welcome overlay (shown until first command) */}
        <AnimatePresence>
          {showWelcome && (
            <motion.div
              className="welcome-section"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="welcome-header">
                <span className="welcome-icon">📟</span>
                <span className="welcome-title">New terminal session</span>
              </div>
              <div className="welcome-shortcuts">
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>ctrl</kbd><kbd>shift</kbd><kbd>↵</kbd>
                  </span>
                  <span className="shortcut-desc">start a new agent conversation</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>ctrl</kbd><kbd>alt</kbd><kbd>↵</kbd>
                  </span>
                  <span className="shortcut-desc">start a new cloud agent conversation</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>↑</kbd>
                  </span>
                  <span className="shortcut-desc">cycle past commands and conversations</span>
                </div>
                <div className="shortcut-item">
                  <span className="shortcut-keys">
                    <kbd>ctrl</kbd><kbd>shift</kbd><kbd>+</kbd>
                  </span>
                  <span className="shortcut-desc">open code review</span>
                </div>
                <div className="shortcut-item checkbox-item">
                  <Check size={12} className="check-icon" />
                  <span className="shortcut-desc">autodetect agent prompts in terminal sessions</span>
                </div>
              </div>
              <span className="dont-show">Don&apos;t show again</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warp-style command block history */}
        {blocks.map((block) => (
          <motion.div
            key={block.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="command-block"
          >
            <div className="block-command">
              <span className="prompt-symbol">$</span>
              <span className="command-text">{block.command}</span>
            </div>
            {block.output && (
              <div className={`block-output ${block.status}`}>
                {block.output}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="pane-footer">
        <div className="status-bar">
          <span className="version-badge">v25.8.1</span>
          <div className="path-info">
            <Folder size={12} />
            <span>{fullDisplayPath}</span>
          </div>
          <div className="git-info">
            <GitBranch size={12} />
            <span className="branch-name">{gitStatus.branch}</span>
          </div>
          <span className="git-changes">± {gitStatus.changes}</span>
        </div>
        <div className="input-container">
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Warp anything e.g. Create unit tests for my authentication service"
            value={inputValue}
            onChange={(e) => context.setInputValue(sessionId, e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-hint">
            <span>ctrl-shift-↵</span>
            <span className="hint-action">new /agent conversation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
