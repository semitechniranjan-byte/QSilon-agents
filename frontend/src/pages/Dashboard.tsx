import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { buildPiles, shorten, type Pile } from "../components/Outcomes";
import { DispositionBadge } from "../components/Disposition";
import { PhoneNumber } from "../components/PhoneNumber";
import { formatShare, sharesOf } from "../components/shares";
import { DateRangeFilter } from "../components/DateRangeFilter";
import {
  describeRange,
  readRange,
  resolveRange,
  windowQuery,
  writeRange,
  type RangeChoice,
} from "../components/dateRange";
import {
  getAnalyticsSummary,
  getDispositions,
  getHealth,
  listCampaigns,
  listQueueCalls,
  listSessions,
  type AnalyticsSummary,
} from "../api/endpoints";
import type { Session } from "../api/types";
import {
  IconArrowRight,
  IconCampaign,
  IconChart,
  IconHourglass,
  IconMessage,
  IconTable,
  IconTemplate,
} from "../components/Icons";
import type { ComponentType, ReactNode } from "react";

const KPI_TONES = {
  blue: { card: "border-blue-100 bg-blue-50/60", icon: "bg-blue-100 text-blue-600" },
  emerald: { card: "border-emerald-100 bg-emerald-50/60", icon: "bg-emerald-100 text-emerald-600" },
  violet: { card: "border-violet-100 bg-violet-50/60", icon: "bg-violet-100 text-violet-600" },
  amber: { card: "border-amber-100 bg-amber-50/60", icon: "bg-amber-100 text-amber-600" },
};

