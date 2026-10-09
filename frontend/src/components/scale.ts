/**
 * Rounds a chart's step up to 1, 2, 3, 5 or 10 times a power of ten, so the gridlines
 * read cleanly and the top is not far above the data. Without the 3, a nine-call day
 * steps to 5 and draws an axis to 20, squashing every line into the bottom quarter.
 *
 * Its own file: the charts are components, and a module that exports both components and
 * plain functions gives up fast refresh for everything in it.
 */
export function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const lead = raw / power;
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 3 ? 3 : lead <= 5 ? 5 : 10) * power;
}
