import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useDialog } from "../components/Dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDatasheetTemplate,
  deleteDatasheet,
  deleteDatasheetTemplate,
  downloadDatasheetCsv,
  getStandardResultColumns,
  type StandardResultColumn,
  adoptMappingKeys,
  discoverMappingKeys,
  getMappingKeys,
  inspectDatasheetFile,
  listTemplates,
  planDatasheetTemplate,
  previewDatasheet,
  type FormatPlan,
  suggestColumnMappings,
  listDatasheetTemplates,
  listDatasheets,
  renameDatasheet,
  setMappingKeys,
  updateDatasheetTemplate,
  uploadDatasheet,
} from "../api/endpoints";
import type {
  Datasheet,
  DatasheetTemplate,
  MappingKeyCategories,
  Template,
} from "../api/types";
import {
  IconChevronDown,
  IconCloudUpload,
  IconDatabase,
  IconDownload,
  IconFile,
  IconPencil,
  IconPlus,
  IconPhone,
  IconSearch,
  IconTable,
  IconTrash,
  IconX,
} from "../components/Icons";

const DEFAULT_MAPPING_KEY_CATEGORIES: MappingKeyCategories = {
  model_data: [
    "language_detected",
    "disposition_code",
    "ptp_date",
    "promise_reminder_flag",
    "promise_reminder_method",
    "ptp_days",
    "ptp_flag",
    "paid_flag",
    "status_reason_code",
    "voicemail_detected",
    "ptp_time",
  ],
  call_info: [
    "Duration",
    "Language",
    "language",
    "AnswerTime",
    "StartTime",
    "CallStartTime",
    "CallStatus",
    "call_status",
    "Disposition",
    "disposition",
    "EndTime",
    "CallEndTime",
    "EndTimeUtc",
    "CallDuration",
    "BillDuration",
  ],
  root: [
    "created_at",
    "call_status",
    "attempt_count",
    "session_id",
    "execution_id",
    "phone_number",
    "call_uuid",
    "recording_url",
    "recording_id",
  ],
};

function pathsFromCategories(categories: MappingKeyCategories): string[] {
  const paths: string[] = [];
  for (const [category, keys] of Object.entries(categories)) {
    for (const key of keys) {
      paths.push(category === "root" ? key : `${category}.${key}`);
    }
  }
  return paths.sort();
}

function useMappingKeys() {
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useQuery({
    queryKey: ["mapping-keys"],
    queryFn: getMappingKeys,
  });

  const saveMutation = useMutation({
    mutationFn: (next: MappingKeyCategories) => setMappingKeys(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mapping-keys"] }),
  });

  useEffect(() => {
    if (categories && Object.keys(categories).length === 0 && !saveMutation.isPending) {
      saveMutation.mutate(DEFAULT_MAPPING_KEY_CATEGORIES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  return { categories: categories ?? {}, isLoading, save: saveMutation.mutate };
}

function useDatasheetTemplates() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ["datasheet-templates"],
    queryFn: listDatasheetTemplates,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["datasheet-templates"] });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; required_columns: string[]; update_columns_mapping: Record<string, string> }) =>
      createDatasheetTemplate(payload),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<DatasheetTemplate> }) =>
      updateDatasheetTemplate(id, payload),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDatasheetTemplate(id),
    onSuccess: invalidate,
  });

  return {
    templates: templates ?? [],
    isLoading,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}

function CardHeader({
  Icon,
  accent,
  title,
  action,
}: {
  Icon: ComponentType<{ size?: number }>;
  accent: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${accent}`}
        >
          <Icon size={16} />
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function RequiredColumnsCard({
  template,
  save,
}: {
  template: DatasheetTemplate;
  save: (payload: Partial<DatasheetTemplate>) => void;
}) {
  const dialog = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);

  const addColumn = async () => {
    const name = (await dialog.prompt("New required column", { placeholder: "CUSTOMER_NAME" }))?.trim();
    if (!name || template.required_columns.includes(name)) return;
    save({ required_columns: [...template.required_columns, name] });
  };

  /**
   * Take the column names from a sheet instead of typing them.
   *
   * These were entered by hand from a file the operator already had open, and one typo
   * meant the real upload was rejected later for a column that looked identical. The
   * file carries its own headings, so they are read straight out of it - as the
   * {PLACEHOLDER} form a prompt uses. Nothing is imported and no row is stored.
   */
  const readFromFile = async (file: File) => {
    setReading(true);
    setReadNote(null);
    try {
      const info = await inspectDatasheetFile(file);
      const names = info.columns.map((c) => c.placeholder).filter(Boolean);
      const added = names.filter((n) => !template.required_columns.includes(n));
      if (!added.length) {
        setReadNote(`${info.filename}: all ${names.length} columns are already listed.`);
        return;
      }
      save({ required_columns: [...template.required_columns, ...added] });
      setReadNote(
        `${info.filename}: ${info.rows} rows, added ${added.length} of ${names.length} columns` +
          (info.phone_column ? ` · phone looks like "${info.phone_column}"` : ""),
      );
    } catch (err) {
      setReadNote((err as Error).message);
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const removeColumn = (col: string) => {
    save({ required_columns: template.required_columns.filter((c) => c !== col) });
  };
  // A column typed with a typo, or renamed in the client's export, had to be deleted and
  // added again - which lost its place in the order.
  const renameColumn = async (col: string) => {
    const next = (await dialog.prompt(`Rename "${col}"`, { defaultValue: col }))?.trim();
    if (!next || next === col || template.required_columns.includes(next)) return;
    save({
      required_columns: template.required_columns.map((c) => (c === col ? next : c)),
    });
  };

  const [filter, setFilter] = useState("");
  const shown = template.required_columns.filter((c) =>
    c.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <CardHeader
        Icon={IconTable}
        accent="bg-blue-50 text-blue-600"
        title="Required Columns"
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {template.required_columns.length} the file must have
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xlsm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFromFile(f);
              }}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={reading}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
            >
              {reading ? "Reading…" : "Read from file"}
            </button>
            <button
              onClick={addColumn}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Add Column
            </button>
          </div>
        }
      />
      {readNote && (
        <p className="border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-[11px] text-slate-600">
          {readNote}
        </p>
      )}
      {/* A client's file has thirty columns; one tall row each turned this into a page of
          scrolling. They are names - chips read faster and fit. */}
      {template.required_columns.length > 10 && (
        <div className="border-b border-slate-100 px-3 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${template.required_columns.length} columns`}
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 p-3">
        {shown.map((col) => (
          <span
            key={col}
            className="group inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-xs font-medium text-slate-700"
          >
            {col}
            <button
              onClick={() => renameColumn(col)}
              title={`Rename ${col}`}
              className="rounded p-0.5 text-slate-300 transition hover:bg-white hover:text-slate-600"
            >
              <IconPencil size={11} />
            </button>
            <button
              onClick={() => removeColumn(col)}
              title={`Remove ${col} from this format`}
              className="rounded p-0.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
            >
              <IconTrash size={11} />
            </button>
          </span>
        ))}
        {template.required_columns.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">
            No required columns yet — "Read from file" takes them from a spreadsheet's header.
          </p>
        )}
        {template.required_columns.length > 0 && shown.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">Nothing matches "{filter}".</p>
        )}
      </div>
    </div>
  );
}