function StatCard({
  label,
  value,
  sub,
  Icon,
  to,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  Icon: ComponentType<{ size?: number }>;
  to: string;
  tone: keyof typeof KPI_TONES;
}) {
  const t = KPI_TONES[tone];
  return (
    <Link
      to={to}
      className={`group flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm transition hover:shadow ${t.card}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-xs font-medium text-slate-700">{label}</div>
        {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
      </div>
      <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
        <IconArrowRight size={14} />
      </span>
    </Link>
  );
}

function Panel({
  title,
  sub,
  action,
  className = "",
  children,
}: {
  title: string;
  sub?: string;
  action?: { to: string; label: string };
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {sub && <p className="truncate text-xs text-slate-400">{sub}</p>}
        </div>
        {action && (
          <Link
            to={action.to}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

type Outcomes = {
  analysed: number;
  piles: Pile[];
  shareByKey: Record<string, number>;
};

/**
 * The outcome piles as a ring, with the list beside it. Every row is still the link into
 * the calls behind it - the tiles it replaced were links, and a pile nobody can open is
 * just decoration.
 */
function OutcomeDonut({ outcomes, spanQuery }: { outcomes: Outcomes; spanQuery: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const slices = outcomes.piles;
  const many = slices.length > 1;
  let offset = 0;
  const hovered = slices.find((s) => s.key === hover);

  return (
    <div className="mt-3 flex flex-1 items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0 self-start -rotate-90">
        {slices.map((s) => {
          const length = (s.n / outcomes.analysed) * circumference;
          // A 2px gap between slices; a lone slice is a whole ring.
          const gap = many ? Math.min(2, length / 2) : 0;
          const el = (
            <circle
              key={s.key}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              strokeWidth={hover === s.key ? 16 : 14}
              strokeDasharray={`${length - gap} ${circumference - length + gap}`}
              strokeDashoffset={-offset}
              className={`${s.stroke} cursor-pointer transition-all`}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.label}: ${s.n} of ${outcomes.analysed}`}</title>
            </circle>
          );
          offset += length;
          return el;
        })}
        <text
          x="60"
          y="57"
          textAnchor="middle"
          transform="rotate(90 60 60)"
          className="fill-slate-900 text-[20px] font-semibold"
        >
          {hovered ? hovered.n : outcomes.analysed}
        </text>
        <text
          x="60"
          y="73"
          textAnchor="middle"
          transform="rotate(90 60 60)"
          className="fill-slate-400 text-[9px]"
        >
          {/* A client's code can be thirty characters; at 9px inside a 92px ring that ran
              out past the edge of the donut and over the panel. */}
          {hovered ? shorten(hovered.label, 18) : "Analysed"}
        </text>
      </svg>

      <div className="min-w-0 flex-1 space-y-0.5">
        {outcomes.piles.map((p) => {
          const row = (
            <>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.fill}`} />
              <span className="min-w-0 flex-1 truncate text-slate-700">{p.label}</span>
              <span className="w-8 text-right font-semibold tabular-nums text-slate-900">{p.n}</span>
              <span className="w-14 text-right tabular-nums text-slate-400">
                ({formatShare(outcomes.shareByKey[p.key] ?? 0)})
              </span>
            </>
          );
          const className = `flex items-center gap-2.5 rounded-md px-2 py-1 text-xs transition ${
            hover === p.key ? "bg-slate-50" : ""
          }`;
          const title = `${p.n} of ${outcomes.analysed} analysed calls · ${p.hint}`;
          // The lumped tail stands for several codes at once; there is no one list to open.
          if (p.key === "__rest__") {
            return (
              <div key={p.key} className={className} title={title}>
                {row}
              </div>
            );
          }
          return (
            <Link
              key={p.key}
              to={`/sessions?outcome=${p.key}${spanQuery ? `&${spanQuery}` : ""}`}
              onMouseEnter={() => setHover(p.key)}
              onMouseLeave={() => setHover(null)}
              title={title}
              className={`${className} hover:bg-slate-50`}
            >
              {row}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** Rounds a chart's top up to 1, 2 or 5 times a power of ten, so the gridlines read cleanly. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const lead = raw / power;
  return (lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10) * power;
}

/**
 * Calls per day, each bar split by outcome. Only the last seven days that had calls are
 * drawn: the panel shares a row with the outcomes, and a bar for every day of "All time"
 * would be too thin to read or hover. The Analytics page keeps the full run.
 *
 * The bands are the same piles as the ring beside it, in the same colours, rather than
 * three lending outcomes fixed in code - which left a clinic's whole week grey.
 */
function ConversationsTrend({
  days,
  piles,
}: {
  days: AnalyticsSummary["by_day"];
  piles: Pile[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Four bands at most: more than that in a 36px bar is a stack of slivers. The three
  // are the *biggest* outcomes, not the first three in the legend - taking them in
  // legend order drew promises, refusals and payments while "Not reachable", 44% of
  // every call, fell into Others, so almost every bar came out plain grey.
  const biggest = new Set(
    [...piles].sort((a, b) => b.n - a.n).slice(0, 3).map((p) => p.key),
  );
  const series = [
    ...piles
      .filter((p) => biggest.has(p.key))
      .map((p) => ({ key: p.key, label: p.label, fill: p.fill, codes: p.codes })),
    // A shade off Not reachable's slate-300, which is usually one of the three.
    { key: "others", label: "Others", fill: "bg-slate-200", codes: [] as string[] },
  ];
  const rows = days.slice(-7).map((d) => {
    const codes = d.codes ?? {};
    const parts: Record<string, number> = {};
    let named = 0;
    for (const s of series) {
      const n = s.codes.reduce((t, c) => t + (codes[c] ?? 0), 0);
      parts[s.key] = n;
      named += n;
    }
    // Everything else that day, analysed or not yet scored, so the bar is the day's calls.
    parts.others = Math.max(0, d.calls - named);
    return { date: d.date, calls: d.calls, parts };
  });
  const step = niceStep(Math.max(1, ...rows.map((d) => d.calls)) / 4);
  const top = step * 4;
  const ticks = [4, 3, 2, 1, 0].map((i) => i * step);
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  if (rows.length === 0) {
    return (
      <p className="mt-3 flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-sm text-slate-400">
        No calls in this period.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-1 flex-col">
      <div className="flex min-h-36 flex-1 gap-2">
        {/* y axis */}
        <div className="relative w-6 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${100 - (t / top) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1">
            {/* recessive gridlines */}
            {ticks.map((t) => (
              <div
                key={t}
                className={`absolute inset-x-0 border-t ${t === 0 ? "border-slate-300" : "border-slate-100"}`}
                style={{ top: `${100 - (t / top) * 100}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end justify-around gap-2 px-1">
              {rows.map((d, i) => (
                <div
                  key={d.date}
                  className="relative flex h-full max-w-9 flex-1 cursor-default flex-col justify-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className={`flex w-full flex-col-reverse gap-[2px] transition ${
                      hover !== null && hover !== i ? "opacity-50" : ""
                    }`}
                    style={{ height: `${(d.calls / top) * 100}%` }}
                  >
                    {series.map((s) =>
                      d.parts[s.key] > 0 ? (
                        <div
                          key={s.key}
                          className={`w-full ${s.fill} last:rounded-t`}
                          style={{ flexGrow: d.parts[s.key], flexBasis: 0, minHeight: 2 }}
                        />
                      ) : null,
                    )}
                  </div>
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-40 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg">
                      <div className="mb-1 font-semibold text-slate-900">
                        {dayLabel(d.date)} · {d.calls} call{d.calls === 1 ? "" : "s"}
                      </div>
                      {series
                        .filter((s) => d.parts[s.key] > 0)
                        .map((s) => (
                          <div key={s.key} className="flex items-center gap-1.5 text-slate-600">
                            <span className={`h-2 w-2 rounded-full ${s.fill}`} />
                            <span className="min-w-0 flex-1 truncate">{s.label}</span>
                            <span className="tabular-nums text-slate-900">{d.parts[s.key]}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-around gap-2 px-1 text-[10px] text-slate-400">
            {rows.map((d) => (
              <span key={d.date} className="max-w-9 flex-1 text-center whitespace-nowrap">
                {dayLabel(d.date)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.fill}`} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The last three calls, newest first, refreshed while the page is open.
 *
 * Everything else here is a period being counted. Somebody placing a call wants to see
 * that call - during a demo especially - and was having to leave the dashboard to find
 * out whether it had landed.
 */
function RecentCalls({ sessions, labels }: { sessions: Session[]; labels: Record<string, string> }) {
  const rows = sessions.slice(0, 3);
  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        No calls yet. Place one from Test Call and it will appear here.
      </p>
    );
  }
  const when = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : "";
  return (
    <div className="mt-3 divide-y divide-slate-100">
      {rows.map((s) => (
        <Link
          key={s.session_id}
          to={`/sessions/${encodeURIComponent(s.session_id)}`}
          className="flex items-center gap-3 py-2 text-xs transition hover:bg-slate-50"
        >
          <span className="flex w-28 shrink-0 items-center gap-2 font-medium text-slate-800">
            {s.active && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            <PhoneNumber value={s.phone_number} />
          </span>
          <span className="w-44 shrink-0">
            {s.active ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                On call now
              </span>
            ) : (
              <DispositionBadge
                code={s.disposition_code}
                label={s.disposition_code ? labels[s.disposition_code.toUpperCase()] : undefined}
                size="sm"
              />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-slate-500">
            {s.use_case || s.language || ""}
          </span>
          <span className="w-12 shrink-0 text-right tabular-nums text-slate-400">
            {s.duration_seconds ? `${s.duration_seconds}s` : ""}
          </span>
          <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
            {when(s.created_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 15_000 });
  // Refreshed on a timer: a call placed from another screen should show up here without
  // anybody reloading the page.
  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    refetchInterval: 10_000,
  });
  const { data: queue } = useQuery({ queryKey: ["queue"], queryFn: listQueueCalls });
  const { data: campaigns } = useQuery({ queryKey: ["campaigns"], queryFn: listCampaigns });

  // The period the page counts. Calls, dialer runs and outcomes follow it; the queue is
  // live and does not.
  const [searchParams, setSearchParams] = useSearchParams();
  const range = readRange(searchParams);
  const span = resolveRange(range);
  const spanQuery = windowQuery(span);
  const setRange = (next: RangeChoice) =>
    setSearchParams(writeRange(searchParams, next), { replace: true });
  // Counted in the database. The tiles used to be worked out in the browser from the
  // latest 200 calls, which quietly stops being every call at call 201.
  const { data: summary } = useQuery({
    queryKey: ["dashboardSummary", span.date_from ?? "", span.date_to ?? ""],
    queryFn: () => getAnalyticsSummary(span),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const activeSessions = sessions?.filter((s) => s.active).length ?? 0;
  const queuedCalls = queue?.filter((q) => q.status === "queued" || q.status === "ready").length ?? 0;

  const campaignStats = useMemo(() => {
    const all = campaigns ?? [];
    // "Running now" is live whenever the run was started; the count is of runs started
    // in the period.
    const running = all.filter((c) => c.status === "running").length;
    const list = all.filter((c) => {
      if (!span.date_from && !span.date_to) return true;
      const day = c.created_at?.slice(0, 10);
      if (!day) return false;
      return (!span.date_from || day >= span.date_from) && (!span.date_to || day <= span.date_to);
    });
    const totals = list.reduce(
      (acc, c) => {
        acc.completed += c.stats?.completed ?? 0;
        acc.noAnswer += c.stats?.no_answer ?? 0;
        acc.failed += c.stats?.failed ?? 0;
        return acc;
      },
      { completed: 0, noAnswer: 0, failed: 0 },
    );
    const attempted = totals.completed + totals.noAnswer + totals.failed;
    return {
      running,
      total: list.length,
      connectRate: attempted > 0 ? Math.round((totals.completed / attempted) * 100) : null,
      ...totals,
    };
  }, [campaigns, span.date_from, span.date_to]);

  // A code means whatever the client's analysis prompt says it means; /dispositions reads
  // those tables, so SURGERY_CONFIRMED arrives with the clinic's own wording.
  const { data: dispositions } = useQuery({
    queryKey: ["dispositions"],
    queryFn: () => getDispositions(),
  });
  const dispositionLabels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value.toUpperCase(), d.label])),
    [dispositions],
  );

  // What a collections client actually looks at: how many calls produced a promise to
  // pay, how many were refused, how many never reached anyone - in the chosen period.
  const outcomes = useMemo(() => {
    const counts: Record<string, number> = {};
    let analysed = 0;
    for (const d of summary?.by_disposition ?? []) {
      const code = d.code.toUpperCase();
      counts[code] = (counts[code] ?? 0) + d.count;
      analysed += d.count;
    }
    // Answer rate used to come off the campaign counters, which only know about calls a
    // campaign placed - 32 mostly-empty test campaigns reported 15% while the calls
    // themselves connected 73% of the time. Count the calls.
    const UNREACHED = ["NR", "ICR", "RNR", "LM"];
    const notReached = UNREACHED.reduce((n, code) => n + (counts[code] ?? 0), 0);
    const reached = analysed - notReached;
    // Every code the period produced gets a pile, so a clinic sees its own outcomes here
    // instead of five empty lending rows and one grey wedge called "Other codes".
    const piles = buildPiles(counts, dispositionLabels);
    // Each pile as a share of every analysed call - "out of a hundred calls, this many" -
    // apportioned so the column adds to exactly 100.
    const shares = sharesOf(piles.map((p) => p.n));
    const shareByKey: Record<string, number> = Object.fromEntries(
      piles.map((p, i) => [p.key, shares[i]]),
    );
    return {
      analysed,
      reached,
      notReached,
      piles,
      shareByKey,
      answerRate: analysed > 0 ? Math.round((reached / analysed) * 100) : null,
    };
  }, [summary, dispositionLabels]);

  // The badge in the header is all that is left of the health panel: a client wants to
  // know the thing is up, not which four services it is made of.
  const allReady = [health?.mongo_ready, health?.stt_ready, health?.llm_ready, health?.tts_ready]
    .every(Boolean);
  const days = summary?.by_day ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Dashboard</h1>
            <span
              className={`flex items-center gap-2 rounded-md border px-2 py-0.5 text-xs font-medium ${
                allReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${allReady ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              {allReady ? "All systems operational" : "Degraded"}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Calls, dialer runs and outcomes for the selected period. The queue is always live.
          </p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conversations"
          value={summary?.total ?? "—"}
          sub={`${activeSessions} currently active`}
          Icon={IconMessage}
          to={spanQuery ? `/sessions?${spanQuery}` : "/sessions"}
          tone="blue"
        />
        <StatCard
          label="Dialer runs"
          value={campaignStats.total}
          sub={campaignStats.running > 0 ? `${campaignStats.running} running now` : "None running"}
          Icon={IconCampaign}
          to="/campaigns"
          tone="emerald"
        />
        <StatCard
          label="Answer rate"
          value={outcomes.answerRate === null ? "—" : `${outcomes.answerRate}%`}
          sub={`${outcomes.reached} spoke · ${outcomes.notReached} not reached`}
          Icon={IconChart}
          to="/analytics"
          tone="violet"
        />
        <StatCard
          label="Calls in queue"
          value={queuedCalls}
          sub={queuedCalls === 0 ? "Nothing waiting" : "Waiting to dial"}
          Icon={IconHourglass}
          to="/calls"
          tone="amber"
        />
      </div>

      {/* Outcomes and trend. The outcome list is the page - it carries a row per outcome
          and a client's codes are long - so it takes the wider half. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Call outcomes"
          sub={
            outcomes.analysed === 0
              ? "Outcomes appear here once calls have been analysed"
              : `Across ${outcomes.analysed} analysed call${
                  outcomes.analysed === 1 ? "" : "s"
                } · ${describeRange(span)}`
          }
          action={{ to: "/sessions", label: "All conversations" }}
        >
          {outcomes.analysed > 0 ? (
            <OutcomeDonut outcomes={outcomes} spanQuery={spanQuery} />
          ) : (
            <p className="mt-3 flex flex-1 items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              {spanQuery
                ? "No analysed calls in this period."
                : "No analysed calls yet. Make a test call and the outcome will show up here."}
            </p>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Conversations trend"
          sub={days.length > 7 ? "Last 7 days with calls" : "Calls per day"}
          action={{ to: "/analytics", label: "Analytics" }}
        >
          <ConversationsTrend days={days} piles={outcomes.piles} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Recent calls"
          sub="Live - newest first, whoever placed them"
          action={{ to: "/sessions", label: "All conversations" }}
        >
          <RecentCalls sessions={sessions ?? []} labels={dispositionLabels} />
        </Panel>

        <Panel className="lg:col-span-2" title="Quick actions">
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              { to: "/campaigns", Icon: IconCampaign, label: "Start dialer", hint: "Pick a list and language", tone: "bg-emerald-50 text-emerald-600" },
              { to: "/templates", Icon: IconTemplate, label: "Edit prompts", hint: "Use cases and languages", tone: "bg-violet-50 text-violet-600" },
              { to: "/datasheets", Icon: IconTable, label: "Upload list", hint: "Add contacts to call", tone: "bg-blue-50 text-blue-600" },
              { to: "/sessions", Icon: IconMessage, label: "Review transcripts", hint: "Listen back to calls", tone: "bg-amber-50 text-amber-600" },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                title={a.hint}
                className="flex flex-col items-center gap-1.5 rounded-md px-1 py-2 text-center transition hover:bg-slate-50"
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${a.tone}`}>
                  <a.Icon size={17} />
                </span>
                <span className="text-[11px] font-medium leading-tight text-slate-700">{a.label}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
