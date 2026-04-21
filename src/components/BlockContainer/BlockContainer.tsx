import { useState, useRef, useEffect } from 'react';
import {
  Play,
  Square,
  Copy,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { handleExecuteCommand, handleCancelCommand, handleCopyToClipboard } from '../../hooks/useTauri';
import type { CommandBlock } from '../../types';
import './BlockContainer.css';

// Mock data for demonstration
const mockBlocks: CommandBlock[] = [
  {
    id: 'block-1',
    command: 'git status',
    output: `On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
        modified:   src/App.tsx
        modified:   package.json

no changes added to commit (use "git add" and/or "git commit -a")`,
    status: 'success',
    timestamp: new Date(Date.now() - 300000),
    exitCode: 0,
    duration: 45,
  },
  {
    id: 'block-2',
    command: 'npm run build',
    output: `> velocity@0.1.0 build
> tsc && vite build

vite v7.0.4 building for production...
✓ 143 modules transformed.
dist/index.html                   0.46 kB │ gzip:  0.30 kB
dist/assets/index-DiwrgTda.css    1.39 kB │ gzip:  0.72 kB
dist/assets/index-C7FbVhMK.js   143.35 kB │ gzip: 46.01 kB
✓ built in 2.34s`,
    status: 'success',
    timestamp: new Date(Date.now() - 180000),
    exitCode: 0,
    duration: 2340,
  },
  {
    id: 'block-3',
    command: 'docker compose up -d',
    output: `[+] Running 3/3
 ✔ Network app_default     Created
 ✔ Container app-redis-1   Started
 ✔ Container app-db-1      Started`,
    status: 'success',
    timestamp: new Date(Date.now() - 60000),
    exitCode: 0,
    duration: 1250,
  },
];

interface CommandCardProps {
  block: CommandBlock;
  onCopy: (text: string) => void;
  onCancel: (blockId: string) => void;
  onRerun: (command: string) => void;
}

function CommandCard({ block, onCopy, onCancel, onRerun }: CommandCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showActions, setShowActions] = useState(false);

  const getStatusIcon = () => {
    switch (block.status) {
      case 'running':
        return <Loader2 size={14} className="status-icon spinning" />;
      case 'success':
        return <CheckCircle size={14} className="status-icon success" />;
      case 'error':
        return <XCircle size={14} className="status-icon error" />;
      default:
        return <ChevronRight size={14} className="status-icon" />;
    }
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className={`command-card ${block.status}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Command Header */}
      <div className="command-header">
        <button
          className="command-toggle"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {getStatusIcon()}
        </button>
        
        <div className="command-prompt">
          <span className="prompt-symbol">$</span>
          <span className="command-text">{block.command}</span>
        </div>

        <div className={`command-actions ${showActions ? 'visible' : ''}`}>
          {block.status === 'running' ? (
            <button
              className="action-btn cancel"
              onClick={() => onCancel(block.id)}
              title="Cancel"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="action-btn"
              onClick={() => onRerun(block.command)}
              title="Rerun"
            >
              <Play size={14} />
            </button>
          )}
          <button
            className="action-btn"
            onClick={() => onCopy(block.command)}
            title="Copy command"
          >
            <Copy size={14} />
          </button>
          <button className="action-btn" title="More actions">
            <MoreHorizontal size={14} />
          </button>
        </div>

        <div className="command-meta">
          {block.duration && (
            <span className="meta-duration">{formatDuration(block.duration)}</span>
          )}
          <span className="meta-timestamp">{formatTimestamp(block.timestamp)}</span>
        </div>
      </div>

      {/* Command Output */}
      {isExpanded && block.output && (
        <div className="command-output">
          <pre>{block.output}</pre>
          <button
            className="copy-output-btn"
            onClick={() => onCopy(block.output)}
            title="Copy output"
          >
            <Copy size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

export function BlockContainer() {
  const [blocks, setBlocks] = useState<CommandBlock[]>(mockBlocks);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new blocks are added
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [blocks.length]);

  const handleCopy = async (text: string) => {
    try {
      await handleCopyToClipboard(text);
    } catch {
      // Fallback to browser clipboard API
      await navigator.clipboard.writeText(text);
    }
  };

  const handleCancel = async (blockId: string) => {
    try {
      await handleCancelCommand(blockId);
      setBlocks((prev) =>
        prev.map((block) =>
          block.id === blockId ? { ...block, status: 'error' } : block
        )
      );
    } catch {
      console.log('Canceling command:', blockId);
    }
  };

  const handleRerun = async (command: string) => {
    try {
      const newBlock: CommandBlock = {
        id: `block-${Date.now()}`,
        command,
        output: '',
        status: 'running',
        timestamp: new Date(),
      };
      setBlocks((prev) => [...prev, newBlock]);
      
      const result = await handleExecuteCommand(command);
      
      setBlocks((prev) =>
        prev.map((block) =>
          block.id === newBlock.id
            ? { ...block, output: result, status: 'success', exitCode: 0 }
            : block
        )
      );
    } catch (error) {
      console.log('Executing command:', command);
    }
  };

  return (
    <div className="block-container" ref={containerRef}>
      <div className="blocks-wrapper">
        {blocks.map((block) => (
          <CommandCard
            key={block.id}
            block={block}
            onCopy={handleCopy}
            onCancel={handleCancel}
            onRerun={handleRerun}
          />
        ))}
      </div>
      
      {/* Scroll fade gradient at bottom */}
      <div className="scroll-fade" />
    </div>
  );
}
