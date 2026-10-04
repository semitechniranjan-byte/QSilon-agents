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
import type { ComponentType } from "react";

/** Vendor names stay server-side; the console only shows the capability and its state. */
type Capability = {
  key: string;
  Icon: ComponentType<{ size?: number }>;
  label: string;
  description: string;
  ready: boolean | undefined;
};

function StatCard({
  label,
  value,
  sub,
  Icon,
  to,
}: {
  label: string;
  value: string | number;
  sub?: string;
  Icon: ComponentType<{ size?: number }>;
  to?: string;
}) {
  const body = (
    <div className="group h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon size={17} />
        </span>
        {to && (
          <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
            <IconArrowRight size={16} />
          </span>
        )}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function CapabilityRow({ capability }: { capability: Capability }) {
  const { Icon, label, description, ready } = capability;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-800">{label}</div>
          <div className="truncate text-xs text-slate-400">{description}</div>
        </div>
      </div>
      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          ready ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-slate-400"}`}
        />
        {ready ? "Operational" : "Unavailable"}
      </span>
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

  const [tab, setTab] = useState<"outcomes" | "health" | "actions">("outcomes");

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
    // Codes outside the six tiles - ones belonging to other use cases, or any new one the
    // analysis starts returning - are deliberately left off this page. Saying how many
    // there are keeps the tiles from looking like they should add up to the total.
    const onTiles = Object.values(grouped).reduce((n, v) => n + v, 0);
    // Each tile as a share of every analysed call - "out of a hundred calls, this many" -
    // with the codes off the tiles counted in, so all of it together is 100%.
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

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
              <span
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium ${
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
            <p className="mt-0.5 text-sm text-slate-500">
              Calls, dialer runs and outcomes for the period on the right. The queue is
              always live.
            </p>
          </div>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conversations"
          value={summary?.total ?? "—"}
          sub={`${activeSessions} currently active`}
          Icon={IconMessage}
          to={spanQuery ? `/sessions?${spanQuery}` : "/sessions"}
        />
        <StatCard
          label="Dialer runs"
          value={campaignStats.total}
          sub={campaignStats.running > 0 ? `${campaignStats.running} running now` : "None running"}
          Icon={IconCampaign}
          to="/campaigns"
        />
        <StatCard
          label="Answer rate"
          value={outcomes.answerRate === null ? "—" : `${outcomes.answerRate}%`}
          sub={`${outcomes.reached} spoke · ${outcomes.notReached} not reached`}
          Icon={IconChart}
          to="/analytics"
        />
        <StatCard
          label="Calls in queue"
          value={queuedCalls}
          sub={queuedCalls === 0 ? "Nothing waiting" : "Waiting to dial"}
          Icon={IconHourglass}
          to="/calls"
        />
      </div>

      {/* The three panels share one card behind tabs, so the whole dashboard fits on one
        screen without scrolling. */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex gap-1 border-b border-slate-200 px-3">
          {([
            { key: "outcomes", label: "Call outcomes" },
            { key: "health", label: "System health" },
            { key: "actions", label: "Quick actions" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition ${
                tab === t.key
                  ? "border-indigo-600 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              {t.key === "health" && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${allReady ? "bg-emerald-500" : "bg-amber-500"}`}
                />
              )}
            </button>
          ))}
        </div>

        {tab === "outcomes" && (
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                {outcomes.analysed === 0
                  ? "Outcomes appear here once calls have been analysed"
                  : outcomes.otherCodes > 0
                    ? `${outcomes.onTiles} of ${outcomes.analysed} analysed calls · ${outcomes.otherCodes} on other codes, in Auto Dialer`
                    : `Across ${outcomes.analysed} analysed call${outcomes.analysed === 1 ? "" : "s"}`}
                {outcomes.analysed > 0 && ` · ${describeRange(span)}`}
              </p>
              <Link
                to="/sessions"
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                All conversations
              </Link>
            </div>

            {outcomes.analysed > 0 ? (
              /* Six tiles, each a link into the calls behind it. A number nobody can act on
                 is just decoration; from the list a caller can be dialled again or read. */
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                {OUTCOME_GROUPS.map((g) => {
                  const n = outcomes.byGroupKey[g.key] ?? 0;
                  return (
                    <Link
                      key={g.key}
                      to={`/sessions?outcome=${g.key}${spanQuery ? `&${spanQuery}` : ""}`}
                      className={`group rounded-xl border p-4 transition ${g.tile}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className="flex items-baseline gap-2"
                          title={`${n} of ${outcomes.analysed} analysed calls`}
                        >
                          <span className={`text-2xl font-semibold ${g.value}`}>{n}</span>
                          <span className="text-sm font-medium text-slate-500">
                            {formatShare(outcomes.shareByGroupKey[g.key] ?? 0)}
                          </span>
                        </div>
                        <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                          <IconArrowRight size={14} />
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-slate-700">{g.label}</div>
                      <div className="text-[11px] text-slate-400">{g.hint}</div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                {spanQuery
                  ? "No analysed calls in this period."
                  : "No analysed calls yet. Make a test call and the outcome will show up here."}
              </p>
            )}
          </div>
        )}

        {tab === "health" && (
          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Core capabilities powering every call</p>
              <Link
                to="/settings"
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Settings
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {capabilities.map((c) => (
                <CapabilityRow key={c.key} capability={c} />
              ))}
            </div>
          </div>
        )}

        {tab === "actions" && (
          <div className="p-5">
            <p className="text-xs text-slate-400">Jump straight into the common tasks</p>
            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {[
                { to: "/campaigns", Icon: IconCampaign, label: "Start a dialer run", hint: "Pick a list and language" },
                { to: "/templates", Icon: IconTemplate, label: "Edit prompts", hint: "Use cases and languages" },
                { to: "/datasheets", Icon: IconTable, label: "Upload a call list", hint: "Add contacts to call" },
                { to: "/sessions", Icon: IconMessage, label: "Review transcripts", hint: "Listen back to calls" },
              ].map((a) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className="group flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                    <a.Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{a.label}</div>
                    <div className="truncate text-xs text-slate-400">{a.hint}</div>
                  </div>
                  <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                    <IconArrowRight size={16} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
