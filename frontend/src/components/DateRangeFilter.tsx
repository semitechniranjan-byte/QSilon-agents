/**
 * The period a page is counting: the last 7, 15 or 30 days, all time, or two dates.
 *
 * The choice lives in the address bar (?range=15, or ?range=custom&from=..&to=..) so a
 * reload keeps it and a link to the page carries it.
 */

/**
 * YYYY-MM-DD in the viewer's own calendar. toISOString gives the UTC date, which in India
 * is still yesterday until 5:30 in the morning.
 */
export function localDate(d: Date = new Date()): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

export const RANGE_PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: "7", label: "7 days", days: 7 },
  { key: "15", label: "15 days", days: 15 },
  { key: "30", label: "30 days", days: 30 },
  { key: "all", label: "All time", days: null },
];

export type RangeChoice = { preset: string; from?: string; to?: string };
/** What the server filters on - both ends inclusive, a missing end is open. */
export type DateWindow = { date_from?: string; date_to?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readRange(params: URLSearchParams): RangeChoice {
  const preset = params.get("range") ?? "all";
  if (preset === "custom") {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    return {
      preset,
      from: ISO_DATE.test(from) ? from : undefined,
      to: ISO_DATE.test(to) ? to : undefined,
    };
  }
  return { preset: RANGE_PRESETS.some((p) => p.key === preset) ? preset : "all" };
}

export function writeRange(params: URLSearchParams, choice: RangeChoice): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("from");
  next.delete("to");
  if (choice.preset === "all") next.delete("range");
  else next.set("range", choice.preset);
  if (choice.preset === "custom") {
    if (choice.from) next.set("from", choice.from);
    if (choice.to) next.set("to", choice.to);
  }
  return next;
}

/** "7 days" is today and the six before it; a preset runs up to now. */
export function resolveRange(choice: RangeChoice): DateWindow {
  if (choice.preset === "custom") {
    // Typed dates are not held to the picker's min/max, so a backwards pair is turned
    // round rather than asking the server for a period that cannot contain anything.
    const { from, to } = choice;
    return from && to && from > to ? { date_from: to, date_to: from } : { date_from: from, date_to: to };
  }
  const preset = RANGE_PRESETS.find((p) => p.key === choice.preset);
  return preset?.days ? { date_from: daysAgo(preset.days - 1) } : {};
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function describeRange(span: DateWindow): string {
  if (!span.date_from && !span.date_to) return "All time";
  const end = !span.date_to || span.date_to >= localDate() ? "today" : shortDate(span.date_to);
  return span.date_from ? `${shortDate(span.date_from)} – ${end}` : `Up to ${end}`;
}

/** The window as query-string pairs, for links into a filtered list. */
export function windowQuery(span: DateWindow): string {
  const params = new URLSearchParams();
  if (span.date_from) params.set("date_from", span.date_from);
  if (span.date_to) params.set("date_to", span.date_to);
  return params.toString();
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
}) {
  const today = localDate();
  const span = resolveRange(value);
  const options = [...RANGE_PRESETS, { key: "custom", label: "Custom", days: null }];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap rounded-lg border border-slate-200 p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() =>
              onChange(
                o.key === "custom"
                  ? // Opening Custom starts from the period already on screen.
                    { preset: "custom", from: span.date_from ?? daysAgo(6), to: span.date_to ?? today }
                  : { preset: o.key },
              )
            }
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              o.key === value.preset ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="date"
              value={value.from ?? ""}
              max={value.to || today}
              onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
              className="h-8 rounded-lg border border-slate-300 px-2 text-xs text-slate-700 transition focus:border-indigo-400 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="date"
              value={value.to ?? ""}
              min={value.from}
              max={today}
              onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
              className="h-8 rounded-lg border border-slate-300 px-2 text-xs text-slate-700 transition focus:border-indigo-400 focus:outline-none"
            />
          </label>
        </div>
      )}

      <p className="text-[11px] text-slate-400">{describeRange(span)}</p>
    </div>
  );
}
