import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  countFilteredRows,
  getDatasheetFields,
  type DatasheetField,
  type FilterRule,
  type RowFilterSpec,
} from "../api/endpoints";
import { IconPlus, IconX } from "./Icons";

/**
 * Who gets called out of an uploaded list.
 *
 * Every field and every value here is read out of the list itself - the client's columns
 * and whatever their calls wrote back. Nothing is hard-coded: a collections desk sees its
 * own outcome codes, a clinic sees "missed" and "attended", and neither needed anybody to
 * configure a vocabulary. The count underneath answers the only question that matters
 * before pressing start: of 20,000 rows, how many will actually be rung.
 */

const OPERATORS: { op: string; label: string; kinds: string[]; value: "one" | "many" | "range" | "none" }[] = [
  { op: "is", label: "is", kinds: ["text", "number", "date"], value: "one" },
  { op: "is_not", label: "is not", kinds: ["text", "number", "date"], value: "one" },
  { op: "in", label: "is any of", kinds: ["text", "number"], value: "many" },
  { op: "not_in", label: "is none of", kinds: ["text", "number"], value: "many" },
  { op: "contains", label: "contains", kinds: ["text"], value: "one" },
  { op: "not_contains", label: "does not contain", kinds: ["text"], value: "one" },
  { op: "lt", label: "is less than", kinds: ["number"], value: "one" },
  { op: "lte", label: "is at most", kinds: ["number"], value: "one" },
  { op: "gt", label: "is more than", kinds: ["number"], value: "one" },
  { op: "gte", label: "is at least", kinds: ["number"], value: "one" },
  { op: "between", label: "is between", kinds: ["number"], value: "range" },
  { op: "is_empty", label: "is empty", kinds: ["text", "number", "date"], value: "none" },
  { op: "is_not_empty", label: "is filled in", kinds: ["text", "number", "date"], value: "none" },
];

const operatorsFor = (kind: string) => OPERATORS.filter((o) => o.kinds.includes(kind));
const shapeOf = (op: string) => OPERATORS.find((o) => o.op === op)?.value ?? "one";

