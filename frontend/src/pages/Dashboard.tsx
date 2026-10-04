import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { OUTCOME_GROUPS, countsForGroups } from "../components/Outcomes";
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
  getHealth,
  listCampaigns,
  listQueueCalls,
  listSessions,
  type AnalyticsSummary,
} from "../api/endpoints";
import {
  IconArrowRight,
  IconCampaign,
  IconChart,
  IconCpu,
  IconDatabase,
  IconHourglass,
  IconMessage,
  IconMic,
  IconSpeaker,
  IconTable,
  IconTemplate,
} from "../components/Icons";
import type { ComponentType, ReactNode } from "react";

/** Vendor names stay server-side; the console only shows the capability and its state. */
type Capability = {
  key: string;
  Icon: ComponentType<{ size?: number }>;
  label: string;
  description: string;
  ready: boolean | undefined;
};

/**
 * One colour per outcome, shared by the donut, its legend and the trend, so a pile is the
 * same colour wherever it is drawn. Written out in full so the compiler sees the classes.
 */
const OUTCOME_COLORS: Record<string, { stroke: string; fill: string }> = {
  promise: { stroke: "stroke-emerald-500", fill: "bg-emerald-500" },
  refused: { stroke: "stroke-rose-500", fill: "bg-rose-500" },
  paid: { stroke: "stroke-blue-500", fill: "bg-blue-500" },
  callback: { stroke: "stroke-amber-500", fill: "bg-amber-500" },
  unreached: { stroke: "stroke-slate-300", fill: "bg-slate-300" },
  wrong: { stroke: "stroke-violet-500", fill: "bg-violet-500" },
};

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
  otherCodes: number;
  shareByGroupKey: Record<string, number>;
  byGroupKey: Record<string, number>;
};

/**
 * The six outcome piles as a ring, with the list beside it. Every row is still the link
 * into the calls behind it - the tiles it replaced were links, and a pile nobody can open
 * is just decoration.
 */
