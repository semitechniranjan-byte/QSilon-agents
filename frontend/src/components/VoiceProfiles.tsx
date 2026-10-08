import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createVoiceProfile,
  deleteVoiceProfile,
  listVoiceProfiles,
  updateVoiceProfile,
  type VoiceProfile,
  type VoiceProfileInput,
} from "../api/endpoints";
import { useDialog } from "./Dialog";
import { IconPencil, IconSearch, IconTrash } from "./Icons";

/**
 * The voices, kept once.
 *
 * A voice and its two language codes used to be typed into every use case and every
 * language, in two editors that wrote the same fields - so changing a voice meant finding
 * every cell carrying it, and whichever editor was saved second quietly won. A profile is
 * that set of fields with a name on it; a script picks one, and changing it here changes
 * every script that picked it.
 */

const EMPTY_PROFILE: VoiceProfileInput = {
  name: "",
  language: "",
  stt_language: "",
  tts_language: "",
  tts_model_id: "sonic-3",
  tts_voice_id: "",
  description: "",
};

type Editing = { id: string | null; draft: VoiceProfileInput };

export function VoiceProfilesCard({ newProfileSignal = 0 }: { newProfileSignal?: number }) {
  const queryClient = useQueryClient();
  const dialog = useDialog();
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["voiceProfiles"],
    queryFn: listVoiceProfiles,
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // The page header's + button lives outside this card; this is how it reaches the form.
  useEffect(() => {
    if (newProfileSignal > 0) setEditing({ id: null, draft: { ...EMPTY_PROFILE } });
  }, [newProfileSignal]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["voiceProfiles"] });

  const saveProfile = async () => {
    if (!editing || !editing.draft.name.trim()) return;
    setSaving(true);
    try {
      if (editing.id) await updateVoiceProfile(editing.id, editing.draft);
      else await createVoiceProfile(editing.draft);
      setEditing(null);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const removeProfile = async (profile: VoiceProfile) => {
    const ok = await dialog.confirm(`Delete the "${profile.name}" voice?`, {
      body: "Scripts that chose it fall back to their own codes until another is picked.",
      danger: true,
    });
    if (!ok) return;
    await deleteVoiceProfile(profile._id);
    refresh();
  };

  const term = search.trim().toLowerCase();
  const shown = profiles.filter((p) =>
    [p.name, p.language, p.tts_model_id, p.tts_voice_id]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term)),
  );

  if (editing) {
    const set = (key: keyof VoiceProfileInput, value: string) =>
      setEditing({ ...editing, draft: { ...editing.draft, [key]: value } });

    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {editing.id ? "Edit profile" : "New profile"}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={saveProfile}
              disabled={saving || !editing.draft.name.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>

        <Section title="Profile overview">
          <Field label="Profile name" required>
            <input
              value={editing.draft.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Hindi — Roshini"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
            />
          </Field>
          <Field label="Language" hint="Which language this voice speaks">
            <input
              value={editing.draft.language ?? ""}
              onChange={(e) => set("language", e.target.value)}
              placeholder="hindi"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
            />
          </Field>
          <Field label="Description" hint="Optional — what this voice is for" wide>
            <input
              value={editing.draft.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Collections, female, warm"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm"
            />
          </Field>
        </Section>

        <Section title="Speaking">
          <Field label="Speech language code" hint="Format: hi, en, kn">
            <input
              value={editing.draft.tts_language ?? ""}
              onChange={(e) => set("tts_language", e.target.value)}
              placeholder="hi"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-sm"
            />
          </Field>
          <Field label="Voice model">
            <input
              value={editing.draft.tts_model_id ?? ""}
              onChange={(e) => set("tts_model_id", e.target.value)}
              placeholder="sonic-3"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-sm"
            />
          </Field>
          <Field label="Voice id" hint="Blank uses the default voice from Settings" wide>
            <input
              value={editing.draft.tts_voice_id ?? ""}
              onChange={(e) => set("tts_voice_id", e.target.value)}
              placeholder="47f3bbb1-e98f-4e0c-92c5-5f0325e1e206"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
            />
          </Field>
        </Section>

        <Section title="Listening" last>
          <Field label="Recognition language code" hint="What the caller is expected to speak">
            <input
              value={editing.draft.stt_language ?? ""}
              onChange={(e) => set("stt_language", e.target.value)}
              placeholder="hi"
              className="h-9 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-sm"
            />
          </Field>
        </Section>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <span className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <IconSearch size={14} />
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, language or voice"
            className="h-9 w-72 rounded-lg border border-slate-300 pl-9 pr-3 text-sm"
          />
        </span>
        <span className="text-xs text-slate-400">
          {profiles.length} profile{profiles.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Language</th>
              <th className="px-3 py-2.5 font-semibold">Speaks</th>
              <th className="px-3 py-2.5 font-semibold">Hears</th>
              <th className="px-3 py-2.5 font-semibold">Voice model</th>
              <th className="px-3 py-2.5 font-semibold">Voice</th>
              <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((p) => (
              <tr key={p._id} className="hover:bg-slate-50/60">
                <td className="px-5 py-2.5 font-medium text-slate-900">
                  {p.name}
                  {p.description && (
                    <div className="text-xs font-normal text-slate-400">{p.description}</div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{p.language || "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                  {p.tts_language || "—"}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                  {p.stt_language || "—"}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600">
                  {p.tts_model_id || "—"}
                </td>
                <td
                  className="max-w-[12rem] truncate px-3 py-2.5 font-mono text-xs text-slate-500"
                  title={p.tts_voice_id}
                >
                  {p.tts_voice_id || "default"}
                </td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center justify-end gap-3 text-xs font-medium">
                    <button
                      onClick={() =>
                        setEditing({
                          id: p._id,
                          draft: {
                            name: p.name,
                            language: p.language ?? "",
                            stt_language: p.stt_language ?? "",
                            tts_language: p.tts_language ?? "",
                            tts_model_id: p.tts_model_id ?? "",
                            tts_voice_id: p.tts_voice_id ?? "",
                            description: p.description ?? "",
                          },
                        })
                      }
                      className="inline-flex items-center gap-1.5 text-indigo-600 transition hover:text-indigo-800"
                    >
                      <IconPencil size={13} />
                      Edit
                    </button>
                    <button
                      onClick={() => removeProfile(p)}
                      className="inline-flex items-center gap-1.5 text-slate-500 transition hover:text-rose-600"
                    >
                      <IconTrash size={13} />
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">
                  {profiles.length === 0
                    ? "No voices yet. Add one and every script can pick it."
                    : `Nothing matches "${search}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  last = false,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? "" : "border-b border-slate-100"}>
      <div className="bg-slate-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block text-xs font-medium text-slate-600 ${wide ? "md:col-span-2" : ""}`}>
      {label}
      {required && <span className="ml-0.5 text-rose-500">*</span>}
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] font-normal text-slate-400">{hint}</span>}
    </label>
  );
}