export function RowFilterBuilder({
  datasheetId,
  value,
  onChange,
}: {
  datasheetId: string;
  value: RowFilterSpec;
  onChange: (next: RowFilterSpec) => void;
}) {
  const { data: fieldData } = useQuery({
    queryKey: ["datasheetFields", datasheetId],
    queryFn: () => getDatasheetFields(datasheetId),
    enabled: Boolean(datasheetId),
  });
  const fields = fieldData?.fields ?? [];
  const fieldOf = (name: string): DatasheetField | undefined =>
    fields.find((f) => f.name === name);

  // The count is the point of the screen, so it follows the rules rather than waiting for
  // a button - but not on every keystroke.
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 400);
    return () => clearTimeout(timer);
  }, [value]);

  const { data: count, isFetching } = useQuery({
    queryKey: ["filterCount", datasheetId, JSON.stringify(settled)],
    queryFn: () => countFilteredRows(datasheetId, settled),
    enabled: Boolean(datasheetId),
  });

  const setRule = (index: number, patch: Partial<FilterRule>) =>
    onChange({
      ...value,
      rules: value.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    });

  const addRule = () => {
    const first = fields[0];
    if (!first) return;
    onChange({
      ...value,
      rules: [...value.rules, { field: first.name, op: operatorsFor(first.kind)[0].op, value: "" }],
    });
  };

  const removeRule = (index: number) =>
    onChange({ ...value, rules: value.rules.filter((_, i) => i !== index) });

  if (!datasheetId) {
    return <p className="text-xs text-slate-400">Pick a call list first.</p>;
  }

  return (
    <div className="space-y-3">
      {value.rules.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-slate-600">
          Call a row when
          <select
            value={value.match}
            onChange={(e) => onChange({ ...value, match: e.target.value as "all" | "any" })}
            className="h-8 rounded-lg border border-slate-300 px-2 text-xs"
          >
            <option value="all">every rule</option>
            <option value="any">any rule</option>
          </select>
          below is true.
        </div>
      )}

      {value.rules.map((rule, index) => {
        const field = fieldOf(rule.field);
        const kind = field?.kind ?? "text";
        const shape = shapeOf(rule.op);
        const options = field?.values ?? [];
        const chosen = Array.isArray(rule.value) ? rule.value.map(String) : [];
        return (
          <div key={index} className="flex flex-wrap items-start gap-2">
            <select
              value={rule.field}
              onChange={(e) => {
                const next = fieldOf(e.target.value);
                setRule(index, {
                  field: e.target.value,
                  op: operatorsFor(next?.kind ?? "text")[0].op,
                  value: "",
                });
              }}
              className="h-9 min-w-44 rounded-lg border border-slate-300 px-2 text-sm"
            >
              <optgroup label="From your file">
                {fields.filter((f) => f.source === "list").map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </optgroup>
              <optgroup label="From the calls">
                {fields.filter((f) => f.source === "call").map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </optgroup>
            </select>

            <select
              value={rule.op}
              onChange={(e) => setRule(index, { op: e.target.value, value: "" })}
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
            >
              {operatorsFor(kind).map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>

            {shape === "many" && options.length > 0 && (
              // The values the calls actually produced for this client, with how many rows
              // carry each - so an operator picks rather than types a code from memory.
              <div className="flex max-w-lg flex-wrap gap-1.5">
                {options.map((option) => {
                  const on = chosen.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        setRule(index, {
                          value: on
                            ? chosen.filter((v) => v !== option.value)
                            : [...chosen, option.value],
                        })
                      }
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        on
                          ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {option.value || "(empty)"}
                      <span className="ml-1 text-slate-400">{option.count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {shape === "many" && options.length === 0 && (
              <input
                value={Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value ?? "")}
                onChange={(e) =>
                  setRule(index, { value: e.target.value.split(",").map((v) => v.trim()) })
                }
                placeholder="value, value"
                className="h-9 w-56 rounded-lg border border-slate-300 px-2 text-sm"
              />
            )}

            {shape === "one" &&
              (options.length > 0 && kind === "text" ? (
                <select
                  value={String(rule.value ?? "")}
                  onChange={(e) => setRule(index, { value: e.target.value })}
                  className="h-9 min-w-40 rounded-lg border border-slate-300 px-2 text-sm"
                >
                  <option value="">choose…</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value || "(empty)"} ({o.count})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={String(rule.value ?? "")}
                  onChange={(e) => setRule(index, { value: e.target.value })}
                  type={kind === "number" ? "number" : "text"}
                  placeholder={kind === "number" ? "0" : "value"}
                  className="h-9 w-40 rounded-lg border border-slate-300 px-2 text-sm"
                />
              ))}

            {shape === "range" && (
              <div className="flex items-center gap-1.5">
                {[0, 1].map((side) => (
                  <input
                    key={side}
                    type="number"
                    value={String((Array.isArray(rule.value) ? rule.value[side] : "") ?? "")}
                    onChange={(e) => {
                      const pair = Array.isArray(rule.value) ? [...rule.value] : ["", ""];
                      pair[side] = e.target.value;
                      setRule(index, { value: pair });
                    }}
                    className="h-9 w-24 rounded-lg border border-slate-300 px-2 text-sm"
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => removeRule(index)}
              title="Remove this rule"
              className="mt-1 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
            >
              <IconX size={14} />
            </button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRule}
          disabled={fields.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        >
          <IconPlus size={12} />
          {value.rules.length === 0 ? "Add a rule" : "Add another rule"}
        </button>

        {count && (
          <span className="text-xs text-slate-600">
            <span className="font-semibold text-slate-900">
              {count.matching.toLocaleString("en-IN")}
            </span>{" "}
            of {count.total.toLocaleString("en-IN")} rows will be called
            {isFetching && <span className="ml-1 text-slate-400">…</span>}
            {count.matching === 0 && (
              <span className="ml-1 text-rose-600">— nothing matches these rules</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
