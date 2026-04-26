export type InteractiveShellKind = 'cmd' | 'posix';

// Session-specific secret generated at launch. 
// Hardening: Users/Scripts cannot guess the marker if they don't know the secret.
let SESSION_SECRET = Math.random().toString(36).slice(2, 10);

const GUARD = '\x1E'; // Record Separator (non-printable)

export function setSessionSecret(secret: string) {
  SESSION_SECRET = secret;
}

interface MarkerParseState {
  carry: string;
}

export interface MarkerParseResult {
  cleanedOutput: string;
  exitCode?: number;
}

function getMarkerPrefix(blockId: string): string {
  return `${GUARD}__VEL_${SESSION_SECRET}_${blockId}__`;
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

export function createMarkerState(): MarkerParseState {
  return { carry: '' };
}

export function wrapInteractiveCommand(
  shellKind: InteractiveShellKind,
  command: string,
  blockId: string,
): string {
  const prefix = getMarkerPrefix(blockId);
  const trimmed = command.trim().toLowerCase();

  if (shellKind === 'cmd') {
    if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
      return `(${command}) & echo changed directory to %cd% & echo ${prefix}%errorlevel%__\r`;
    }
    return `(${command}) & echo ${prefix}%errorlevel%__\r`;
  }

  if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
    return `(${command}); printf 'changed directory to %s\\n' "$PWD"; printf '\\n${prefix}%s__\\n' "$?"\r`;
  }

  return `(${command}); printf '\\n${prefix}%s__\\n' "$?"\r`;
}

/**
 * Strip the echoed wrap-line that cmd/posix shells emit.
 */
function stripEchoedWrapLine(output: string, prefix: string): string {
  const lines = output.split(/\r?\n/);
  const resultLines = [];
  let stripped = false;

  for (const line of lines) {
    // If line contains our specific prefix but isn't the final marker, it's the echo
    if (!stripped && line.includes(prefix) && !line.match(/__\d+__/)) {
      stripped = true;
      continue;
    }
    resultLines.push(line);
  }

  return resultLines.join('\n');
}

/**
 * Scrub any internal markers from user-facing output.
 * Aggressive: Removes the pattern with or without the non-printable GUARD.
 */
export function scrubInternalMarkers(output: string): string {
  // Matches (optional Guard) + __VEL_ + (Secret) + _ + (ID) + __ + (optional ExitCode + __)
  // This cleans up partials, unguarded spoofs, and the real markers.
  return output.replace(/\x1E?__VEL_[a-z0-9]+_[a-z0-9]+__(?:-?\d+__)?/g, '');
}

export function consumeExitMarkerChunk(
  state: MarkerParseState,
  blockId: string,
  chunk: string,
): MarkerParseResult {
  const prefix = getMarkerPrefix(blockId);
  const combined = `${state.carry}${chunk}`;

  const markerStart = combined.lastIndexOf(prefix);

  if (markerStart >= 0) {
    const remainder = combined.slice(markerStart + prefix.length);
    const completedMarker = remainder.match(/^(-?\d+)__/);

    if (!completedMarker) {
      state.carry = combined.slice(markerStart);
      return {
        cleanedOutput: scrubInternalMarkers(combined.slice(0, markerStart)),
      };
    }

    const exitCodeStr = completedMarker[1];
    const exitCode = Number.parseInt(exitCodeStr, 10);
    const markerLength = prefix.length + completedMarker[0].length;

    let cleanedBefore = combined.slice(0, markerStart);
    const cleanedAfter = combined.slice(markerStart + markerLength);
    
    cleanedBefore = scrubInternalMarkers(stripEchoedWrapLine(cleanedBefore, prefix));

    state.carry = '';
    return {
      cleanedOutput: cleanedBefore + scrubInternalMarkers(cleanedAfter),
      exitCode: Number.isNaN(exitCode) ? undefined : exitCode,
    };
  }

  const partialLength = getTrailingPartialLength(combined, prefix);
  if (partialLength > 0) {
    state.carry = combined.slice(-partialLength);
    return {
      cleanedOutput: scrubInternalMarkers(combined.slice(0, -partialLength)),
    };
  }

  state.carry = '';
  return {
    cleanedOutput: scrubInternalMarkers(combined),
  };
}

export function flushMarkerCarry(state: MarkerParseState): string {
  const remainder = state.carry;
  state.carry = '';
  return scrubInternalMarkers(remainder);
}
