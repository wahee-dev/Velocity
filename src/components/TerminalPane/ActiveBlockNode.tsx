/* @solid */
import { createEffect, onMount, onCleanup } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { ActiveBlockHandle } from "./TerminalPane";

interface ActiveBlockNodeProps {
  onReady?: (handle: ActiveBlockHandle) => void;
  onResize?: (size: { cols: number; rows: number }) => void | Promise<void>;
}

export function ActiveBlockNode(props: ActiveBlockNodeProps) {
  let containerRef: HTMLDivElement | undefined;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let webglAddon: WebglAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let rafId = 0;

  function syncFit() {
    if (!fitAddon || !terminal) return;

    try {
      fitAddon.fit();
      props.onResize?.({
        cols: terminal.cols,
        rows: terminal.rows,
      });
    } catch (error) {
      console.debug("[ActiveBlockNode] fit failed:", error);
    }
  }

  const handle: ActiveBlockHandle = {
    write(data: string) { terminal?.write(data); },
    clear() { terminal?.clear(); },
    focus() { terminal?.focus(); },
    scrollToBottom() { terminal?.scrollToBottom(); },
    fit() { syncFit(); },
    getSize() {
      return {
        cols: terminal?.cols ?? 0,
        rows: terminal?.rows ?? 0,
      };
    },
  };

  onMount(async () => {
    const container = containerRef;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 5000,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      theme: {
        background: "#050505",
        foreground: "#e8e8e8",
        cursor: "#f5f5f5",
        selectionBackground: "#264f78",
        black: "#050505",
        red: "#df5f67",
        green: "#8bd49c",
        yellow: "#f0c674",
        blue: "#7aa2f7",
        magenta: "#c792ea",
        cyan: "#74c7ec",
        white: "#f5f5f5",
        brightBlack: "#5a5f73",
        brightRed: "#ff7a90",
        brightGreen: "#9fe8ad",
        brightYellow: "#ffd682",
        brightBlue: "#8db5ff",
        brightMagenta: "#d6a4ff",
        brightCyan: "#95e0ff",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    const fa = new FitAddon();
    term.loadAddon(fa);

    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    term.open(container);

    try {
      const wa = new WebglAddon();
      term.loadAddon(wa);
      webglAddon = wa;
    } catch {
      console.debug("[ActiveBlockNode] WebGL addon unavailable, using fallback renderer");
    }

    term.attachCustomKeyEventHandler(() => {
      // Let input field handle keys when it's focused
      if (document.activeElement?.tagName === "INPUT") return false;
      return true;
    });

    terminal = term;
    fitAddon = fa;

    const scheduleFit = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        syncFit();
        term.scrollToBottom();
      });
    };

    scheduleFit();
    resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    window.addEventListener("resize", scheduleFit);

    props.onReady?.(handle);
    term.focus();

    return () => {
      window.removeEventListener("resize", scheduleFit);
    };
  });

  onCleanup(() => {
    cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    webglAddon?.dispose();
    webglAddon = null;
    terminal?.dispose();
    terminal = null;
    fitAddon = null;
  });

  return (
    <div class="active-block">
      <div class="active-block-terminal" ref={containerRef!} />
    </div>
  );
}
