/**
 * Sublime-text style fuzzy matcher.
 * Zero dependencies, pure functions, O(n*m) per match.
 */

export interface FuzzyResult {
  score: number;
  matches: number[];
}

export interface FilteredItem {
  item: string;
  score: number;
  matches: number[];
}

const SEPARATORS = new Set(['-', '_', '.', '/', '\\', ' ', ':', '@']);

function charScore(
  queryChar: string,
  targetChar: string,
  target: string,
  targetIndex: number,
  prevMatched: boolean,
  prevTargetIndex: number,
): number {
  let score = 0;

  // Exact case match bonus
  if (queryChar === targetChar) score += 1;

  // Consecutive match bonus
  if (prevMatched && targetIndex === prevTargetIndex + 1) {
    score += 4;
  }

  // Separator / camelCase boundary bonus
  if (
    prevTargetIndex >= 0 &&
    SEPARATORS.has(String.fromCodePoint(target.charCodeAt(targetIndex - 1) ?? 0))
  ) {
    score += 2;
  } else if (
    prevTargetIndex >= 0 &&
    /[a-z]/.test(String.fromCodePoint(target.charCodeAt(targetIndex - 1) ?? 0)) &&
    /[A-Z]/.test(targetChar)
  ) {
    score += 2;
  }

  // Leading character bonus
  if (targetIndex === 0) {
    score += 2;
  } else if (
    SEPARATORS.has(String.fromCodePoint(target.charCodeAt(targetIndex - 1) ?? 0))
  ) {
    score += 2;
  }

  return score;
}

/**
 * Fuzzy match query against a target string.
 * Returns null if no match found.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query || !target) return null;

  const ql = query.length;
  const tl = target.length;
  if (ql > tl) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // DP table: [query_index][target_index] -> best score ending at this position
  // We only need the previous row, so optimize to O(tl) space
  type Cell = { score: number; prev: number; matches: number[] } | null;
  let prevRow: Cell[] = Array.from({ length: tl + 1 }, () => null);
  let currRow: Cell[] = Array.from({ length: tl + 1 }, () => null);

  for (let qi = 0; qi < ql; qi++) {
    const qc = q[qi]!;

    for (let ti = qi; ti < tl; ti++) {
      const tc = t[ti]!;
      if (qc !== tc) {
        currRow[ti + 1] = null;
        continue;
      }

      // Try extending from each previous match position
      let best: Cell | null = null;

      if (qi === 0) {
        // First query char — can start anywhere
        const s = charScore(qc, tc, t, ti, false, -1);
        best = { score: s, prev: -1, matches: [ti] };
      } else {
        for (let pi = qi - 1; pi < ti; pi++) {
          const prev = prevRow[pi + 1];
          if (!prev) continue;

          const matched = true;
          const s = prev.score + charScore(qc, tc, t, ti, matched, pi);
          if (!best || s > best.score) {
            best = { score: s, prev: pi, matches: [...prev.matches, ti] };
          }
        }
      }

      currRow[ti + 1] = best;
    }

    // Swap rows
    prevRow = currRow;
    currRow = Array.from({ length: tl + 1 }, () => null);
  }

  // Find best final cell in last row
  let bestFinal: Cell | null = null;
  for (let ti = ql; ti <= tl; ti++) {
    const cell = prevRow[ti];
    if (cell && (!bestFinal || cell.score > bestFinal.score)) {
      bestFinal = cell;
    }
  }

  if (!bestFinal) return null;

  return { score: bestFinal.score, matches: bestFinal.matches };
}

/**
 * Filter and rank items by fuzzy match against query.
 */
export function fuzzyFilter(
  query: string,
  items: string[],
  maxResults = 20,
): FilteredItem[] {
  if (!query) return items.slice(0, maxResults).map((item) => ({ item, score: 0, matches: [] }));

  const results: FilteredItem[] = [];

  for (const item of items) {
    const result = fuzzyMatch(query, item);
    if (result) {
      results.push({ item, score: result.score, matches: result.matches });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
