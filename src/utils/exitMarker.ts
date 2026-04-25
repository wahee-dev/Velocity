export type InteractiveShellKind = 'cmd' | 'posix';

const MARKER_PREFIX = '__VELOCITY_EXIT__';

interface MarkerParseState {
  carry: string;
}

export interface MarkerParseResult {
  cleanedOutput: string;
  exitCode?: number;
}

function getMarkerPrefix(blockId: string): string {
  return `${MARKER_PREFIX}${blockId}__`;
}

function getTrailingPartialLength(value: string, prefix: string): number {
  const maxLength = Math.min(value.length, prefix.length - 1);

  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(prefix.slice(0, length))) {
      return length;
    }
  }

  return 0;
}

/** Regex that matches a complete exit marker: PREFIX + digits + __ */
const COMPLETE_MARKER_RE = /__(\d+)__/;

export function createMarkerState(): MarkerParseState {
  return { carry: '' };
}

export function wrapInteractiveCommand(
  shellKind: InteractiveShellKind,
  command: string,
  blockId: string,
): string {
  const prefix = getMarkerPrefix(blockId);

  if (shellKind === 'cmd') {
    return `${command} & echo ${prefix}%errorlevel%__\r`;
  }

  return `${command}; printf '\\n${prefix}%s__\\n' "$?"\r`;
}

/**
 * Strip the echoed wrap-line that cmd/posix shells emit.
 * e.g. "dir & echo __VELOCITY_EXIT__abc123__%errorlevel%" or
 *     "command; printf '\n__VELOCITY_EXIT__abc123__%s__' '$?'"
 * These lines contain the marker prefix but NOT a completed numeric marker.
 */
function stripEchoedWrapLine(output: string, prefix: string): string {
  // Use a more robust approach: find the first line that contains the prefix
  // and remove it, but ONLY if it doesn't look like a completed marker.
  const lines = output.split(/\r?\n/);
  const resultLines = [];
  let stripped = false;

  for (const line of lines) {
    if (!stripped && line.includes(prefix) && !line.match(/__\d+__/)) {
      stripped = true;
      continue;
    }
    resultLines.push(line);
  }

  return resultLines.join('\n');
}

export function consumeExitMarkerChunk(
  state: MarkerParseState,
  blockId: string,
  chunk: string,
): MarkerParseResult {
  const prefix = getMarkerPrefix(blockId);
  const combined = `${state.carry}${chunk}`;

  // Find the LAST occurrence of the prefix which should be the real marker
  const markerStart = combined.lastIndexOf(prefix);

  if (markerStart >= 0) {
    const remainder = combined.slice(markerStart + prefix.length);
    // Support both positive and negative exit codes
    const completedMarker = remainder.match(/^(-?\d+)__/);

    if (!completedMarker) {
      // Prefix found but no trailing digits__ yet — partial marker, carry it
      // But we should return everything BEFORE the prefix as cleaned output
      state.carry = combined.slice(markerStart);
      return {
        cleanedOutput: combined.slice(0, markerStart),
      };
    }

    const exitCodeStr = completedMarker[1];
    const exitCode = Number.parseInt(exitCodeStr, 10);
    const markerLength = prefix.length + completedMarker[0].length;

    // Everything before the real marker is the clean output.
    // We also include anything AFTER the marker (if any).
    let cleanedBefore = combined.slice(0, markerStart);
    const cleanedAfter = combined.slice(markerStart + markerLength);
    
    // Strip the echoed wrap-line from the part BEFORE the marker.
    cleanedBefore = stripEchoedWrapLine(cleanedBefore, prefix);

    state.carry = '';
    return {
      cleanedOutput: cleanedBefore + cleanedAfter,
      exitCode: Number.isNaN(exitCode) ? undefined : exitCode,
    };
  }

  const partialLength = getTrailingPartialLength(combined, prefix);
  if (partialLength > 0) {
    state.carry = combined.slice(-partialLength);
    return {
      cleanedOutput: combined.slice(0, -partialLength),
    };
  }

  state.carry = '';
  return {
    cleanedOutput: combined,
  };
}

export function flushMarkerCarry(state: MarkerParseState): string {
  const remainder = state.carry;
  state.carry = '';
  return remainder;
}
