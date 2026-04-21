import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MoreVertical, 
  X, 
  GitBranch,
  Folder,
  Check
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { CommandBlock, GitStatus } from '../../types';
import './TerminalPane.css';

interface TerminalPaneProps {
  path: string;
  isActive?: boolean;
}

export function TerminalPane({ path, isActive = true }: TerminalPaneProps) {
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const [gitStatus] = useState<GitStatus>({ branch: 'main', changes: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  async function handleExecuteCommand() {
    if (!inputValue.trim()) return;

    const newBlock: CommandBlock = {
      id: crypto.randomUUID(),
      command: inputValue,
      status: 'running',
      timestamp: new Date(),
    };

    setBlocks(prev => [...prev, newBlock]);
    setInputValue('');
    setShowWelcome(false);

    try {
      const output = await invoke<string>('execute_command', { command: inputValue });
      setBlocks(prev => prev.map(b => 
        b.id === newBlock.id 
          ? { ...b, status: 'success', output } 
          : b
      ));
    } catch (error) {
      setBlocks(prev => prev.map(b => 
        b.id === newBlock.id 
          ? { ...b, status: 'error', output: String(error) } 
          : b
      ));
    }

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
    try {
      await invoke('close_pane');
    } catch (error) {
      console.error('[Tauri] close_pane failed:', error);
    }
  }

  const fullDisplayPath = `~\\_cuments\\Code\\Big Apps\\Velocity\\velocity`;

  return (
    <div className={`terminal-pane ${isActive ? 'active' : ''}`}>
      <div className="pane-header">
        <div className="pane-title">
          <span className="pane-path">{path}</span>
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

      <div className="pane-content" ref={containerRef}>
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
            onChange={(e) => setInputValue(e.target.value)}
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
