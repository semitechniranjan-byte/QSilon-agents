/**
 * The chart shapes the Analytics page is built from.
 *
 * Every panel there used to be the same thing: a row of flat bars in the one accent
 * colour, whatever the question was. Five panels of identical bars read as one long
 * table, and nothing on the page said which outcome was which. These give each question
 * the shape that answers it - a day runs along a line, an hour is a volume with a rate
 * over it, attempts fall away like a funnel, a split is a ring - and they all take their
 * colours from the same place the dashboard does, so an outcome is one colour anywhere
 * in the console.
 *
 * The lines and areas are drawn in a 0-100 box stretched to the panel with
 * preserveAspectRatio="none": the geometry needs no measured pixel width, and
 * vector-effect keeps the strokes an even weight while the box is stretched. Points sit
 * on top as elements rather than SVG circles, which the same stretch would turn into
 * ovals.
 */
import { useState, type ReactNode } from "react";

import { niceStep } from "./scale";


export type Series = {
  key: string;
  label: string;
  /** Tailwind stroke-* and fill-* / bg-* classes, written out so the compiler sees them. */
  stroke: string;
  fill: string;
  area?: string;
  values: number[];
};

/** Inset at both ends, so the first and last points are not half outside the plot. */
const PAD = 6;

function Legend({ items }: { items: { label: string; swatch: ReactNode }[] }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Grid({ ticks, top }: { ticks: number[]; top: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div
          key={t}
          className={`absolute inset-x-0 border-t ${t === 0 ? "border-slate-300" : "border-slate-100"}`}
          style={{ top: `${100 - (t / top) * 100}%` }}
        />
      ))}
    </>
  );
}

function Axis({ ticks, top, suffix = "" }: { ticks: number[]; top: number; suffix?: string }) {
  return (
    <div className="relative w-7 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute right-0 -translate-y-1/2 leading-none"
          style={{ top: `${100 - (t / top) * 100}%` }}
        >
          {t}
          {suffix}
        </span>
      ))}
    </div>
  );
}

/**
 * Filled areas over a run of days.
 *
 * Twenty-three days as twenty-three bars is a picket fence nobody can read a shape off;
 * the same twenty-three as a filled run shows the week it went quiet at a glance.
 */
