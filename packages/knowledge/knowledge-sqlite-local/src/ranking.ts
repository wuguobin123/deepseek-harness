/** Ranking helpers for deterministic knowledge search. */
/**
 * Convert SQLite's lower-is-better bm25 score into bounded relevance.
 * @param rank - Raw SQLite FTS5 `bm25()` rank.
 * @returns Reciprocal relevance in the interval from zero through one.
 */
export function bm25Relevance(rank: number): number {
  return Number.isFinite(rank) ? 1 / (1 + Math.abs(rank)) : 0
}
/**
 * Compute cosine similarity, returning zero for empty or invalid vectors.
 * @param left - First vector.
 * @param right - Second vector.
 * @returns Cosine similarity, or zero when comparison is invalid.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let i = 0; i < left.length; i++) {
    const a = left[i]
    const b = right[i]
    if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  const denominator = Math.sqrt(leftNorm * rightNorm)
  return denominator > 0 ? dot / denominator : 0
}
