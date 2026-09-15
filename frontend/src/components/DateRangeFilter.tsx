import {
  RANGE_PRESETS,
  daysAgo,
  describeRange,
  localDate,
  resolveRange,
  type RangeChoice,
} from "./dateRange";

/** Preset buttons for the period on the page, with two date boxes behind "Custom". */
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
