import { useState } from 'react';
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

const mockFileTree: FileNode[] = [
  {
    id: '1',
    name: 'velocity',
    type: 'folder',
    isExpanded: true,
    children: [
      { id: '2', name: '.git', type: 'folder', children: [] },
      { id: '3', name: '.vscode', type: 'folder', children: [] },
      { id: '4', name: 'node_modules', type: 'folder', children: [] },
      { id: '5', name: 'public', type: 'folder', children: [] },
      { id: '6', name: 'src', type: 'folder', children: [] },
      { id: '7', name: 'src-tauri', type: 'folder', children: [] },
      { id: '8', name: '.gitignore', type: 'file' },
      { id: '9', name: 'README.md', type: 'file' },
      { id: '10', name: 'bun.lock', type: 'file' },
      { id: '11', name: 'index.html', type: 'file' },
      { id: '12', name: 'package-lock.json', type: 'file' },
      { id: '13', name: 'package.json', type: 'file' },
      { id: '14', name: 'tsconfig.json', type: 'file' },
      { id: '15', name: 'tsconfig.node.json', type: 'file' },
      { id: '16', name: 'vite.config.ts', type: 'file' },
    ]
  }
];

interface FileExplorerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FileExplorer({ isOpen, onClose }: FileExplorerProps) {
  const [fileTree, setFileTree] = useState<FileNode[]>(mockFileTree);
  const [selectedId, setSelectedId] = useState<string>('1');

  async function handleSelectFile(node: FileNode) {
    setSelectedId(node.id);
    if (node.type === 'file') {
      try {
        await invoke('open_file', { path: node.name });
      } catch (error) {
        console.error('[Tauri] open_file failed:', error);
      }
    }
  }

  function handleToggleFolder(nodeId: string) {
    setFileTree(prev => toggleNode(prev, nodeId));
  }

  function toggleNode(nodes: FileNode[], targetId: string): FileNode[] {
    return nodes.map(node => {
      if (node.id === targetId) {
        return { ...node, isExpanded: !node.isExpanded };
      }
      if (node.children) {
        return { ...node, children: toggleNode(node.children, targetId) };
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

  function renderNode(node: FileNode, depth: number = 0) {
    const isFolder = node.type === 'folder';
    const paddingLeft = 12 + depth * 16;

    return (
      <div key={node.id}>
        <div
          className={`file-item ${selectedId === node.id ? 'selected' : ''}`}
          style={{ paddingLeft }}
          onClick={() => isFolder ? handleToggleFolder(node.id) : handleSelectFile(node)}
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
              {node.children.map(child => renderNode(child, depth + 1))}
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
        {fileTree.map(node => renderNode(node))}
      </div>
    </div>
  );
}