export function AreaTrend({
  labels,
  series,
  height = "h-44",
}: {
  labels: string[];
  series: Series[];
  height?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  if (n === 0) return null;

  const peak = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(peak / 4);
  const top = step * 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => i * step);

  const x = (i: number) => (n === 1 ? 50 : PAD + (i / (n - 1)) * (100 - 2 * PAD));
  const y = (v: number) => 100 - (v / top) * 100;
  const line = (values: number[]) => values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  // Only a few dates fit along the foot of a month of calls. Counted back from the last
  // one: stepping forward from the first and then forcing the last in printed 10-08 and
  // 10-09 on top of each other whenever the run did not divide evenly.
  const every = Math.max(1, Math.ceil(n / 8));
  const dated = new Set<number>();
  for (let i = n - 1; i >= 0; i -= every) dated.add(i);

  return (
    <div className="mt-4">
      <div className={`flex ${height} gap-2`}>
        <Axis ticks={ticks} top={top} />
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1">
            <Grid ticks={ticks} top={top} />
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              {series.map((s) => (
                <g key={s.key}>
                  <polygon
                    points={`${x(0)},100 ${line(s.values)} ${x(n - 1)},100`}
                    className={s.area ?? "fill-slate-100"}
                    opacity={0.5}
                  />
                  <polyline
                    points={line(s.values)}
                    fill="none"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    className={s.stroke}
                  />
                </g>
              ))}
            </svg>

            {series.map((s) =>
              s.values.map((v, i) => (
                <span
                  key={`${s.key}-${i}`}
                  className={`absolute h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-1 ring-white transition ${s.fill} ${
                    hover !== null && hover !== i ? "opacity-30" : ""
                  }`}
                  style={{ left: `${x(i)}%`, bottom: `${(v / top) * 100}%` }}
                />
              )),
            )}

            {hover !== null && (
              <>
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-slate-300"
                  style={{ left: `${x(hover)}%` }}
                />
                <div
                  className="pointer-events-none absolute top-0 z-10 w-40 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg"
                  style={{
                    left: `${x(hover)}%`,
                    transform: `translateX(${x(hover) > 60 ? "-100%" : x(hover) < 20 ? "0" : "-50%"})`,
                  }}
                >
                  <div className="mb-1 font-semibold text-slate-900">{labels[hover]}</div>
                  {series.map((s) => (
                    <div key={s.key} className="flex items-center gap-1.5 text-slate-600">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${s.fill}`} />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="tabular-nums text-slate-900">{s.values[hover]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="absolute inset-0 flex">
              {labels.map((l, i) => (
                <div
                  key={l}
                  className="flex-1"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </div>
          </div>
          <div className="relative mt-1 h-4 text-[10px] text-slate-400">
            {labels.map((l, i) =>
              dated.has(i) ? (
                <span
                  key={l}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${x(i)}%` }}
                >
                  {l}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <Legend
        items={series.map((s) => ({
          label: s.label,
          swatch: <span className={`h-2 w-2 rounded-full ${s.fill}`} />,
        }))}
      />
    </div>
  );
}

/**
 * Volume as bars with a rate drawn over them.
 *
 * "When calls connect" is two questions at once - how many went out at this hour, and
 * how many of them reached someone - and a single stacked bar answered neither: the
 * share was a shade of the same colour, so a busy hour that connected badly looked like
 * a quiet hour that connected well.
 */
export function BarsWithLine({
  labels,
  bars,
  rates,
  barClass,
  lineClass = "stroke-fuchsia-500",
  dotClass = "bg-fuchsia-500",
  barLabel,
  lineLabel,
  legendExtra = [],
  tooltip,
  height = "h-40",
}: {
  labels: string[];
  bars: number[];
  /** 0-100 against its own axis on the right; null where there is nothing to rate. */
  rates: (number | null)[];
  /** A class per bar, so one can be called out from the rest. */
  barClass: (i: number) => string;
  lineClass?: string;
  dotClass?: string;
  barLabel: string;
  lineLabel: string;
  /** Further swatches to explain, e.g. the colour a called-out bar uses. */
  legendExtra?: { label: string; className: string }[];
  tooltip: (i: number) => string;
  height?: string;
}) {
  const n = labels.length;
  if (n === 0) return null;
  const peak = Math.max(1, ...bars);
  const step = niceStep(peak / 4);
  const top = step * 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => i * step);
  // The bars sit in equal columns, so the rate's points belong at the middle of each.
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const runs: number[][] = [];
  rates.forEach((r, i) => {
    if (r === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else runs.push([i]);
  });

  return (
    <div className="mt-4">
      <div className={`flex ${height} gap-2`}>
        <Axis ticks={ticks} top={top} />
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1">
            <Grid ticks={ticks} top={top} />
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {bars.map((v, i) => (
                <div
                  key={labels[i]}
                  title={tooltip(i)}
                  className={`min-w-0 flex-1 rounded-t transition ${barClass(i)}`}
                  style={{ height: `${Math.max((v / top) * 100, v > 0 ? 2 : 0)}%` }}
                />
              ))}
            </div>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            >
              {runs.map((run) => (
                <polyline
                  key={run[0]}
                  points={run.map((i) => `${x(i)},${100 - (rates[i] as number)}`).join(" ")}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={lineClass}
                />
              ))}
            </svg>
            {rates.map((r, i) =>
              r === null ? null : (
                <span
                  key={labels[i]}
                  className={`pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-1 ring-white ${dotClass}`}
                  style={{ left: `${x(i)}%`, bottom: `${r}%` }}
                />
              ),
            )}
          </div>
          <div className="mt-1 flex gap-[3px] text-center text-[10px] text-slate-400">
            {labels.map((l) => (
              <span key={l} className="min-w-0 flex-1 truncate">
                {l}
              </span>
            ))}
          </div>
        </div>
        {/* The rate's own axis, so 0-100% never pretends to be a call count. */}
        <div className="relative w-7 shrink-0 text-left text-[10px] tabular-nums text-slate-400">
          {[100, 50, 0].map((t) => (
            <span
              key={t}
              className="absolute left-0 -translate-y-1/2 leading-none"
              style={{ top: `${100 - t}%` }}
            >
              {t}%
            </span>
          ))}
        </div>
      </div>
      <Legend
        items={[
          { label: barLabel, swatch: <span className="h-2 w-2 rounded-sm bg-indigo-500" /> },
          ...legendExtra.map((e) => ({
            label: e.label,
            swatch: <span className={`h-2 w-2 rounded-sm ${e.className}`} />,
          })),
          { label: lineLabel, swatch: <span className={`h-2 w-2 rounded-full ${dotClass}`} /> },
        ]}
      />
    </div>
  );
}

/**
 * Steps that fall away, each one a share of the first.
 *
 * Attempts are a funnel in the literal sense - fewer numbers reach a second try than a
 * first - and bars all starting from the left hid that entirely.
 */
export function Funnel({
  steps,
}: {
  steps: { label: string; total: number; won: number; wonLabel: string; fill: string }[];
}) {
  const first = Math.max(1, ...steps.map((s) => s.total));
  return (
    <div className="mt-4 space-y-2">
      {steps.map((s) => {
        const width = (s.total / first) * 100;
        const share = s.total ? Math.round((s.won / s.total) * 100) : 0;
        return (
          <div key={s.label} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 font-medium text-slate-700">{s.label}</span>
            <div className="flex-1">
              <div
                className="flex h-7 items-center overflow-hidden rounded-md bg-slate-100"
                style={{ width: `${Math.max(width, 6)}%` }}
                title={`${s.total} calls, ${s.won} ${s.wonLabel}`}
              >
                <div
                  className={`flex h-full items-center justify-end px-1.5 text-[10px] font-semibold text-white ${s.fill}`}
                  style={{ width: `${Math.max(share, s.won > 0 ? 12 : 0)}%` }}
                >
                  {s.won > 0 && s.won}
                </div>
                <span className="px-1.5 text-[10px] font-medium text-slate-500">{s.total}</span>
              </div>
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">
              {share}% {s.wonLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A ring with its legend beside it, for a split of one total between a few names. */
export function MiniDonut({
  slices,
  total,
  centreLabel,
}: {
  slices: { key: string; label: string; n: number; stroke: string; fill: string; share: string }[];
  total: number;
  centreLabel: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const drawn = slices.filter((s) => s.n > 0);
  const hovered = drawn.find((s) => s.key === hover);
  let offset = 0;

  return (
    <div className="mt-4 flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 -rotate-90">
        {drawn.map((s) => {
          const length = (s.n / Math.max(total, 1)) * circumference;
          const gap = drawn.length > 1 ? Math.min(2, length / 2) : 0;
          const el = (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              strokeWidth={hover === s.key ? 16 : 13}
              strokeDasharray={`${length - gap} ${circumference - length + gap}`}
              strokeDashoffset={-offset}
              className={`${s.stroke} cursor-pointer transition-all`}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            />
          );
          offset += length;
          return el;
        })}
        <text
          x="60"
          y="58"
          textAnchor="middle"
          transform="rotate(90 60 60)"
          className="fill-slate-900 text-[18px] font-semibold"
        >
          {hovered ? hovered.n : total}
        </text>
        <text
          x="60"
          y="72"
          textAnchor="middle"
          transform="rotate(90 60 60)"
          className="fill-slate-400 text-[8px]"
        >
          {hovered ? hovered.label.slice(0, 14) : centreLabel}
        </text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1">
        {drawn.map((s) => (
          <div
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded px-1 py-0.5 text-xs transition ${
              hover === s.key ? "bg-slate-50" : ""
            }`}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.fill}`} />
            <span className="min-w-0 flex-1 truncate capitalize text-slate-700">{s.label}</span>
            <span className="tabular-nums font-semibold text-slate-900">{s.n}</span>
            <span className="w-12 text-right tabular-nums text-slate-400">{s.share}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One bar split between every outcome, so the whole period reads in a single line. */
export function ShareBar({
  slices,
}: {
  slices: { key: string; label: string; n: number; fill: string; share: string }[];
}) {
  const total = Math.max(1, slices.reduce((t, s) => t + s.n, 0));
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
      {slices
        .filter((s) => s.n > 0)
        .map((s) => (
          <div
            key={s.key}
            className={`h-full transition ${s.fill}`}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n} (${s.share})`}
          />
        ))}
    </div>
  );
}
