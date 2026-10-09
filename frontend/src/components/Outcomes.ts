/**
 * The six outcomes a collections desk actually works from.
 *
 * Thirteen disposition codes is the right vocabulary for a report and the wrong one for
 * a dashboard: a promise is a promise whether it lands inside three days or after them,
 * and a refusal is a refusal whether the customer said no or simply would not commit.
 * The codes stay intact underneath - the report still carries every one - but the tiles
 * group them into the six piles someone can act on, and everything outside those piles
 * (codes belonging to other use cases) is left off the dashboard rather than padding it.
 */
export type OutcomeGroup = {
  key: string;
  label: string;
  /** Disposition codes this tile stands for. */
  codes: string[];
  hint: string;
  /** Tailwind classes, written out so the compiler sees them. */
  tile: string;
  value: string;
};

export const OUTCOME_GROUPS: OutcomeGroup[] = [
  {
    key: "promise",
    label: "Promise to pay",
    codes: ["PTP", "FPTP"],
    hint: "Gave a date",
    tile: "border-emerald-200 bg-emerald-50 hover:border-emerald-300",
    value: "text-emerald-700",
  },
  {
    key: "refused",
    label: "Refused to pay",
    codes: ["RTP", "NC"],
    hint: "No, or no commitment",
    tile: "border-rose-200 bg-rose-50 hover:border-rose-300",
    value: "text-rose-700",
  },
  {
    key: "paid",
    label: "Claims paid",
    codes: ["CP", "ALREADY_PAID", "PARTIAL_PAID"],
    hint: "Says it is done",
    tile: "border-blue-200 bg-blue-50 hover:border-blue-300",
    value: "text-blue-700",
  },
  {
    key: "callback",
    label: "Callback asked",
    codes: ["CB"],
    hint: "Call me later",
    tile: "border-amber-200 bg-amber-50 hover:border-amber-300",
    value: "text-amber-700",
  },
  {
    key: "unreached",
    label: "Not reachable",
    codes: ["NR", "ICR", "RNR", "LM"],
    hint: "Worth another try",
    tile: "border-slate-200 bg-slate-50 hover:border-slate-300",
    value: "text-slate-700",
  },
  {
    key: "wrong",
    label: "Wrong number",
    codes: ["WN"],
    hint: "Not this customer",
    tile: "border-slate-200 bg-slate-50 hover:border-slate-300",
    value: "text-slate-500",
  },
];

/**
 * Colours for codes the six piles do not cover - a clinic's, a courier's, whatever the
 * next client's analysis prompt invents. Fixed list, assigned in the order the codes
 * appear, so one outcome keeps one colour across the ring, the legend and the trend.
 */
const CODE_TONES = [
  { stroke: "stroke-teal-500", fill: "bg-teal-500" },
  { stroke: "stroke-indigo-500", fill: "bg-indigo-500" },
  { stroke: "stroke-orange-500", fill: "bg-orange-500" },
  { stroke: "stroke-cyan-500", fill: "bg-cyan-500" },
  { stroke: "stroke-pink-500", fill: "bg-pink-500" },
  { stroke: "stroke-lime-600", fill: "bg-lime-600" },
  { stroke: "stroke-sky-500", fill: "bg-sky-500" },
  { stroke: "stroke-fuchsia-500", fill: "bg-fuchsia-500" },
];

const GROUP_TONES: Record<string, { stroke: string; fill: string }> = {
  promise: { stroke: "stroke-emerald-500", fill: "bg-emerald-500" },
  refused: { stroke: "stroke-rose-500", fill: "bg-rose-500" },
  paid: { stroke: "stroke-blue-500", fill: "bg-blue-500" },
  callback: { stroke: "stroke-amber-500", fill: "bg-amber-500" },
  unreached: { stroke: "stroke-slate-300", fill: "bg-slate-300" },
  wrong: { stroke: "stroke-violet-500", fill: "bg-violet-500" },
};

/** RESCHEDULE_REQUESTED -> "Reschedule requested", for a code nobody has labelled. */
export function prettifyCode(code: string): string {
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CODE_SHAPE = /^[A-Za-z0-9_-]{1,48}$/;

/** A single disposition code standing in for a group, so one code can be opened like one. */
export function codeGroup(code: string, label?: string): OutcomeGroup {
  return {
    key: code,
    label: label || prettifyCode(code),
    codes: [code],
    hint: code,
    tile: "border-slate-200 bg-slate-50 hover:border-slate-300",
    value: "text-slate-700",
  };
}

export function groupByKey(key: string | null): OutcomeGroup | undefined {
  if (!key) return undefined;
  const known = OUTCOME_GROUPS.find((g) => g.key === key);
  if (known) return known;
  // The dashboard draws a pile per code for clients whose outcomes are their own, and
  // those piles link here by code. Without this they opened an unfiltered list.
  return CODE_SHAPE.test(key) ? codeGroup(key.toUpperCase()) : undefined;
}

/** Count how many of `counts` fall into each group. */
export function countsForGroups(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of OUTCOME_GROUPS) {
    out[group.key] = group.codes.reduce((n, code) => n + (counts[code] ?? 0), 0);
  }
  return out;
}

export type Pile = {
  key: string;
  label: string;
  /** The codes behind it, for the tooltip and for filtering. */
  codes: string[];
  n: number;
  stroke: string;
  fill: string;
  hint: string;
};

/**
 * The piles to draw for whatever this deployment is actually doing.
 *
 * The six collections piles were the whole dashboard, and a clinic's calls - every one of
 * them SURGERY_CONFIRMED or RESCHEDULE_REQUESTED - landed in a nameless grey "Other
 * codes" wedge while five empty lending rows took up the legend. So the piles follow the
 * calls: the six come first when they have anything in them, which keeps promises at the
 * top for a lender, and every other code the period produced gets a pile of its own.
 */
export function buildPiles(
  counts: Record<string, number>,
  labels: Record<string, string> = {},
  max = 8,
): Pile[] {
  const grouped = countsForGroups(counts);
  const claimed = new Set(OUTCOME_GROUPS.flatMap((g) => g.codes));

  const known: Pile[] = OUTCOME_GROUPS.filter((g) => (grouped[g.key] ?? 0) > 0).map((g) => ({
    key: g.key,
    label: g.label,
    codes: g.codes.filter((c) => (counts[c] ?? 0) > 0),
    n: grouped[g.key],
    hint: g.hint,
    ...GROUP_TONES[g.key],
  }));

  const loose = Object.entries(counts)
    .filter(([code, n]) => n > 0 && !claimed.has(code))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, n], i) => ({
      key: code,
      label: labels[code] || prettifyCode(code),
      codes: [code],
      n,
      hint: code,
      ...CODE_TONES[i % CODE_TONES.length],
    }));

  const piles = [...known, ...loose];
  if (piles.length <= max) return piles;

  // Too many to read. Keep the biggest and say how many calls the rest account for,
  // rather than drawing slivers nobody can hover.
  const kept = [...piles].sort((a, b) => b.n - a.n).slice(0, max - 1);
  const keptKeys = new Set(kept.map((p) => p.key));
  const rest = piles.filter((p) => !keptKeys.has(p.key));
  return [
    ...piles.filter((p) => keptKeys.has(p.key)),
    {
      key: "__rest__",
      label: `${rest.length} smaller outcomes`,
      codes: rest.flatMap((p) => p.codes),
      n: rest.reduce((t, p) => t + p.n, 0),
      hint: rest.map((p) => p.label).join(", "),
      stroke: "stroke-slate-200",
      fill: "bg-slate-200",
    },
  ];
}