function AddMappingModal({
  availablePaths,
  initialOutputCol,
  initialPath,
  onSave,
  onClose,
}: {
  availablePaths: string[];
  initialOutputCol?: string;
  initialPath?: string;
  onSave: (outputCol: string, path: string) => void;
  onClose: () => void;
}) {
  const [outputCol, setOutputCol] = useState(initialOutputCol ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPath
      ? initialPath
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean)
      : [],
  );
  const [search, setSearch] = useState("");
  const filtered = availablePaths.filter(
    (p) => p.toLowerCase().includes(search.trim().toLowerCase()) && !selected.includes(p),
  );

  const addPath = (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    setSelected([...selected, trimmed]);
    setSearch("");
  };
  const removePath = (p: string) => setSelected(selected.filter((s) => s !== p));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {initialOutputCol ? "Edit Mapping" : "Add Mapping"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <IconX size={16} />
          </button>
        </div>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          Output column name (e.g. DISPOSITION)
          <input
            value={outputCol}
            onChange={(e) => setOutputCol(e.target.value.toUpperCase())}
            disabled={!!initialOutputCol}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>

        <div className="mt-3 text-xs font-medium text-slate-600">
          Session field(s) to write back — first match wins, add more as fallbacks
        </div>
        {selected.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {selected.map((p, idx) => (
              <span
                key={p}
                className="flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-mono text-indigo-700"
              >
                {idx > 0 && <span className="text-slate-300">&rsaquo;</span>}
                {p}
                <button
                  onClick={() => removePath(p)}
                  title="Remove"
                  className="text-slate-400 transition hover:text-red-500"
                >
                  <IconX size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative mt-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPath(search);
              }
            }}
            placeholder="Search a field, or type a custom path and press Enter..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                <IconSearch size={14} />
              </span>
        </div>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-slate-100">
          {filtered.map((p) => (
            <button
              key={p}
              onClick={() => addPath(p)}
              className="block w-full px-3 py-2 text-left font-mono text-xs text-slate-700 hover:bg-slate-50"
            >
              + {p}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {availablePaths.length === 0
                ? "No result fields configured yet — add some in the Result Fields tab."
                : "No matching fields — you can still type a custom path and press Enter."}
            </p>
          )}
        </div>

        <button
          onClick={() => {
            if (outputCol.trim() && selected.length > 0) onSave(outputCol.trim(), selected.join("|"));
          }}
          disabled={!outputCol.trim() || selected.length === 0}
          className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Save Mapping
        </button>
      </div>
    </div>
  );
}

function ColumnMappingsCard({
  template,
  save,
  availablePaths,
}: {
  template: DatasheetTemplate;
  save: (payload: Partial<DatasheetTemplate>) => void;
  availablePaths: string[];
}) {
  const attempt = template.attempt_columns ?? [];
  const [modalState, setModalState] = useState<{ mode: "add" } | { mode: "edit"; outputCol: string } | null>(
    null,
  );

  const [suggestions, setSuggestions] = useState<Awaited<
    ReturnType<typeof suggestColumnMappings>
  > | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  /**
   * Work out the mappings this template is missing instead of typing them.
   *
   * Fifteen of the twenty-one already here are the column name lower-cased - PTP_DATE is
   * model_data.ptp_date - which is a rule, not a decision, so it is applied to the keys
   * calls actually produce.
   */
  const findSuggestions = async () => {
    setSuggesting(true);
    try {
      const found = await suggestColumnMappings(template._id);
      setSuggestions(found);
      setPicked(new Set(found.suggestions.map((s) => s.column)));
    } finally {
      setSuggesting(false);
    }
  };

  const addPicked = () => {
    if (!suggestions) return;
    const next = { ...template.update_columns_mapping };
    for (const s of suggestions.suggestions) if (picked.has(s.column)) next[s.column] = s.path;
    save({ update_columns_mapping: next });
    setSuggestions(null);
    setPicked(new Set());
  };

  const saveMapping = (outputCol: string, path: string) => {
    const previous = modalState?.mode === "edit" ? modalState.outputCol : null;
    const next = { ...template.update_columns_mapping };
    // Renaming used to leave the old column behind, so the sheet grew a duplicate that
    // nothing wrote to.
    if (previous && previous !== outputCol) delete next[previous];
    next[outputCol] = path;
    save({
      update_columns_mapping: next,
      attempt_columns:
        previous && previous !== outputCol
          ? attempt.map((c) => (c === previous ? outputCol : c))
          : attempt,
    });
    setModalState(null);
  };
  const removeMapping = (outputCol: string) => {
    const next = { ...template.update_columns_mapping };
    delete next[outputCol];
    save({
      update_columns_mapping: next,
      attempt_columns: attempt.filter((c) => c !== outputCol),
    });
  };

  // Paths these mappings read from that the Result Fields catalogue has never heard of.
  // They work - the export writes them - but they cannot be offered to the next format,
  // which is how a report ends up with columns nobody can explain.
  const { categories: resultFields, save: saveResultFields } = useMappingKeys();
  const unlisted = useMemo(() => {
    const known = new Set(availablePaths);
    const found: string[] = [];
    for (const path of Object.values(template.update_columns_mapping)) {
      for (const part of String(path).split("|").map((p) => p.trim()).filter(Boolean)) {
        if (!known.has(part) && !found.includes(part)) found.push(part);
      }
    }
    return found;
  }, [template.update_columns_mapping, availablePaths]);

  const toggleAttempt = (col: string) =>
    save({
      attempt_columns: attempt.includes(col)
        ? attempt.filter((c) => c !== col)
        : [...attempt, col],
    });

  // The short set almost every client reads. Thirty-five equal rows is not a list anyone
  // can check before a run; these lead, and whatever else a deployment maps follows.
  const { data: standard = [] } = useQuery({
    queryKey: ["standardResultColumns"],
    queryFn: getStandardResultColumns,
  });
  const standardNames = new Set(standard.map((s) => s.column));
  const mapped = template.update_columns_mapping;

  const toggleStandard = (entry: StandardResultColumn) => {
    const next = { ...mapped };
    if (next[entry.column]) {
      delete next[entry.column];
      save({
        update_columns_mapping: next,
        attempt_columns: attempt.filter((c) => c !== entry.column),
      });
      return;
    }
    next[entry.column] = entry.path;
    save({
      update_columns_mapping: next,
      attempt_columns: entry.per_attempt && !attempt.includes(entry.column)
        ? [...attempt, entry.column]
        : attempt,
    });
  };

  const useWholeStandardSet = () =>
    save({
      update_columns_mapping: {
        ...Object.fromEntries(standard.map((s) => [s.column, s.path])),
        ...mapped,
      },
      attempt_columns: Array.from(
        new Set([...attempt, ...standard.filter((s) => s.per_attempt).map((s) => s.column)]),
      ),
    });

  const [filter, setFilter] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const extras = Object.entries(mapped).filter(([col]) => !standardNames.has(col));
  const shown = extras.filter(
    ([col, path]) =>
      col.toLowerCase().includes(filter.trim().toLowerCase()) ||
      String(path).toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const listUnknownFields = () => {
    const next: Record<string, string[]> = { ...resultFields };
    for (const path of unlisted) {
      const dot = path.indexOf(".");
      const category = dot === -1 ? "root" : path.slice(0, dot);
      const key = dot === -1 ? path : path.slice(dot + 1);
      const existing = next[category] ?? [];
      if (!existing.includes(key)) next[category] = [...existing, key];
    }
    saveResultFields(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <CardHeader
        Icon={IconDatabase}
        accent="bg-slate-50 text-indigo-600"
        title="Written back after each call"
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {Object.keys(template.update_columns_mapping).length} columns
              {attempt.length > 0 && ` · ${attempt.length} per attempt`}
            </span>
            <button
              onClick={findSuggestions}
              disabled={suggesting}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
            >
              {suggesting ? "Looking…" : "Suggest"}
            </button>
            <button
              onClick={() => setModalState({ mode: "add" })}
              className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Add Mapping
            </button>
          </div>
        }
      />

      {unlisted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/70 px-3 py-2">
          <p className="min-w-0 text-[11px] text-amber-800">
            {unlisted.length} field{unlisted.length === 1 ? " is" : "s are"} read here but not in
            Result Fields, so no other format can offer {unlisted.length === 1 ? "it" : "them"}:{" "}
            <span className="font-mono">{unlisted.slice(0, 3).join(", ")}</span>
            {unlisted.length > 3 && ` +${unlisted.length - 3} more`}
          </p>
          <button
            onClick={listUnknownFields}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 transition hover:bg-amber-100"
          >
            Add to Result Fields
          </button>
        </div>
      )}

      {suggestions && (
        <div className="border-b border-slate-100 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              {suggestions.suggestions.length} not mapped yet, from {suggestions.sampled} calls
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setSuggestions(null)}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={addPicked}
                disabled={picked.size === 0}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                Add {picked.size} mapping{picked.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
          <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
            {suggestions.suggestions.map((sg) => (
              <label
                key={sg.column}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-white px-2.5 py-1.5"
              >
                <input
                  type="checkbox"
                  checked={picked.has(sg.column)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(sg.column);
                    else next.delete(sg.column);
                    setPicked(next);
                  }}
                />
                <span className="w-52 shrink-0 truncate text-xs font-medium text-slate-800">
                  {sg.column}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
                  {sg.path}
                </span>
                {sg.coverage != null && (
                  <span className="shrink-0 text-[10px] text-slate-400">{sg.coverage}%</span>
                )}
              </label>
            ))}
            {suggestions.suggestions.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-slate-400">
                Nothing missing — every field these calls produce is already mapped.
              </p>
            )}
          </div>
        </div>
      )}

      {/* The results a desk reads, in the order they read them: when we rang, whether it
          connected, how long, what it came to, the promise. Ticking one maps it; the
          "per attempt" toggle decides whether every attempt keeps its own copy. */}
      <div className="divide-y divide-slate-100">
        {standard.map((entry) => {
          const on = Boolean(mapped[entry.column]);
          const perAttempt = attempt.includes(entry.column);
          return (
            <div
              key={entry.column}
              className={`flex items-center gap-3 px-3 py-2 transition ${on ? "" : "opacity-60"}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggleStandard(entry)}
                title={on ? `Stop writing ${entry.column}` : `Write ${entry.column} back`}
                className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">
                  {entry.column}
                </div>
                <div className="truncate text-[11px] text-slate-500" title={entry.path}>
                  {entry.label}
                </div>
              </div>
              {on && (
                <button
                  onClick={() => toggleAttempt(entry.column)}
                  title={
                    perAttempt
                      ? `Every attempt keeps its own ${entry.column} — click to keep only the latest`
                      : `Only the latest ${entry.column} is kept — click to keep one per attempt`
                  }
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                    perAttempt
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 text-slate-400 hover:border-emerald-200 hover:text-emerald-600"
                  }`}
                >
                  per attempt
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2">
        <button
          onClick={() => setShowExtras((v) => !v)}
          className="text-xs font-medium text-slate-600 hover:underline"
        >
          {showExtras ? "Hide" : "Show"} other columns ({extras.length})
        </button>
        <button
          onClick={useWholeStandardSet}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Tick the whole standard set
        </button>
      </div>

      {showExtras && extras.length > 8 && (
        <div className="border-t border-slate-100 px-3 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Search ${extras.length} other columns`}
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs"
          />
        </div>
      )}
      <div className={showExtras ? "divide-y divide-slate-100 border-t border-slate-100" : "hidden"}>
        {shown.map(([outputCol, path]) => {
          const perAttempt = attempt.includes(outputCol);
          return (
            <div
              key={outputCol}
              className="flex items-center gap-2 px-3 py-2 transition hover:bg-slate-50/70"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{outputCol}</div>
                <div className="truncate font-mono text-[11px] text-slate-500" title={path}>
                  {path}
                </div>
              </div>
              <button
                onClick={() => toggleAttempt(outputCol)}
                title={
                  perAttempt
                    ? `Every attempt keeps its own ${outputCol} — click to keep only the latest`
                    : `Only the latest ${outputCol} is kept — click to keep one per attempt`
                }
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                  perAttempt
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-400 hover:border-emerald-200 hover:text-emerald-600"
                }`}
              >
                per attempt
              </button>
              <button
                onClick={() => setModalState({ mode: "edit", outputCol })}
                className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                title={`Rename ${outputCol}, or change where it is read from`}
              >
                <IconPencil size={13} />
              </button>
              <button
                onClick={() => removeMapping(outputCol)}
                className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                title={`Stop writing ${outputCol} back`}
              >
                <IconTrash size={13} />
              </button>
            </div>
          );
        })}
        {extras.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-400">
            Nothing beyond the standard set. "Suggest" reads what recent calls produce and
            proposes anything else worth keeping.
          </p>
        )}
        {extras.length > 0 && shown.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-400">Nothing matches "{filter}".</p>
        )}
      </div>

      {modalState && (
        <AddMappingModal
          availablePaths={availablePaths}
          initialOutputCol={modalState.mode === "edit" ? modalState.outputCol : undefined}
          initialPath={modalState.mode === "edit" ? template.update_columns_mapping[modalState.outputCol] : undefined}
          onSave={saveMapping}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}

type UploadedTemplateJson = {
  name?: string;
  required_columns?: string[];
  required_columns_mapping?: Record<string, string>;
  update_columns_mapping?: Record<string, string>;
  attempt_columns?: string[];
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === "string")
  );
}

const EXPORT_KIND = "wordworks.datasheet_template";

function UploadJsonButton({ onImport }: { onImport: (payload: UploadedTemplateJson) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setSuccess(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept either the flat shape or the wrapped export shape (kind/version/template).
      const source = parsed.kind === EXPORT_KIND && parsed.template ? parsed.template : parsed;

      const payload: UploadedTemplateJson = {};
      if (typeof source.name === "string") payload.name = source.name;
      if (isStringArray(source.required_columns)) payload.required_columns = source.required_columns;
      if (isStringRecord(source.required_columns_mapping)) {
        payload.required_columns_mapping = source.required_columns_mapping;
      }
      if (isStringRecord(source.update_columns_mapping)) payload.update_columns_mapping = source.update_columns_mapping;
      if (isStringArray(source.attempt_columns)) payload.attempt_columns = source.attempt_columns;

      if (Object.keys(payload).length === 0) {
        setError(
          'No recognized fields found. Expected "required_columns" (array), "update_columns_mapping" (object), and/or "attempt_columns" (array) — either at the top level or under a "template" key.',
        );
        return;
      }
      onImport(payload);
      setSuccess(`Imported ${Object.keys(payload).join(", ")} from ${file.name}.`);
    } catch (e) {
      setError(e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON file.");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        Upload JSON
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
      {success && <p className="max-w-xs text-right text-xs text-emerald-600">{success}</p>}
    </div>
  );
}

function downloadTemplateJson(template: DatasheetTemplate) {
  const payload = {
    kind: EXPORT_KIND,
    version: 1,
    exported_at: new Date().toISOString(),
    source: { template_id: template._id },
    template: {
      name: template.name,
      required_columns: template.required_columns,
      required_columns_mapping: template.required_columns_mapping ?? {},
      update_columns_mapping: template.update_columns_mapping,
      attempt_columns: template.attempt_columns ?? [],
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${template.name || "datasheet-template"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function DownloadJsonButton({ template }: { template: DatasheetTemplate }) {
  return (
    <button
      onClick={() => downloadTemplateJson(template)}
      className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
    >
      Download JSON
    </button>
  );
}

type FieldChip = {
  key: string;
  path: string;
  /** Share of recently sampled calls that carry it, or null when nothing has been sampled. */
  coverage: number | null;
  /** How many list formats read from it. */
  usedBy: number;
};

function CategoryCard({
  category,
  fields,
  sampled,
  onAddKey,
  onRemoveKey,
  onDeleteCategory,
}: {
  category: string;
  fields: FieldChip[];
  sampled: number;
  onAddKey: (category: string) => void;
  onRemoveKey: (category: string, key: string) => void;
  onDeleteCategory: (category: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const used = fields.filter((f) => f.usedBy > 0).length;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          <span className={`text-slate-400 transition-transform ${collapsed ? "-rotate-90" : ""}`}>
            <IconChevronDown size={14} />
          </span>
          <span className="font-mono text-sm font-semibold text-slate-900">{category}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {fields.length} fields
          </span>
          {used > 0 && (
            <span className="hidden rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 sm:inline">
              {used} in use
            </span>
          )}
        </button>
        <button
          onClick={() => onDeleteCategory(category)}
          className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
          title={`Delete the ${category} group and its fields`}
        >
          <IconTrash size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="p-4">
          <div className="flex flex-wrap gap-1.5">
            {fields.map((f) => {
              // Three states worth telling apart: a field a format reads, a field the calls
              // carry but nothing uses, and a field nothing has carried lately.
              const tone =
                f.usedBy > 0
                  ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                  : f.coverage === null || f.coverage > 0
                    ? "border-slate-200 bg-white text-slate-600"
                    : "border-amber-200 bg-amber-50 text-amber-800";
              const note =
                f.coverage === null
                  ? f.path
                  : `${f.path} — in ${f.coverage}% of the last ${sampled} calls` +
                    (f.usedBy > 0 ? `, read by ${f.usedBy} format${f.usedBy === 1 ? "" : "s"}` : "");
              return (
                <span
                  key={f.key}
                  title={note}
                  className={`inline-flex items-center gap-1.5 rounded-lg border py-1 pl-2.5 pr-1 font-mono text-xs ${tone}`}
                >
                  {f.key}
                  {f.coverage !== null && (
                    <span className="rounded bg-white/70 px-1 text-[10px] font-sans text-slate-500">
                      {f.coverage}%
                    </span>
                  )}
                  <button
                    onClick={() => onRemoveKey(category, f.key)}
                    title={`Remove ${f.key}`}
                    className="rounded p-0.5 text-current opacity-40 transition hover:bg-white hover:text-rose-600 hover:opacity-100"
                  >
                    <IconX size={11} />
                  </button>
                </span>
              );
            })}
            {fields.length === 0 && <p className="text-xs text-slate-400">No fields here yet.</p>}
          </div>
          <button
            onClick={() => onAddKey(category)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <IconPlus size={12} />
            Add a field
          </button>
        </div>
      )}
    </div>
  );
}

function MappingKeysTab() {
  const queryClient = useQueryClient();
  const [adopting, setAdopting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const dialog = useDialog();
  const { categories, isLoading, save } = useMappingKeys();

  // Read the calls rather than asking someone to press a button and read the result: the
  // catalogue drifts both ways, and which way is the useful part.
  const { data: scan, isFetching: scanning } = useQuery({
    queryKey: ["mapping-keys-scan"],
    queryFn: () => discoverMappingKeys(),
    staleTime: 60_000,
  });
  const { data: formats = [] } = useQuery({
    queryKey: ["datasheetTemplates"],
    queryFn: listDatasheetTemplates,
  });

  const pathOf = (category: string, key: string) =>
    category === "root" ? key : `${category}.${key}`;

  // How often each field appears in recent calls...
  const coverage = new Map<string, number>();
  for (const c of scan?.categories ?? []) {
    for (const k of c.keys) coverage.set(pathOf(c.category, k.key), k.coverage);
  }
  // ...and how many formats read from it.
  const usedBy = new Map<string, number>();
  for (const format of formats) {
    for (const path of Object.values(format.update_columns_mapping ?? {})) {
      for (const part of String(path).split("|").map((p) => p.trim())) {
        if (part) usedBy.set(part, (usedBy.get(part) ?? 0) + 1);
      }
    }
  }

  const term = search.trim().toLowerCase();
  const shown = Object.entries(categories)
    .map(([category, keys]) => ({
      category,
      fields: keys
        .filter((k) => !term || k.toLowerCase().includes(term) || category.toLowerCase().includes(term))
        .map((key) => ({
          key,
          path: pathOf(category, key),
          coverage: scan ? (coverage.get(pathOf(category, key)) ?? 0) : null,
          usedBy: usedBy.get(pathOf(category, key)) ?? 0,
        })),
    }))
    .filter((c) => !term || c.fields.length > 0);

  const missing = (scan?.categories ?? []).flatMap((c) =>
    c.new.map((key) => ({ category: c.category, key })),
  );
  const totalFields = Object.values(categories).reduce((n, keys) => n + keys.length, 0);
  const inUse = Object.entries(categories).reduce(
    (n, [category, keys]) => n + keys.filter((k) => (usedBy.get(pathOf(category, k)) ?? 0) > 0).length,
    0,
  );

  const addKey = async (category: string) => {
    const key = (await dialog.prompt(`New field in "${category}"`, { placeholder: "ptp_date" }))?.trim();
    if (!key || (categories[category] ?? []).includes(key)) return;
    save({ ...categories, [category]: [...(categories[category] ?? []), key] });
  };
  const removeKey = (category: string, key: string) => {
    save({ ...categories, [category]: (categories[category] ?? []).filter((k) => k !== key) });
  };
  const deleteCategory = async (category: string) => {
    const ok = await dialog.confirm(`Delete the "${category}" group?`, {
      body: "Every field in it goes too. Formats already reading from them keep working.",
      danger: true,
    });
    if (!ok) return;
    const next = { ...categories };
    delete next[category];
    save(next);
  };
  const createCategory = async () => {
    const name = (await dialog.prompt("New group", { placeholder: "model_data" }))?.trim();
    if (!name || categories[name]) return;
    save({ ...categories, [name]: [] });
  };

  const addMissing = async () => {
    setAdopting(true);
    setNote(null);
    try {
      const res = await adoptMappingKeys();
      const count = Object.values(res.added).reduce((n, k) => n + k.length, 0);
      setNote(`Added ${count} field${count === 1 ? "" : "s"} the calls were already producing.`);
      queryClient.invalidateQueries({ queryKey: ["mapping-keys"] });
      queryClient.invalidateQueries({ queryKey: ["mapping-keys-scan"] });
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setAdopting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-600">
            Everything a call leaves behind, which is what a list format can write into a
            client's sheet.
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {totalFields} fields · {inUse} read by a format
            {scan ? ` · measured against the last ${scan.sampled} calls` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields"
            className="h-9 w-44 rounded-lg border border-slate-300 px-2.5 text-sm"
          />
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ["mapping-keys-scan"] })}
            disabled={scanning}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            {scanning ? "Reading calls…" : "Re-read calls"}
          </button>
          <button
            onClick={createCategory}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            New group
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-indigo-200 bg-indigo-50" />
          read by a format
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white" />
          produced by calls, nothing reads it yet
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border border-amber-200 bg-amber-50" />
          not seen in recent calls
        </span>
      </div>

      {missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-2.5">
          <p className="min-w-0 text-xs text-amber-900">
            <strong>{missing.length}</strong> field{missing.length === 1 ? "" : "s"} recent calls
            carry {missing.length === 1 ? "is" : "are"} not listed yet:{" "}
            <span className="font-mono">
              {missing.slice(0, 4).map((m) => pathOf(m.category, m.key)).join(", ")}
            </span>
            {missing.length > 4 && ` +${missing.length - 4} more`}
          </p>
          <button
            onClick={addMissing}
            disabled={adopting}
            className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-40"
          >
            {adopting ? "Adding…" : "Add them"}
          </button>
        </div>
      )}

      {note && <p className="text-xs text-slate-500">{note}</p>}
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="space-y-4">
        {shown.map((c) => (
          <CategoryCard
            key={c.category}
            category={c.category}
            fields={c.fields}
            sampled={scan?.sampled ?? 0}
            onAddKey={addKey}
            onRemoveKey={removeKey}
            onDeleteCategory={deleteCategory}
          />
        ))}
        {!isLoading && shown.length === 0 && (
          <p className="text-sm text-slate-400">
            {term ? `Nothing matches "${search}".` : "No groups yet."}
          </p>
        )}
      </div>
    </div>
  );
}


function TemplatesTab({ availablePaths }: { availablePaths: string[] }) {
  const dialog = useDialog();
  const { templates, isLoading, createMutation, updateMutation, deleteMutation } = useDatasheetTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const editingTemplate = templates.find((t) => t._id === editingId) ?? null;

  // Build the whole format from a file and a script instead of typing three lists that
  // are each written down somewhere already.
  const planFileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planDatasheetTemplate>> | null>(null);
  const [planFor, setPlanFor] = useState<{ useCase: string; language: string }>({
    useCase: "",
    language: "",
  });
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const { data: promptTemplates } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const promptTemplate: Template | null = promptTemplates?.[0] ?? null;
  const useCaseOptions = Object.entries(promptTemplate?.use_cases ?? {}).map(([key, cfg]) => ({
    key,
    label: (cfg as { label?: string })?.label || key,
    languages: Object.keys((cfg as { languages?: Record<string, unknown> })?.languages ?? {}),
  }));
  const activeUseCase = useCaseOptions.find((u) => u.key === planFor.useCase) ?? useCaseOptions[0];

  const buildPlan = async (file: File) => {
    setPlanning(true);
    setPlanError(null);
    try {
      setPlan(
        await planDatasheetTemplate(file, {
          use_case: activeUseCase?.key,
          language: planFor.language || undefined,
          template_id: promptTemplate?._id,
        }),
      );
    } catch (err) {
      setPlanError((err as Error).message);
    } finally {
      setPlanning(false);
      if (planFileRef.current) planFileRef.current.value = "";
    }
  };

  const createFromPlan = async () => {
    if (!plan) return;
    const name = (await dialog.prompt("Name this format", {
      defaultValue: plan.filename.replace(/\.[^.]+$/, ""),
    }))?.trim();
    if (!name) return;
    createMutation.mutate(
      {
        name,
        required_columns: plan.required_columns,
        update_columns_mapping: plan.update_columns_mapping,
      },
      {
        onSuccess: (data) => {
          setPlan(null);
          setEditingId(data.datasheet_template_id);
        },
      },
    );
  };

  const handleCreate = async () => {
    const name = (await dialog.prompt("New template name", { placeholder: "bajaj pdm" }))?.trim();
    if (!name) return;
    createMutation.mutate(
      { name, required_columns: [], update_columns_mapping: {} },
      { onSuccess: (data) => setEditingId(data.datasheet_template_id) },
    );
  };

  const handleDelete = async (t: DatasheetTemplate) => {
    const ok = await dialog.confirm(`Delete template "${t.name}"?`, {
      body: "This cannot be undone.",
      danger: true,
    });
    if (!ok) return;
    deleteMutation.mutate(t._id);
    if (editingId === t._id) setEditingId(null);
  };

  if (editingTemplate) {
    const save = (payload: Partial<DatasheetTemplate>) =>
      updateMutation.mutate({ id: editingTemplate._id, payload });

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setEditingId(null)} className="text-sm text-slate-500 hover:underline">
            Back to templates
          </button>
          <div className="flex gap-2">
            <DownloadJsonButton template={editingTemplate} />
            <UploadJsonButton onImport={(payload) => save(payload)} />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{editingTemplate.name}</h2>
        {/* Two panels, not three: what the file must bring, and what the calls write back.
            Whether a column is kept per attempt is a property of that column, so it is a
            toggle on its row rather than a third list to cross-reference. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <RequiredColumnsCard template={editingTemplate} save={save} />
          </div>
          <div className="lg:col-span-3">
            <ColumnMappingsCard
              template={editingTemplate}
              save={save}
              availablePaths={availablePaths}
            />
          </div>
        </div>
      </div>
    );
  }

  const filtered = templates.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72 max-w-full">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                <IconSearch size={14} />
              </span>
        </div>
        <select
          value={activeUseCase?.key ?? ""}
          onChange={(e) => setPlanFor({ useCase: e.target.value, language: "" })}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          {useCaseOptions.map((u) => (
            <option key={u.key} value={u.key}>
              {u.label}
            </option>
          ))}
        </select>
        <select
          value={planFor.language}
          onChange={(e) => setPlanFor((p) => ({ ...p, language: e.target.value }))}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">Default language</option>
          {(activeUseCase?.languages ?? []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input
          ref={planFileRef}
          type="file"
          accept=".csv,.xlsx,.xlsm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void buildPlan(f);
          }}
          className="hidden"
        />
        <button
          onClick={() => planFileRef.current?.click()}
          disabled={planning}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {planning ? "Reading…" : "Build from a file"}
        </button>
        <button
          onClick={handleCreate}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Empty format
        </button>
      </div>

      {planError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {planError}
        </p>
      )}

      {plan && <PlanPreview plan={plan} onCancel={() => setPlan(null)} onCreate={createFromPlan} />}

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Template Name</th>
              <th className="px-4 py-2">Required Columns</th>
              <th className="px-4 py-2">Mappings</th>
              <th className="px-4 py-2">Attempt Tracking</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t._id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-900">{t.name}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {t.required_columns.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                      >
                        {c}
                      </span>
                    ))}
                    {t.required_columns.length > 3 && (
                      <span className="text-xs text-slate-400">+{t.required_columns.length - 3} more</span>
                    )}
                    {t.required_columns.length === 0 && <span className="text-xs text-slate-400">-</span>}
                  </div>
                </td>
                <td className="px-4 py-2 text-emerald-600">
                  {Object.keys(t.update_columns_mapping ?? {}).length} configured
                </td>
                <td className="px-4 py-2 text-slate-600">{(t.attempt_columns ?? []).length} columns</td>
                <td className="px-4 py-2 text-slate-500">
                  {t.created_at ? new Date(t.created_at).toLocaleDateString() : "-"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {/* All three of these were wrong: two showed a cross and one showed
                        nothing at all, so the only way to tell edit from delete was to
                        press one. */}
                    <button
                      onClick={() => setEditingId(t._id)}
                      title="Edit this format"
                      className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <IconPencil size={15} />
                    </button>
                    <button
                      onClick={() => downloadTemplateJson(t)}
                      title="Download as JSON"
                      className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <IconDownload size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      title="Delete this format"
                      className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <IconTrash size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {templates.length === 0 ? "No templates yet." : "No templates match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DatasheetsSection({ templates }: { templates: DatasheetTemplate[] }) {
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { data: datasheets, isLoading } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasheetTemplateId, setDatasheetTemplateId] = useState("");
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const datasheetTemplateName = (id: string) => templates.find((t) => t._id === id)?.name || id;

  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: () => uploadDatasheet(name, datasheetTemplateId, file as File),
    onSuccess: (result) => {
      setName("");
      setFile(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["datasheets"] });
      queryClient.invalidateQueries({ queryKey: ["datasheetTemplates"] });
      setIsUploadOpen(false);
      // Say what was decided on their behalf, and warn about anything the script will
      // try to say that this file cannot fill.
      const note = [
        result.format_created
          ? `Made a format from this file: ${result.format_name}.`
          : `Used the ${result.format_name} format.`,
        result.placeholders_missing.length > 0
          ? `The script also says ${result.placeholders_missing.join(", ")}, which this file does not carry.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      setUploadNote(note);
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Upload failed.";
      setError(detail);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDatasheet(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasheets"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => renameDatasheet(id, newName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasheets"] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !file) return;
    setError(null);
    uploadMutation.mutate();
  };

  // A list was a name and a row count. Seeing the first rows is how you tell the right
  // file went up, and that the numbers in it look like numbers.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["datasheetPreview", previewId],
    queryFn: () => previewDatasheet(previewId!, 10),
    enabled: Boolean(previewId),
  });

  const handleRename = async (ds: Datasheet) => {
    const next = (await dialog.prompt("Rename datasheet", { defaultValue: ds.name }))?.trim();
    if (!next || next === ds.name) return;
    renameMutation.mutate({ id: ds._id, name: next });
  };

  // The file a client sends back into their own system: their columns as uploaded, then
  // the result of each call, then every attempt under its own numbered columns. Built on
  // the server - see downloadDatasheetCsv.
  const handleDownload = async (ds: Datasheet) => {
    try {
      await downloadDatasheetCsv(ds._id);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail;
      await dialog.confirm("Could not build the file", {
        body: detail || (err as Error).message,
        okLabel: "Close",
      });
    }
  };

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Your call lists</h2>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Upload List
        </button>
      </div>

      {isUploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsUploadOpen(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <CardHeader
              Icon={IconCloudUpload}
              accent="bg-blue-50 text-blue-600"
              title="Upload a datasheet"
              action={
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
            <IconX size={16} />
          </button>
              }
            />
            <div className="space-y-4 p-4">
              <p className="text-xs text-slate-400">
                The file's columns must include all of the Required Columns from the selected
                template, or the upload will be rejected.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Format
                  <select
                    value={datasheetTemplateId}
                    onChange={(e) => setDatasheetTemplateId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    {/* The default. Everything a format needs is already written down -
                        the columns in the file's header, the placeholders in the script -
                        so it is worked out rather than clicked together. */}
                    <option value="">Work it out from the file</option>
                    {templates.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-slate-600">
                  List name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="July leads batch 1"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-600">CSV or Excel file</span>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`mt-1 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
                    isDragging
                      ? "border-blue-400 bg-blue-50"
                      : file
                        ? "border-emerald-300 bg-emerald-50/50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <span className="text-slate-400">
                    {file ? <IconFile size={22} /> : <IconCloudUpload size={22} />}
                  </span>
                  {file ? (
                    <>
                      <span className="text-sm font-medium text-slate-800">{file.name}</span>
                      <span className="text-xs text-slate-400">
                        {(file.size / 1024).toFixed(1)} KB — click or drop to replace
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-slate-700">
                        Click to upload or drag and drop
                      </span>
                      <span className="text-xs text-slate-400">CSV, XLSX, or XLSM</span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xlsm"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={uploadMutation.isPending || !name.trim() || !file}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </button>
            </div>
          </form>
        </div>
      )}

      {uploadNote && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-2 text-xs text-slate-700">
          <span>{uploadNote}</span>
          <button
            onClick={() => setUploadNote(null)}
            className="shrink-0 text-slate-400 transition hover:text-slate-600"
          >
            <IconX size={13} />
          </button>
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-500">Loading datasheets...</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Template</th>
              <th className="px-4 py-2">Rows</th>
              <th className="px-4 py-2">Uploaded</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(datasheets ?? []).map((ds) => (
              <tr key={ds._id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-900">{ds.name}</td>
                <td className="px-4 py-2 text-slate-600">{datasheetTemplateName(ds.datasheet_template_id)}</td>
                <td className="px-4 py-2 text-slate-600">{ds.row_count}</td>
                <td className="px-4 py-2 text-slate-500">
                  {ds.created_at ? new Date(ds.created_at).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {/* The point of uploading a sheet is to call the people in it, so that
                        is the one action offered first rather than left two screens away. */}
                    <Link
                      to={`/campaigns?datasheet=${encodeURIComponent(ds._id)}`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-700"
                      title={`Start calling the ${ds.row_count} row${ds.row_count === 1 ? "" : "s"} in this sheet`}
                    >
                      <IconPhone size={12} />
                      Call these
                    </Link>
                    <button
                      onClick={() => setPreviewId(ds._id)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleRename(ds)}
                      disabled={renameMutation.isPending}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDownload(ds)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(ds._id)}
                      disabled={deleteMutation.isPending}
                      className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(datasheets ?? []).length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No datasheets uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {previewId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewId(null);
          }}
        >
          <div className="max-h-[80vh] w-full max-w-5xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {preview?.name ?? "Loading…"}
                </h3>
                {preview && (
                  <p className="text-xs text-slate-400">
                    First {preview.rows.length} of {preview.total_rows.toLocaleString("en-IN")}{" "}
                    row{preview.total_rows === 1 ? "" : "s"} · {preview.columns.length} columns
                  </p>
                )}
              </div>
              <button
                onClick={() => setPreviewId(null)}
                className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <IconX size={16} />
              </button>
            </div>
            <div className="max-h-[64vh] overflow-auto">
              {previewLoading && <p className="p-5 text-sm text-slate-400">Loading…</p>}
              {preview && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">#</th>
                      <th className="whitespace-nowrap px-3 py-2 font-semibold">Status</th>
                      {preview.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((r) => (
                      <tr key={r.row_index} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 text-slate-400">{r.row_index + 1}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="text-slate-500">{r.status || "—"}</span>
                          {r.disposition_code && (
                            <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                              {r.disposition_code}
                            </span>
                          )}
                        </td>
                        {preview.columns.map((c) => (
                          <td
                            key={c}
                            className="max-w-[16rem] truncate px-3 py-2 text-slate-700"
                            title={String(r.data[c] ?? "")}
                          >
                            {String(r.data[c] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_TABS = ["Your Lists", "List Formats", "Result Fields"] as const;
type PageTab = (typeof PAGE_TABS)[number];

export function DatasheetTemplates() {
  const { templates, isLoading } = useDatasheetTemplates();
  const { categories: mappingKeyCategories } = useMappingKeys();
  const availablePaths = useMemo(() => pathsFromCategories(mappingKeyCategories), [mappingKeyCategories]);
  const [activeTab, setActiveTab] = useState<PageTab>("Your Lists");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Call Lists</h1>
          <p className="mt-1 text-sm text-slate-500">
            The people to call, the shape their file comes in, and which call results get
            written back into it.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {PAGE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? "border-b-2 border-indigo-600 text-indigo-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      {activeTab === "Your Lists" && <DatasheetsSection templates={templates} />}

      {activeTab === "List Formats" && <TemplatesTab availablePaths={availablePaths} />}

      {activeTab === "Result Fields" && <MappingKeysTab />}
    </div>
  );
}

/**
 * What the format would be, before it is saved.
 *
 * The missing placeholders are the point of showing this at all: one the file cannot fill
 * is spoken to the customer as a gap in mid-sentence, and that is far better seen here
 * than heard on the first call.
 */
function PlanPreview({
  plan,
  onCancel,
  onCreate,
}: {
  plan: FormatPlan;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const blocked = !plan.script_configured;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {plan.filename} · {plan.rows} row{plan.rows === 1 ? "" : "s"}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {plan.use_case} · {plan.language}
            {plan.phone_column && ` · dialling from "${plan.phone_column}"`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={blocked}
            title={blocked ? "That language has no script configured" : undefined}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            Create this format
          </button>
        </div>
      </div>

      {blocked && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          This use case has no script for that language, so a call would have nothing to
          say. Add one under Templates first.
        </p>
      )}

      {plan.placeholders_missing.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs font-medium text-amber-800">
            {plan.placeholders_missing.length} placeholder
            {plan.placeholders_missing.length === 1 ? "" : "s"} the file cannot fill — the
            caller hears a gap where each one should be.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {plan.placeholders_missing.map((m) => (
              <span
                key={m}
                className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-amber-800"
              >
                {`{${m}}`}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <PlanColumn title={`Columns (${plan.required_columns.length})`}>
          {plan.required_columns.map((c) => (
            <Chip key={c} text={c} />
          ))}
        </PlanColumn>
        <PlanColumn title={`Script fills (${plan.placeholders_matched.length})`}>
          {plan.placeholders_matched.map((m) => (
            <Chip key={m.placeholder} text={`{${m.placeholder}} ← ${m.column}`} tone="emerald" />
          ))}
          {plan.placeholders_matched.length === 0 && (
            <span className="text-[11px] text-slate-400">Nothing matched.</span>
          )}
        </PlanColumn>
        <PlanColumn
          title={`Written back (${Object.keys(plan.update_columns_mapping).length})`}
          hint={`from ${plan.sampled_calls} calls`}
        >
          {Object.keys(plan.update_columns_mapping).map((c) => (
            <Chip key={c} text={c} />
          ))}
        </PlanColumn>
      </div>
    </div>
  );
}

function PlanColumn({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-600">
        {title}
        {hint && <span className="ml-1 font-normal text-slate-400">{hint}</span>}
      </div>
      <div className="mt-1.5 flex max-h-36 flex-wrap gap-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone?: "emerald" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        tone === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
      }`}
    >
      {text}
    </span>
  );
}
