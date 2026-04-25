/* @solid */
import { BLOCK_CONFIG, type CommandBlock, type OutputCapture } from "../types";
import Convert from "ansi-to-html";

const encoder = new TextEncoder();
const ansiConverter = new Convert({ escapeXML: true, newline: true });
const OSC_SEQUENCE_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_SEQUENCE_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ALT_SCREEN_ENTER_SEQUENCES = ["\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h"];
const ALT_SCREEN_EXIT_SEQUENCES = ["\x1b[?1049l", "\x1b[?1047l", "\x1b[?47l"];

export function createEmptyCapture(): OutputCapture {
  return {
    _chunks: [],
    byteSize: 0,
    lineCount: 0,
    isTruncated: false,
    isAlternateScreenActive: false,
  };
}

function countLines(value: string): number {
  if (!value) return 0;
  return value.split("\n").length;
}

function stripControlSequences(value: string): string {
  return value.replace(OSC_SEQUENCE_PATTERN, "").replace(CSI_SEQUENCE_PATTERN, "");
}

export function looksLikePrompt(value: string): boolean {
  if (!value || value.length > 160) return false;
  return (
    /^[A-Za-z]:\\.*>\s*$/.test(value) ||
    /^[~./\\\w:@-]+[#$>]\s*$/.test(value) ||
    /^[^ ]+@[^ ]+:[^ ]+[#$]\s*$/.test(value)
  );
}

function normalizeCapturedOutput(rawOutput: string, command: string): string {
  let sanitized = rawOutput
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(OSC_SEQUENCE_PATTERN, "")
    .replace(/\x1b\[\?1049[hl]/g, "")
    .replace(/\x1b\[\?1047[hl]/g, "")
    .replace(/\x1b\[\?47[hl]/g, "");

  const lines = sanitized.split("\n");
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && stripControlSequences(lines[start]).trim() === "") start += 1;
  while (end >= start && stripControlSequences(lines[end]).trim() === "") end -= 1;

  if (start > end) return "";

  let visibleLines = lines.slice(start, end + 1);

  // Strip any lines containing exit marker artifacts (echoed wrap commands)
  visibleLines = visibleLines.filter(
    (line) => !stripControlSequences(line).includes("__VELOCITY_EXIT__")
  );

  // Strip echoed command from first line
  const firstLine = stripControlSequences(visibleLines[0]).trim();
  const promptEchoMatch = firstLine.match(/[>$#]\s*(.*)$/);
  const echoedCommand = promptEchoMatch?.[1]?.trim() ?? firstLine;
  if (echoedCommand === command.trim()) visibleLines.shift();

  // Strip trailing prompt
  const lastLine =
    visibleLines.length > 0
      ? stripControlSequences(visibleLines[visibleLines.length - 1]).trim()
      : "";
  if (looksLikePrompt(lastLine)) visibleLines.pop();

  while (visibleLines.length > 0 && stripControlSequences(visibleLines[0]).trim() === "") visibleLines.shift();
  while (visibleLines.length > 0 && stripControlSequences(visibleLines[visibleLines.length - 1]).trim() === "") visibleLines.pop();

  return visibleLines.join("\n");
}

function updateAlternateScreenState(current: boolean, data: string): boolean {
  let lastToggle: boolean | null = null;

  for (const seq of ALT_SCREEN_ENTER_SEQUENCES) {
    if (data.includes(seq)) lastToggle = true;
  }
  for (const seq of ALT_SCREEN_EXIT_SEQUENCES) {
    if (data.includes(seq)) lastToggle = false;
  }

  return lastToggle ?? current;
}

/** Convert ANSI string to styled HTML. Uses shared converter instance. */
export function convertAnsiToHtml(value: string): string {
  return ansiConverter.toHtml(value);
}

function materializeOutput(
  capture: OutputCapture,
  command: string
): Pick<CommandBlock, "htmlOutput" | "rawOutput" | "isTruncated" | "lineCount" | "outputSizeBytes"> {
  // Join accumulated chunks once — O(n) total instead of O(n²)
  const rawOutput = capture._chunks.join("");
  const normalizedOutput = normalizeCapturedOutput(rawOutput, command);
  const outputSizeBytes = encoder.encode(normalizedOutput).length;
  const lineCount = countLines(normalizedOutput);

  if (!normalizedOutput) {
    return {
      htmlOutput: undefined,
      rawOutput: undefined,
      isTruncated: capture.isTruncated,
      lineCount: 0,
      outputSizeBytes: 0,
    };
  }

  if (outputSizeBytes <= BLOCK_CONFIG.SMALL_OUTPUT_THRESHOLD) {
    return {
      htmlOutput: convertAnsiToHtml(normalizedOutput),
      rawOutput: undefined,
      isTruncated: capture.isTruncated,
      lineCount,
      outputSizeBytes,
    };
  }

  return {
    htmlOutput: undefined,
    rawOutput: normalizedOutput,
    isTruncated: capture.isTruncated,
    lineCount,
    outputSizeBytes,
  };
}

function appendChunk(current: OutputCapture, data: string): OutputCapture {
  const chunkBytes = encoder.encode(data).length;
  const nextAltScreenState = updateAlternateScreenState(
    current.isAlternateScreenActive,
    data
  );

  if (current.isTruncated)
    return { ...current, isAlternateScreenActive: nextAltScreenState };

  const nextSize = current.byteSize + chunkBytes;

  if (nextSize > BLOCK_CONFIG.MAX_RAW_OUTPUT_BYTES) {
    return {
      ...current,
      isTruncated: true,
      isAlternateScreenActive: nextAltScreenState,
    };
  }

  // Push to array instead of string concat — avoids O(n²) allocation
  return {
    _chunks: [...current._chunks, data],
    byteSize: nextSize,
    lineCount: current.lineCount + (data.match(/\n/g)?.length ?? 0),
    isTruncated: false,
    isAlternateScreenActive: nextAltScreenState,
  };
}

/**
 * Factory for output capture. Returns methods to manage per-block capture.
 * Framework-agnostic — works with both React and SolidJS.
 * Accumulates chunks in an array for O(n) finalization instead of O(n²) string concat.
 */
export function createOutputCapture() {
  let activeBlockId: string | null = null;
  let capture: OutputCapture = createEmptyCapture();

  const startCapture = (blockId: string) => {
    activeBlockId = blockId;
    capture = createEmptyCapture();
  };

  const appendOutput = (data: string): OutputCapture => {
    capture = appendChunk(capture, data);
    return capture;
  };

  const clearCapture = () => {
    activeBlockId = null;
    capture = createEmptyCapture();
  };

  const finalizeCapture = (command: string) => {
    const blockId = activeBlockId;
    const currentCapture = capture;
    activeBlockId = null;
    capture = createEmptyCapture();

    return {
      blockId,
      capture: currentCapture,
      output: materializeOutput(currentCapture, command),
    };
  };

  const getCapture = (): OutputCapture => capture;
  const getActiveBlockId = (): string | null => activeBlockId;

  return {
    startCapture,
    appendOutput,
    clearCapture,
    finalizeCapture,
    getCapture,
    getActiveBlockId,
  };
}
