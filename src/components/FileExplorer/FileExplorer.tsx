/* @solid */
import {
  createSignal,
  createEffect,
  onMount,
  Show,
} from "solid-js";
import {
  FilePlus,
  Copy,
  Search,
  Files,
  X,
  ChevronRight,
  Folder,
  FileText,
  FileCode,
} from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode } from "../../types";
import "./FileExplorer.css";

interface TrackedFileNode extends FileNode {
  fullPath: string;
}

interface PathTreeState {
  path: string;
  nodes: TrackedFileNode[];
  loading: boolean;
}

interface FileExplorerProps {
  isOpen: boolean;
  rootPaths: string[];
  onClose: () => void;
  onFileOpen?: (filePath: string, fileName: string) => void;
}

export function FileExplorer(props: FileExplorerProps) {
  const [trees, setTrees] = createSignal<PathTreeState[]>([]);
  const [selectedId, setSelectedId] = createSignal("");

  // Load directory trees when rootPaths change
  createEffect(() => {
    if (!props.isOpen || props.rootPaths.length === 0) return;

    const newTrees: PathTreeState[] = props.rootPaths.map((path) => ({
      path,
      nodes: [],
      loading: true,
    }));
    setTrees(newTrees);

    Promise.allSettled(
      props.rootPaths.map((path) =>
        invoke<FileNode[]>("read_dir", { path }).then((nodes) => ({
          path,
          nodes: nodes.map((n) => ({
            ...n,
            fullPath: `${path}\\${n.name}`,
          })),
        }))
      )
    ).then((results) => {
      setTrees((prev) =>
        prev.map((t, idx) => {
          const result = results[idx];
          if (result.status === "fulfilled") {
            return { ...t, nodes: result.value.nodes, loading: false };
          }
          return { ...t, loading: false };
        })
      );
    });
  });

  async function loadChildren(treeIndex: number, node: TrackedFileNode) {
    if (node.children && node.children.length > 0) return;

    try {
      const childNodes = await invoke<FileNode[]>("read_dir", {
        path: node.fullPath,
      });
      const tracked = childNodes.map((n) => ({
        ...n,
        fullPath: `${node.fullPath}\\${n.name}`,
      }));

      setTrees((prev) =>
        prev.map((t, idx) => {
          if (idx !== treeIndex) return t;
          return { ...t, nodes: updateNodeChildren(t.nodes, node.id, tracked) };
        })
      );
    } catch {}
  }

  async function handleSelectFile(_treeIndex: number, node: TrackedFileNode) {
    setSelectedId(node.id);
    if (node.type === "file") {
      if (props.onFileOpen) {
        props.onFileOpen(node.fullPath, node.name);
      } else {
        try {
          await invoke("open_file", { path: node.fullPath });
        } catch {}
      }
    }
  }

  function handleToggleFolder(treeIndex: number, node: TrackedFileNode) {
    const currentTree = trees()[treeIndex];
    if (!currentTree) return;

    trees((prev) =>
      prev.map((t, idx) => {
        if (idx !== treeIndex) return t;
        return { ...t, nodes: toggleNode(t.nodes, node.id) };
      })
    );

    const current = findNode(currentTree.nodes, node.id);
    if (current && !current.isExpanded && (!current.children || current.children.length === 0)) {
      loadChildren(treeIndex, node);
    }
  }

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

  function updateNodeChildren(
    nodes: TrackedFileNode[],
    targetId: string,
    newChildren: TrackedFileNode[]
  ): TrackedFileNode[] {
    return nodes.map((node) => {
      if (node.id === targetId) return { ...node, children: newChildren };
      if (node.children) {
        return {
          ...node,
          children: updateNodeChildren(
            node.children as TrackedFileNode[],
            targetId,
            newChildren
          ),
        };
      }
      return node;
    });
  }

  function toggleNode(nodes: TrackedFileNode[], targetId: string): TrackedFileNode[] {
    return nodes.map((node) => {
      if (node.id === targetId)
        return { ...node, isExpanded: !node.isExpanded };
      if (node.children) {
        return {
          ...node,
          children: toggleNode(node.children as TrackedFileNode[], targetId),
        };
      }
      return node;
    });
  }

  function getFileIcon(name: string) {
    if (name.endsWith(".json"))
      return <FileCode size={14} class="file-icon json" />;
    if (name.endsWith(".ts") || name.endsWith(".tsx"))
      return <FileCode size={14} class="file-icon ts" />;
    if (name.endsWith(".md")) return <FileText size={14} class="file-icon md" />;
    if (name.endsWith(".html"))
      return <FileCode size={14} class="file-icon html" />;
    return <FileText size={14} class="file-icon" />;
  }

  function renderNode(treeIndex: number, node: TrackedFileNode, depth = 0) {
    const isFolder = node.type === "folder";
    const paddingLeft = 12 + depth * 16;

    return (
      <div>
        <div
          class={`file-item ${selectedId() === node.id ? "selected" : ""}`}
          style={{ paddingLeft }}
          onClick={() =>
            isFolder
              ? handleToggleFolder(treeIndex, node)
              : handleSelectFile(treeIndex, node)
          }
        >
          {isFolder && (
            <ChevronRight
              size={12}
              class={`folder-chevron ${node.isExpanded ? "expanded" : ""}`}
            />
          )}
          {isFolder ? (
            <Folder size={14} class="folder-icon" />
          ) : (
            getFileIcon(node.name)
          )}
          <span class="file-name">{node.name}</span>
        </div>
        <Show when={isFolder && node.isExpanded && !!node.children?.length}>
          {(node.children as TrackedFileNode[]).map((child) =>
            renderNode(treeIndex, child, depth + 1)
          )}
        </Show>
      </div>
    );
  }

  if (!props.isOpen) return null;

  return (
    <div class="file-explorer">
      <div class="explorer-toolbar">
        <button class="explorer-btn">
          <FilePlus size={14} />
        </button>
        <button class="explorer-btn">
          <Copy size={14} />
        </button>
        <button class="explorer-btn">
          <Search size={14} />
        </button>
        <button class="explorer-btn">
          <Files size={14} />
        </button>
        <div class="explorer-spacer" />
        <button class="explorer-btn close-btn" onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>

      <div class="explorer-content">
        {trees().map((tree, treeIndex) => (
          <div key={tree.path} class="tree-section">
            <div class="tree-section-header">
              <Folder size={12} class="section-folder-icon" />
              <span class="tree-section-title">{tree.path}</span>
            </div>
            <Show
              when={tree.loading}
              fallback={
                tree.nodes.length > 0 ? (
                  tree.nodes.map((node) => renderNode(treeIndex, node))
                ) : (
                  <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
                    No files found
                  </div>
                )
              }
            >
              <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
                Loading files...
              </div>
            </Show>
          </div>
        ))}
      </div>
    </div>
  );
}
