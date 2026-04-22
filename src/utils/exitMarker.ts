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
  return output.replace(/^.*\r?\n?(?=[\s\S]*__VELOCITY_EXIT__.*?\d+__)/s, '');
}

export function consumeExitMarkerChunk(
  state: MarkerParseState,
  blockId: string,
  chunk: string,
): MarkerParseResult {
  const prefix = getMarkerPrefix(blockId);
  const combined = `${state.carry}${chunk}`;

  // Use lastIndexOf: the real marker (from echo/printf) always comes AFTER
  // any echoed command line that also contains the prefix text.
  const markerStart = combined.lastIndexOf(prefix);

  if (markerStart >= 0) {
    const remainder = combined.slice(markerStart + prefix.length);
    const completedMarker = remainder.match(/^(-?\d+)__/);

    if (!completedMarker) {
      // Prefix found but no trailing digits__ yet — partial marker, carry it
      state.carry = combined.slice(markerStart);
      return {
        cleanedOutput: combined.slice(0, markerStart),
      };
    }

    const exitCode = Number.parseInt(completedMarker[1], 10);
    const markerLength = prefix.length + completedMarker[0].length;

    // Everything before the real marker is the clean output.
    // This includes the echoed wrap-line which we now strip.
    let cleaned = combined.slice(0, markerStart) + combined.slice(markerStart + markerLength);
    cleaned = stripEchoedWrapLine(cleaned, prefix);

    state.carry = '';
    return {
      cleanedOutput: cleaned,
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
