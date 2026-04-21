import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FilePlus,
  Copy,
  Search,
  Files,
  X,
  ChevronRight,
  Folder,
  FileText,
  FileCode
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import type { FileNode } from '../../types';
import './FileExplorer.css';

/** Internal type that tracks the full filesystem path for each node */
interface TrackedFileNode extends FileNode {
  fullPath: string;
}

interface FileExplorerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FileExplorer({ isOpen, onClose }: FileExplorerProps) {
  const [fileTree, setFileTree] = useState<TrackedFileNode[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // ── Load root directory on mount ───────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    async function loadRoot() {
      setLoading(true);
      try {
        // Get the current working directory from Rust
        const info = await invoke<Record<string, string>>('get_system_info');
        const cwd = info['current_dir'] || '';
        const nodes = await invoke<FileNode[]>('read_dir', { path: cwd });
        setFileTree(
          nodes.map(n => ({ ...n, fullPath: `${cwd}\\${n.name}` }))
        );
      } catch (error) {
        console.error('[FileExplorer] Failed to load root:', error);
      } finally {
        setLoading(false);
      }
    }

    loadRoot();
  }, [isOpen]);

  // ── Load children when expanding a folder ───────────────────────
  const loadChildren = useCallback(async (node: TrackedFileNode) => {
    if (node.children && node.children.length > 0) return; // Already loaded

    try {
      const childNodes = await invoke<FileNode[]>('read_dir', { path: node.fullPath });
      const tracked = childNodes.map(n => ({
        ...n,
        fullPath: `${node.fullPath}\\${n.name}`,
      }));

      setFileTree(prev => updateNodeChildren(prev, node.id, tracked));
    } catch (error) {
      console.error('[FileExplorer] Failed to load children:', error);
    }
  }, []);

  async function handleSelectFile(node: TrackedFileNode) {
    setSelectedId(node.id);
    if (node.type === 'file') {
      try {
        await invoke('open_file', { path: node.fullPath });
      } catch (error) {
        console.error('[Tauri] open_file failed:', error);
      }
    }
  }

  function handleToggleFolder(node: TrackedFileNode) {
    // Toggle expanded state
    setFileTree(prev => toggleNode(prev, node.id));

    // If expanding and no children loaded yet, fetch them
    const current = findNode(fileTree, node.id);
    if (current && !current.isExpanded && (!current.children || current.children.length === 0)) {
      loadChildren(node);
    }
  }

  /** Recursively find a node by ID in the tree */
  function findNode(nodes: TrackedFileNode[], id: string): TrackedFileNode | undefined {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const found = findNode(n.children as TrackedFileNode[], id);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Update children of a specific node in the tree */
  function updateNodeChildren(
    nodes: TrackedFileNode[],
    targetId: string,
    newChildren: TrackedFileNode[]
  ): TrackedFileNode[] {
    return nodes.map(node => {
      if (node.id === targetId) {
        return { ...node, children: newChildren };
      }
      if (node.children) {
        return {
          ...node,
          children: updateNodeChildren(node.children as TrackedFileNode[], targetId, newChildren),
        };
      }
      return node;
    });
  }

  function toggleNode(nodes: TrackedFileNode[], targetId: string): TrackedFileNode[] {
    return nodes.map(node => {
      if (node.id === targetId) {
        return { ...node, isExpanded: !node.isExpanded };
      }
      if (node.children) {
        return { ...node, children: toggleNode(node.children as TrackedFileNode[], targetId) };
      }
      return node;
    });
  }

  function getFileIcon(name: string) {
    if (name.endsWith('.json')) return <FileCode size={14} className="file-icon json" />;
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return <FileCode size={14} className="file-icon ts" />;
    if (name.endsWith('.md')) return <FileText size={14} className="file-icon md" />;
    if (name.endsWith('.html')) return <FileCode size={14} className="file-icon html" />;
    return <FileText size={14} className="file-icon" />;
  }

  function renderNode(node: TrackedFileNode, depth: number = 0) {
    const isFolder = node.type === 'folder';
    const paddingLeft = 12 + depth * 16;

    return (
      <div key={node.id}>
        <div
          className={`file-item ${selectedId === node.id ? 'selected' : ''}`}
          style={{ paddingLeft }}
          onClick={() => isFolder ? handleToggleFolder(node) : handleSelectFile(node)}
        >
          {isFolder && (
            <ChevronRight
              size={12}
              className={`folder-chevron ${node.isExpanded ? 'expanded' : ''}`}
            />
          )}
          {isFolder ? (
            <Folder size={14} className="folder-icon" />
          ) : (
            getFileIcon(node.name)
          )}
          <span className="file-name">{node.name}</span>
        </div>
        <AnimatePresence>
          {isFolder && node.isExpanded && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {(node.children as TrackedFileNode[]).map(child => renderNode(child, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="file-explorer">
      <div className="explorer-toolbar">
        <button className="explorer-btn">
          <FilePlus size={14} />
        </button>
        <button className="explorer-btn">
          <Copy size={14} />
        </button>
        <button className="explorer-btn">
          <Search size={14} />
        </button>
        <button className="explorer-btn">
          <Files size={14} />
        </button>
        <div className="explorer-spacer" />
        <button className="explorer-btn close-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="explorer-content">
        {loading ? (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
            Loading files...
          </div>
        ) : fileTree.length > 0 ? (
          fileTree.map(node => renderNode(node))
        ) : (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
            No files found
          </div>
        )}
      </div>
    </div>
  );
}
