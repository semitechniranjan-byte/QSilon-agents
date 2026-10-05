import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RowFilterBuilder } from "../components/RowFilterBuilder";
import type { RowFilterSpec } from "../api/endpoints";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCampaign,
  getAppSettings,
  launchCampaign,
  listCampaigns,
  listAgents,
  listDatasheets,
  listTemplates,
} from "../api/endpoints";
import type { Campaign, Template } from "../api/types";
import {
  IconChevronRight,
  IconEye,
} from "../components/Icons";

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  running: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  running: "Calling",
  completed: "Completed",
  failed: "Failed",
};

function formatIST(dateStr?: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });
  const timePart = d
    .toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${datePart} - ${timePart} IST`;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];
/** The hours of the day, for the call window. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function useCaseKeysOf(template?: Template | null): string[] {
  return Object.keys(template?.use_cases ?? {});
}

/** Languages configured for a use case, and whether each actually has a prompt. */
function languagesOf(template: Template | null | undefined, useCase: string) {
  const languages = template?.use_cases?.[useCase]?.languages ?? {};
  return Object.entries(languages).map(([key, cfg]) => ({
    key,
    ready: (cfg?.prompt ?? "").trim().length > 0,
  }));
}

export function Campaigns() {
  const queryClient = useQueryClient();
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
    refetchInterval: 5_000,
  });
  const { data: datasheets } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });
  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const { data: agentData } = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const agents = agentData?.agents ?? [];

  const template = templates?.[0] ?? null;
  const promptTemplateId = template?._id ?? "";
  const useCaseKeys = useCaseKeysOf(template);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  // A generated name should not overwrite one the operator has typed.
  const nameEdited = useRef(false);
  const [mode, setMode] = useState("test");
  const [datasheetId, setDatasheetId] = useState("");
  // Which rows of that list this run should dial - the client's own rules.
  const [rowFilter, setRowFilter] = useState<RowFilterSpec>({ match: "all", rules: [] });
  // This run's own calling rules, started from the deployment's settings. A morning
  // reminder list and an evening follow-up are the same product with different hours.
  const [callStartHour, setCallStartHour] = useState(9);
  const [callEndHour, setCallEndHour] = useState(19);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [retryGapHours, setRetryGapHours] = useState(4);

  const { data: appSettings } = useQuery({ queryKey: ["settings"], queryFn: getAppSettings });
  // Only while the dialog is shut, so typing in it is never overwritten by a refetch.
  useEffect(() => {
    if (isModalOpen || !appSettings) return;
    setCallStartHour(Number(appSettings.settings.calling_start_hour ?? 9));
    setCallEndHour(Number(appSettings.settings.calling_end_hour ?? 19));
    setMaxAttempts(Number(appSettings.settings.max_attempts ?? 3));
    setRetryGapHours(Number(appSettings.settings.retry_gap_hours ?? 4));
  }, [appSettings, isModalOpen]);
  const [useCase, setUseCase] = useState("");
  const [language, setLanguage] = useState("auto");
  // Several agents can work one campaign, so a big datasheet uses all capacity.
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  // A list uploaded at night should not wait for somebody to be at a screen in the
  // morning. Empty means start as soon as Launch is pressed.
  const [startAt, setStartAt] = useState("");
  const effectiveAgents = selectedAgentIds.length
    ? agents.filter((a) => selectedAgentIds.includes(a._id))
    : agents;
  const totalCapacity = effectiveAgents.reduce((s, a) => s + (a.max_concurrent_calls ?? 0), 0);
  const avgCallSeconds =
    effectiveAgents.length > 0
      ? effectiveAgents.reduce((s, a) => s + (a.max_call_seconds ?? 180), 0) / effectiveAgents.length
      : 180;

  const toggleAgent = (id: string) =>
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const effectiveUseCase = useCase || template?.default_use_case || useCaseKeys[0] || "";
  const languages = languagesOf(template, effectiveUseCase);
  const selectedLanguageReady =
    language === "auto" || languages.find((l) => l.key === language)?.ready !== false;

  // Arriving from a datasheet: open the form with that sheet already chosen, so uploading
  // a file and calling it are one movement rather than two screens and six choices.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get("datasheet");
    if (!wanted) return;
    setDatasheetId(wanted);
    setIsModalOpen(true);
    nameEdited.current = false;
    searchParams.delete("datasheet");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Name it after the sheet being called and the day, which is what these get called
  // anyway, and leave it editable.
  useEffect(() => {
    if (!isModalOpen || !datasheetId || nameEdited.current) return;
    const sheet = datasheets?.find((d) => d._id === datasheetId);
    if (!sheet) return;
    const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    setName(`${sheet.name} - ${today}`);
  }, [isModalOpen, datasheetId, datasheets]);

  const resetForm = () => {
    nameEdited.current = false;
    setStartAt("");
    setName("");
    setDatasheetId("");
    setUseCase("");
    setLanguage("auto");
    setSelectedAgentIds([]);
    setRowFilter({ match: "all", rules: [] });
  };

  const createAndLaunchMutation = useMutation({
    mutationFn: async () => {
      const created = await createCampaign({
        name,
        mode,
        scheduled_at: startAt ? new Date(startAt).toISOString() : undefined,
        datasheet_id: datasheetId,
        // Only a filter with rules in it travels; an empty one would read as "call none".
        row_filter: rowFilter.rules.length > 0 ? rowFilter : undefined,
        calling_start_hour: callStartHour,
        calling_end_hour: callEndHour,
        max_attempts: maxAttempts,
        retry_gap_hours: retryGapHours,
        prompt_template_id: promptTemplateId,
        use_case: effectiveUseCase,
        language,
        agent_ids: effectiveAgents.map((a) => a._id),
      });
      // A booked run is started by the sweep when its time comes; launching it here would
      // defeat the booking entirely.
      if (!startAt) await launchCampaign(created.campaign_id);
      return created;
    },
    onSuccess: () => {
      resetForm();
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const launchMutation = useMutation({
    mutationFn: (id: string) => launchCampaign(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !datasheetId || !promptTemplateId) return;
    createAndLaunchMutation.mutate();
  };

  const datasheetName = (id: string) => datasheets?.find((d) => d._id === id)?.name || id;
  const datasheetRowCount = (id: string) => datasheets?.find((d) => d._id === id)?.row_count ?? 0;

  const groups = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    for (const c of campaigns ?? []) {
      const list = map.get(c.datasheet_id) ?? [];
      list.push(c);
      map.set(c.datasheet_id, list);
    }
    return Array.from(map.entries())
      .map(([datasheetId, runs]) => {
        const oldestFirst = [...runs].sort(
          (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
        );
        const numbered = oldestFirst.map((c, idx) => ({ campaign: c, runNumber: idx + 1 }));
        const newestFirst = [...numbered].reverse();
        return {
          datasheetId,
          runs: newestFirst,
          completedCount: runs.filter((c) => c.status === "completed").length,
          latestCreatedAt: oldestFirst[oldestFirst.length - 1]?.created_at,
        };
      })
      .sort((a, b) => new Date(b.latestCreatedAt ?? 0).getTime() - new Date(a.latestCreatedAt ?? 0).getTime());
  }, [campaigns]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (datasheetId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(datasheetId)) next.delete(datasheetId);
      else next.add(datasheetId);
      return next;
    });
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedGroups = groups.slice(pageStart, pageStart + pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"><h1 className="text-lg font-semibold tracking-tight text-slate-900">Auto Dialer</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Call a whole list, several numbers at a time.
          </p></div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Run
        </button>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setIsModalOpen(false)}
        >
          {/* One screen, read top to bottom: what runs, who gets called, when, and with
              how much capacity. It used to be a narrow column where the filter had to
              share a half-width grid cell with a dropdown. */}
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="my-4 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">New call run</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {datasheetId
                    ? `${datasheetName(datasheetId)} · ${datasheetRowCount(datasheetId).toLocaleString("en-IN")} rows in the list`
                    : "Pick a list, choose who in it gets called, and when."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createAndLaunchMutation.isPending ||
                    !name.trim() ||
                    !datasheetId ||
                    !promptTemplateId ||
                    !effectiveUseCase
                  }
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  {createAndLaunchMutation.isPending
                    ? startAt
                      ? "Booking…"
                      : "Starting…"
                    : startAt
                      ? "Book this run"
                      : "Start calling"}
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  What runs
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="block text-xs font-medium text-slate-600">
                    Name this run
                    <input
                      value={name}
                      onChange={(e) => {
                        nameEdited.current = true;
                        setName(e.target.value);
                      }}
                      placeholder="July follow-up calls"
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Call list
                    <select
                      value={datasheetId}
                      onChange={(e) => setDatasheetId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    >
                      <option value="">Select a list…</option>
                      {(datasheets ?? []).map((ds) => (
                        <option key={ds._id} value={ds._id}>
                          {ds.name} ({ds.row_count} rows)
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="text-xs font-medium text-slate-600">
                    Mode
                    <div className="mt-1 flex h-9 rounded-lg border border-slate-200 p-0.5">
                      {[
                        { key: "test", label: "Test", hint: "first row only" },
                        { key: "production", label: "Production", hint: "the whole list" },
                      ].map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setMode(option.key)}
                          title={option.hint}
                          className={`flex-1 rounded-md text-xs font-medium transition ${
                            mode === option.key
                              ? "bg-indigo-600 text-white"
                              : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block text-xs font-medium text-slate-600">
                    Script
                    <div className="mt-1 flex h-9 w-full items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
                      {template?.name ?? "No template configured yet"}
                    </div>
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Use case
                    <select
                      value={effectiveUseCase}
                      onChange={(e) => {
                        setUseCase(e.target.value);
                        setLanguage("auto");
                      }}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    >
                      {useCaseKeys.length === 0 && <option value="">No use cases configured</option>}
                      {useCaseKeys.map((k) => (
                        <option key={k} value={k}>
                          {template?.use_cases?.[k]?.label || k}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-medium text-slate-600">
                    Language
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    >
                      <option value="auto">Auto — each row's own language</option>
                      {languages.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.key}
                          {l.ready ? "" : "  (no prompt yet)"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {/* Who gets called out of that list. The fields and the values come from the
                  list itself, so every client filters on their own vocabulary. */}
              {mode === "production" && (
                <section className="border-t border-slate-100 pt-5">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Who gets called
                  </h3>
                  <p className="mb-3 text-xs text-slate-500">
                    No rules means the whole list. The fields and values below come from this
                    list and from what its calls have produced.
                  </p>
                  {datasheetId ? (
                    <RowFilterBuilder
                      datasheetId={datasheetId}
                      value={rowFilter}
                      onChange={setRowFilter}
                    />
                  ) : (
                    <p className="text-xs text-slate-400">Pick a call list first.</p>
                  )}
                </section>
              )}

              <section className="border-t border-slate-100 pt-5">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  When to call
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="text-xs font-medium text-slate-600 md:col-span-2">
                    Call window (IST)
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        value={callStartHour}
                        onChange={(e) => setCallStartHour(Number(e.target.value))}
                        className="h-9 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                        ))}
                      </select>
                      <span className="text-slate-400">→</span>
                      <select
                        value={callEndHour}
                        onChange={(e) => setCallEndHour(Number(e.target.value))}
                        className="h-9 flex-1 rounded-lg border border-slate-300 px-2 text-sm"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                        ))}
                      </select>
                    </div>
                    <span className="mt-1 block text-[11px] font-normal text-slate-400">
                      Nothing is dialled outside these hours; rows wait for the next opening.
                      {callEndHour > 19 && (
                        <span className="text-amber-600">
                          {" "}RBI allows recovery calls only until 19:00.
                        </span>
                      )}
                    </span>
                  </div>

                  <label className="block text-xs font-medium text-slate-600">
                    Start at
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={(e) => setStartAt(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-slate-400">
                      {startAt ? "Booked — it starts itself." : "Empty starts it now."}
                    </span>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-medium text-slate-600">
                      Attempts
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={maxAttempts}
                        onChange={(e) => setMaxAttempts(Number(e.target.value))}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      Gap (hrs)
                      <input
                        type="number"
                        min={1}
                        max={72}
                        value={retryGapHours}
                        onChange={(e) => setRetryGapHours(Number(e.target.value))}
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2 text-sm"
                      />
                    </label>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  A number nobody answers is tried up to {maxAttempts} time
                  {maxAttempts === 1 ? "" : "s"}, {retryGapHours} hours apart. These apply to
                  this run only; Settings holds the defaults.
                </p>
              </section>

              {mode === "production" && agents.length > 0 && (
                <section className="border-t border-slate-100 pt-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Capacity ({effectiveAgents.length} of {agents.length} agents)
                    </h3>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAgentIds(
                          selectedAgentIds.length === agents.length ? [] : agents.map((a) => a._id),
                        )
                      }
                      className="text-xs font-medium text-slate-500 hover:underline"
                    >
                      {selectedAgentIds.length === agents.length ? "Clear" : "Select all"}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {agents.map((a) => {
                      const on = effectiveAgents.some((x) => x._id === a._id);
                      return (
                        <button
                          key={a._id}
                          type="button"
                          onClick={() => toggleAgent(a._id)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                            on
                              ? "border-slate-900 bg-indigo-600 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {a.name}
                          <span className={on ? "text-white/60" : "text-slate-400"}> ×{a.max_concurrent_calls}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    Rows are split across the selected agents in proportion to their capacity.
                  </p>

                  {datasheetId && (
                    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
                      {(() => {
                        const rows = datasheetRowCount(datasheetId);
                        const cap = totalCapacity || 100;
                        const perHour = (3600 / avgCallSeconds) * cap;
                        const hours = perHour > 0 ? rows / perHour : 0;
                        const eta = hours < 1 ? `${Math.ceil(hours * 60)} min` : `${hours.toFixed(1)} hours`;
                        return (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                            <span>
                              <strong className="text-slate-900">{rows.toLocaleString()}</strong> rows
                            </span>
                            <span>
                              <strong className="text-slate-900">{cap}</strong> calls at a time
                            </span>
                            <span>
                              ≈ <strong className="text-slate-900">{Math.round(perHour).toLocaleString()}</strong>/hr
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                              ~{eta}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </section>
              )}

              {mode === "production" && effectiveAgents.length === 0 && agents.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  No agents selected — the run will use all {agents.length} of them.
                </p>
              )}

              {!selectedLanguageReady && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  "{language}" has no prompt configured in Templates yet — calls would run with
                  an empty prompt. Add one first, or pick another language.
                </p>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {pagedGroups.map((group) => {
          const isOpen = expanded.has(group.datasheetId);
          return (
            <div key={group.datasheetId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => toggleExpanded(group.datasheetId)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                    <IconChevronRight size={14} />
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{datasheetName(group.datasheetId)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {group.runs.length} executions
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {datasheetRowCount(group.datasheetId)} rows
                  </span>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  completed: {group.completedCount}
                </span>
              </button>

              {isOpen && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
                      <tr>
                        <th className="px-4 py-2">Actions</th>
                        <th className="px-4 py-2">ID</th>
                        <th className="px-4 py-2">Use case / Language</th>
                        <th className="px-4 py-2">Calls</th>
                        <th className="px-4 py-2">Created At</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.runs.map(({ campaign: c, runNumber }) => (
                        <tr key={c._id} className="border-t border-slate-100">
                          <td className="px-4 py-2">
                            <Link
                              to={`/campaigns/${c._id}`}
                              title="View"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition hover:bg-indigo-600 hover:text-white"
                            >
                              <IconEye size={15} />
                            </Link>
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-700">RUN-{runNumber}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {c.use_case && (
                                <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                  {template?.use_cases?.[c.use_case]?.label || c.use_case}
                                </span>
                              )}
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                {!c.language || c.language === "auto" ? "Auto" : c.language}
                              </span>
                              {c.concurrency ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  ×{c.concurrency}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-slate-600">{c.stats?.total ?? 0}</td>
                          <td className="px-4 py-2 text-slate-500">{formatIST(c.created_at)}</td>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-1.5 text-slate-700">
                              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status] ?? "bg-slate-400"}`} />
                              {STATUS_LABEL[c.status] ?? c.status}
                            </span>
                          </td>
                          {c.status === "draft" && (
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => launchMutation.mutate(c._id)}
                                disabled={launchMutation.isPending}
                                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                              >
                                Launch
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="text-sm text-slate-400">No campaigns yet.</p>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {groups.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + pageSize, groups.length)} of{" "}
            {groups.length} entries
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              title="Previous page"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
            >
              <span className="inline-block rotate-180">
                <IconChevronRight size={13} />
              </span>
            </button>
            <span className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900">
              {page}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              title="Next page"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
            >
              <IconChevronRight size={13} />
            </button>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
