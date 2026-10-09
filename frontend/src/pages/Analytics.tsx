import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAnalyticsSummary,
  getDispositions,
  listAnalyzeJobs,
  startAnalyzeJob,
} from "../api/endpoints";
import { formatShare, sharesOf } from "../components/shares";
import { labelForCode, tonesForCodes } from "../components/Outcomes";
import { AreaTrend, BarsWithLine, Funnel, MiniDonut, ShareBar } from "../components/charts";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Languages are not outcomes, so they take their own ramp rather than borrowing one
// that means "promise to pay" everywhere else on the page.
const LANGUAGE_TONES = [
  { stroke: "stroke-violet-500", fill: "bg-violet-500" },
  { stroke: "stroke-sky-500", fill: "bg-sky-500" },
  { stroke: "stroke-orange-400", fill: "bg-orange-400" },
  { stroke: "stroke-lime-600", fill: "bg-lime-600" },
  { stroke: "stroke-pink-500", fill: "bg-pink-500" },
];

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All", days: null as number | null },
];

export function Analytics() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [rangeIdx, setRangeIdx] = useState(1);
  const [executionId, setExecutionId] = useState(searchParams.get("execution_id") ?? "");
  const [parallelCount, setParallelCount] = useState(10);
  const [showJobs, setShowJobs] = useState(false);

  const dateFrom = RANGES[rangeIdx].days == null ? undefined : isoDaysAgo(RANGES[rangeIdx].days!);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["analyticsSummary", dateFrom ?? "all"],
    queryFn: () => getAnalyticsSummary({ date_from: dateFrom }),
    refetchInterval: 30_000,
  });
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );

  const { data: jobs } = useQuery({
    queryKey: ["analyze-jobs"],
    queryFn: listAnalyzeJobs,
    refetchInterval: showJobs ? 5_000 : false,
  });

  const startMutation = useMutation({
    mutationFn: () => startAnalyzeJob(executionId, parallelCount),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analyze-jobs"] }),
  });

  const days = summary?.by_day ?? [];
  const total = summary?.total ?? 0;
  const outcomeRows = summary?.by_disposition ?? [];
  // Shares are of the scored calls the list is made of - dividing by every call in the
  // period would leave the column short of 100 whenever some calls were never scored.
  const outcomeTotal = outcomeRows.reduce((s, d) => s + d.count, 0);
  const outcomeShares = sharesOf(outcomeRows.map((d) => d.count));
  // Every hour of the day, not only the ones that had calls: a list that jumped from 1
  // to 10 read like a sorting fault, and a gap at 3am is itself worth seeing.
  const hours = useMemo(() => {
    const seen = new Map((summary?.by_hour ?? []).map((h) => [h.hour, h]));
    return Array.from({ length: 24 }, (_, hour) => seen.get(hour) ?? { hour, calls: 0, answered: 0 });
  }, [summary]);
  const attempts = summary?.by_attempt ?? [];
  const callingHours = summary?.calling_hours ?? [];
  const outsideHours = summary?.outside_calling_hours ?? 0;
  const languages = summary?.by_language ?? [];
  const languageTotal = languages.reduce((s, l) => s + l.count, 0);
  const languageShares = sharesOf(languages.map((l) => l.count));
  // One colour per code, agreeing with the dashboard: a code in one of the six piles
  // keeps that pile's colour, the rest take the palette biggest-first.
  const outcomeTones = useMemo(
    () => tonesForCodes((summary?.by_disposition ?? []).map((d) => d.code)),
    [summary],
  );

  return (
    <div className="space-y-5 pb-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Analytics</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              What the agent achieved, counted from every scored call.
            </p>
          </div>
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setRangeIdx(i)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  i === rangeIdx
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls" value={total.toLocaleString("en-IN")} />
        <Stat
          label="Scored"
          value={(summary?.scored ?? 0).toLocaleString("en-IN")}
          hint={total ? `${Math.round(((summary?.scored ?? 0) / total) * 100)}% of calls` : undefined}
        />
        <Stat
          label="Promises to pay"
          value={(summary?.promises ?? 0).toLocaleString("en-IN")}
          tone="text-emerald-700"
          hint="PTP and FPTP together"
        />
        <Stat
          label="Promise rate"
          value={`${summary?.promise_rate ?? 0}%`}
          tone="text-emerald-700"
          hint="of every scored call"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Calls per day</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Every call placed, and the promises that came out of them.
        </p>
        {days.length === 0 && !isLoading ? (
          <p className="mt-4 text-xs text-slate-400">No calls in this period.</p>
        ) : (
          <AreaTrend
            labels={days.map((d) => d.date.slice(5))}
            series={[
              {
                key: "calls",
                label: "Calls",
                stroke: "stroke-indigo-600",
                fill: "bg-indigo-600",
                area: "fill-indigo-200",
                values: days.map((d) => d.calls),
              },
              {
                key: "promises",
                label: "Promises",
                stroke: "stroke-emerald-500",
                fill: "bg-emerald-500",
                area: "fill-emerald-200",
                values: days.map((d) => d.promises),
              },
            ]}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Outcomes</h2>
          {outcomeTotal > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              Share of the {outcomeTotal.toLocaleString("en-IN")} scored calls in this period.
            </p>
          )}
          {outcomeTotal > 0 && (
            <div className="mt-4">
              {/* The whole period in one line before the detail under it. */}
              <ShareBar
                slices={outcomeRows.map((d, i) => ({
                  key: d.code,
                  label: labelForCode(d.code, labels[d.code]),
                  n: d.count,
                  fill: outcomeTones[d.code.toUpperCase()].fill,
                  share: formatShare(outcomeShares[i]),
                }))}
              />
            </div>
          )}
          <div className="mt-4 space-y-1.5">
            {outcomeRows.map((d, i) => {
              const code = d.code.toUpperCase();
              const name = labelForCode(d.code, labels[d.code]);
              const pct = outcomeShares[i];
              return (
                <div
                  key={d.code}
                  className="flex items-center gap-2.5 text-xs"
                  title={`${code} — ${d.count} of ${outcomeTotal} calls = ${(
                    (d.count * 100) /
                    outcomeTotal
                  ).toFixed(2)}%`}
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${outcomeTones[code].fill}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{name}</span>
                  {/* The code is what a client's own report calls it, so it stays - but as
                      a chip that cannot run into the name beside it, which is what the two
                      fixed-width columns here used to do. */}
                  <span className="hidden max-w-[11rem] shrink-0 truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 md:block">
                    {code}
                  </span>
                  <div className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-40">
                    <div
                      className={`h-full rounded-full ${outcomeTones[code].fill}`}
                      style={{ width: `${Math.max(pct, 1.5)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums text-slate-600">
                    {d.count}
                    <span className="ml-1.5 text-slate-400">{formatShare(pct)}</span>
                  </span>
                </div>
              );
            })}
            {outcomeTotal > 0 && (
              <div className="flex items-center gap-2.5 border-t border-slate-100 pt-2 text-xs font-semibold text-slate-700">
                <span className="flex-1">Total</span>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {outcomeTotal}
                  <span className="ml-1.5 text-slate-400">100%</span>
                </span>
              </div>
            )}
            {!isLoading && outcomeRows.length === 0 && (
              <p className="text-xs text-slate-400">Nothing scored in this period.</p>
            )}
          </div>
        </div>

        {/* The two questions a desk asks every week and had to guess at: when is it worth
            ringing, and is a fourth attempt worth placing. Both are read off the calls. */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">When calls connect</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            By hour of the Indian day: how many went out, and how many of them reached
            someone.
            {callingHours.length === 2 && (
              <> Calls are meant to go out between {callingHours[0]}:00 and {callingHours[1]}:00;
              anything outside it is amber.</>
            )}
          </p>
          {(summary?.by_hour ?? []).length === 0 ? (
            <p className="mt-4 text-xs text-slate-400">No calls in this period.</p>
          ) : (
            <BarsWithLine
              labels={hours.map((h) => String(h.hour))}
              bars={hours.map((h) => h.calls)}
              rates={hours.map((h) => (h.calls ? (h.answered / h.calls) * 100 : null))}
              barClass={(i) =>
                callingHours.length !== 2 ||
                (hours[i].hour >= callingHours[0] && hours[i].hour < callingHours[1])
                  ? "bg-indigo-500"
                  : "bg-amber-400"
              }
              barLabel="Inside calling hours"
              legendExtra={[{ label: "Outside", className: "bg-amber-400" }]}
              lineLabel="Reached someone"
              tooltip={(i) =>
                `${hours[i].hour}:00 — ${hours[i].calls} calls, ${hours[i].answered} reached someone`
              }
            />
          )}
          {outsideHours > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>{outsideHours}</strong> of {summary?.total ?? 0} calls went out outside{" "}
              {callingHours[0]}:00–{callingHours[1]}:00. Collection calls are only allowed
              until 19:00.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Is another try worth it?</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            What each attempt returned, so a retry policy is a decision rather than a guess.
          </p>
          {attempts.length > 0 ? (
            <Funnel
              steps={attempts.map((a, i) => ({
                label: `Attempt ${a.attempt}`,
                total: a.calls,
                won: a.promises,
                wonLabel: "promised",
                fill: ["bg-emerald-500", "bg-emerald-600", "bg-teal-600", "bg-cyan-600"][i % 4],
              }))}
            />
          ) : (
            <p className="mt-4 text-xs text-slate-400">
              No attempt-numbered calls yet. Runs placed from now on record which try they
              are, and this fills in.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Languages</h2>
          {languageTotal > 0 && (
            <p className="mt-0.5 text-xs text-slate-500">
              Share of the {languageTotal.toLocaleString("en-IN")} calls with a language.
            </p>
          )}
          {languages.length > 0 ? (
            <MiniDonut
              total={languageTotal}
              centreLabel="Calls"
              slices={languages.map((l, i) => ({
                key: l.language,
                label: l.language,
                n: l.count,
                share: formatShare(languageShares[i]),
                ...LANGUAGE_TONES[i % LANGUAGE_TONES.length],
              }))}
            />
          ) : (
            !isLoading && <p className="mt-4 text-xs text-slate-400">No calls yet.</p>
          )}
        </div>
      </div>


      {/* Re-running the scorer over a past execution is a maintenance job, not something
          anyone opens this page for, so it stays folded away. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setShowJobs((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900">Re-score a past execution</span>
          <span className="text-xs text-slate-400">{showJobs ? "Hide" : "Show"}</span>
        </button>

        {showJobs && (
          <div className="border-t border-slate-100 p-5">
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (executionId.trim()) startMutation.mutate();
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="text-xs font-medium text-slate-600">
                Execution ID
                <input
                  value={executionId}
                  onChange={(e) => setExecutionId(e.target.value)}
                  className="mt-1 block h-9 rounded-lg border border-slate-300 px-2.5 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Parallel count
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={parallelCount}
                  onChange={(e) => setParallelCount(Number(e.target.value))}
                  className="mt-1 block h-9 w-28 rounded-lg border border-slate-300 px-2.5 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={startMutation.isPending || !executionId.trim()}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                Start
              </button>
            </form>

            <table className="mt-5 w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 font-semibold">Job</th>
                  <th className="py-1 font-semibold">Execution</th>
                  <th className="py-1 font-semibold">Status</th>
                  <th className="py-1 font-semibold">Progress</th>
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((job) => (
                  <tr key={job.job_id} className="border-t border-slate-100">
                    <td className="py-2 font-mono text-xs">{job.job_id.slice(-8)}</td>
                    <td className="py-2 text-xs">{job.execution_id}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full bg-indigo-600"
                            style={{ width: `${job.percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {job.processed}/{job.total}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(jobs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-xs text-slate-400">
                      No analysis jobs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone || "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