function OutcomeDonut({ outcomes, spanQuery }: { outcomes: Outcomes; spanQuery: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const r = 46;
  const circumference = 2 * Math.PI * r;
  // Codes off the six piles still take their share of the ring, in a quiet grey, so the
  // ring is every analysed call and matches the percentages beside it.
  const slices = [
    ...OUTCOME_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      n: outcomes.byGroupKey[g.key] ?? 0,
      stroke: OUTCOME_COLORS[g.key].stroke,
    })),
    { key: "other", label: "Other codes", n: outcomes.otherCodes, stroke: "stroke-slate-100" },
  ].filter((s) => s.n > 0);
  const many = slices.length > 1;
  let offset = 0;
  const hovered = slices.find((s) => s.key === hover);

  return (
    <div className="mt-3 flex flex-1 items-center gap-5">
      <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0 -rotate-90">
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
          {hovered ? hovered.label : "Analysed"}
        </text>
      </svg>

      <div className="min-w-0 flex-1 space-y-0.5">
        {OUTCOME_GROUPS.map((g) => {
          const n = outcomes.byGroupKey[g.key] ?? 0;
          return (
            <Link
              key={g.key}
              to={`/sessions?outcome=${g.key}${spanQuery ? `&${spanQuery}` : ""}`}
              onMouseEnter={() => setHover(g.key)}
              onMouseLeave={() => setHover(null)}
              title={`${n} of ${outcomes.analysed} analysed calls · ${g.hint}`}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1 text-xs transition hover:bg-slate-50 ${
                hover === g.key ? "bg-slate-50" : ""
              }`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${OUTCOME_COLORS[g.key].fill}`} />
              <span className="min-w-0 flex-1 truncate text-slate-700">{g.label}</span>
              <span className="w-8 text-right font-semibold tabular-nums text-slate-900">{n}</span>
              <span className="w-14 text-right tabular-nums text-slate-400">
                ({formatShare(outcomes.shareByGroupKey[g.key] ?? 0)})
              </span>
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

const TREND_SERIES = [
  { key: "promises", label: "Promise to pay", fill: "bg-emerald-500" },
  { key: "refused", label: "Refused to pay", fill: "bg-rose-500" },
  { key: "paid", label: "Claims paid", fill: "bg-blue-500" },
  { key: "others", label: "Others", fill: "bg-slate-300" },
] as const;

/**
 * Calls per day, each bar split by outcome. Only the last seven days that had calls are
 * drawn: the panel shares a row with the outcomes, and a bar for every day of "All time"
 * would be too thin to read or hover. The Analytics page keeps the full run.
 */
function ConversationsTrend({ days }: { days: AnalyticsSummary["by_day"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const rows = days.slice(-7).map((d) => {
    const promises = d.promises;
    const refused = d.refused ?? 0;
    const paid = d.paid ?? 0;
    return {
      date: d.date,
      calls: d.calls,
      promises,
      refused,
      paid,
      others: Math.max(0, d.calls - promises - refused - paid),
    };
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
      <div className="flex flex-1 gap-2">
        {/* y axis */}
        <div className="relative h-36 w-6 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
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
        <div className="flex-1">
          <div className="relative h-36">
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
                    {TREND_SERIES.map((s) =>
                      d[s.key] > 0 ? (
                        <div
                          key={s.key}
                          className={`w-full ${s.fill} last:rounded-t`}
                          style={{ flexGrow: d[s.key], flexBasis: 0, minHeight: 2 }}
                        />
                      ) : null,
                    )}
                  </div>
                  {hover === i && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-40 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-[11px] shadow-lg">
                      <div className="mb-1 font-semibold text-slate-900">
                        {dayLabel(d.date)} · {d.calls} call{d.calls === 1 ? "" : "s"}
                      </div>
                      {TREND_SERIES.map((s) => (
                        <div key={s.key} className="flex items-center gap-1.5 text-slate-600">
                          <span className={`h-2 w-2 rounded-full ${s.fill}`} />
                          <span className="flex-1">{s.label}</span>
                          <span className="tabular-nums text-slate-900">{d[s.key]}</span>
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
        {TREND_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${s.fill}`} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 15_000 });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
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
    const grouped = countsForGroups(counts);
    // Codes outside the six piles - ones belonging to other use cases, or any new one the
    // analysis starts returning - are deliberately left off this page. Saying how many
    // there are keeps the piles from looking like they should add up to the total.
    const onTiles = Object.values(grouped).reduce((n, v) => n + v, 0);
    // Each pile as a share of every analysed call - "out of a hundred calls, this many" -
    // with the codes off the piles counted in, so all of it together is 100%.
    const shares = sharesOf([
      ...OUTCOME_GROUPS.map((g) => grouped[g.key] ?? 0),
      analysed - onTiles,
    ]);
    const shareByGroupKey: Record<string, number> = Object.fromEntries(
      OUTCOME_GROUPS.map((g, i) => [g.key, shares[i]]),
    );
    return {
      analysed,
      reached,
      notReached,
      onTiles,
      shareByGroupKey,
      otherCodes: analysed - onTiles,
      answerRate: analysed > 0 ? Math.round((reached / analysed) * 100) : null,
      byGroupKey: grouped,
    };
  }, [summary]);

  const capabilities: Capability[] = [
    {
      key: "db",
      Icon: IconDatabase,
      label: "Data store",
      description: "Sessions, dialler runs and transcripts",
      ready: health?.mongo_ready,
    },
    {
      key: "stt",
      Icon: IconMic,
      label: "Speech recognition",
      description: "Transcribes the caller in real time",
      ready: health?.stt_ready,
    },
    {
      key: "llm",
      Icon: IconCpu,
      label: "Conversation engine",
      description: "Decides what the agent says next",
      ready: health?.llm_ready,
    },
    {
      key: "tts",
      Icon: IconSpeaker,
      label: "Voice synthesis",
      description: "Speaks the reply back to the caller",
      ready: health?.tts_ready,
    },
  ];

  const allReady = capabilities.every((c) => c.ready);
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

      {/* Outcomes and trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Call outcomes"
          sub={
            outcomes.analysed === 0
              ? "Outcomes appear here once calls have been analysed"
              : (outcomes.otherCodes > 0
                  ? `${outcomes.onTiles} of ${outcomes.analysed} analysed calls · ${outcomes.otherCodes} on other codes`
                  : `Across ${outcomes.analysed} analysed call${outcomes.analysed === 1 ? "" : "s"}`) +
                ` · ${describeRange(span)}`
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
          title="Conversations trend"
          sub={days.length > 7 ? "Last 7 days with calls" : "Calls per day"}
          action={{ to: "/analytics", label: "Analytics" }}
        >
          <ConversationsTrend days={days} />
        </Panel>
      </div>

      {/* System health and quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel
          title="System health"
          sub="Core capabilities powering every call"
          action={{ to: "/settings", label: "Settings" }}
          className="lg:col-span-3"
        >
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {capabilities.map(({ key, Icon, label, description, ready }) => (
              <div
                key={key}
                title={description}
                className="flex items-center gap-2.5 rounded-md border border-slate-200 px-2.5 py-2"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <Icon size={15} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-800">{label}</div>
                  <div
                    className={`flex items-center gap-1 text-[11px] font-medium ${
                      ready ? "text-emerald-700" : "text-slate-500"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-slate-400"}`}
                    />
                    {ready ? "Operational" : "Unavailable"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Quick actions" className="lg:col-span-2">
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
