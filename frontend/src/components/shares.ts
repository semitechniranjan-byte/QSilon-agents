/**
 * Percentages for a breakdown that add up to exactly 100.
 *
 * Rounding every line on its own is how a client added the Outcomes column up to 99:
 * 97 calls split twelve ways, each share rounded separately. This rounds to one decimal
 * and hands the tenths lost to rounding back to the lines that lost the most (largest
 * remainder), so no line is more than a tenth away from its true share.
 *
 * Lines with the same count always show the same figure - two fives never read 5.1% and
 * 5.2%. When a tied group cannot all take a tenth, none of it does and the next line
 * gets it instead, which in a rare split can leave the total a tenth short.
 */
export function sharesOf(counts: number[]): number[] {
  const total = counts.reduce((s, n) => s + n, 0);
  if (total <= 0) return counts.map(() => 0);

  const exact = counts.map((n) => (n * 1000) / total);
  const tenths = exact.map((x) => Math.floor(x));
  let left = 1000 - tenths.reduce((s, n) => s + n, 0);

  // Equal counts have equal remainders, so they are handed tenths as one group.
  const groups = new Map<number, number[]>();
  counts.forEach((n, i) => groups.set(n, [...(groups.get(n) ?? []), i]));
  const remainder = (i: number) => exact[i] - tenths[i];
  const order = [...groups.values()].sort((a, b) => remainder(b[0]) - remainder(a[0]));

  for (const group of order) {
    if (left <= 0) break;
    if (remainder(group[0]) <= 0 || group.length > left) continue;
    for (const i of group) tenths[i] += 1;
    left -= group.length;
  }
  return tenths.map((t) => t / 10);
}

export const formatShare = (share: number) => `${share.toFixed(1)}%`;
