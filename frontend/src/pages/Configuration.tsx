import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoNotCall } from "../components/DoNotCall";
import { VoiceProfilesCard } from "../components/VoiceProfiles";
import { IconPlus } from "../components/Icons";
import { getAppSettings, updateAppSettings } from "../api/endpoints";
import type { AppSettings } from "../api/types";

/**
 * The settings that belong to the work rather than to the deployment.
 *
 * A voice and its codes used to be typed into every script, in two editors that wrote the
 * same fields; the do-not-call register sat at the bottom of Settings between a provider
 * key and a timeout. Both are decisions about how calls are made - made once, used
 * everywhere - so they sit together here, and the next one is another tab rather than
 * another page.
 */
const TABS = [
  {
    key: "voices",
    label: "Voice Profiles",
    hint: "The voices scripts can speak with, kept in one place",
    newLabel: "New profile",
  },
  {
    key: "dnc",
    label: "Do Not Call",
    hint: "Numbers no call will reach, however it is placed",
    newLabel: "",
  },
] as const;

export function Configuration() {
  const [tab, setTab] = useState<string>(TABS[0].key);
  // The + in the header belongs to the tab showing; this is how it reaches that tab's form.
  const [newSignal, setNewSignal] = useState(0);
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "border-indigo-600 bg-white text-indigo-700 shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {active.newLabel && (
          <button
            onClick={() => setNewSignal((n) => n + 1)}
            title={active.newLabel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            <IconPlus size={14} />
            {active.newLabel}
          </button>
        )}
      </div>

      <p className="text-sm text-slate-500">{active.hint}.</p>

      {tab === "voices" && (
        <div className="space-y-4">
          <DefaultVoiceCard />
          <VoiceProfilesCard newProfileSignal={newSignal} />
        </div>
      )}
      {tab === "dnc" && <DoNotCall />}
    </div>
  );
}

/**
 * The voice used when a script names no profile and carries no voice of its own.
 *
 * It lived in Settings, under timings, which is three screens from the voices it is the
 * fallback for.
 */
function DefaultVoiceCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: getAppSettings });
  const [voice, setVoice] = useState("");

  useEffect(() => {
    if (data) setVoice(data.settings.tts_voice_id ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      updateAppSettings({ ...(data?.settings as AppSettings), tts_voice_id: voice }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const dirty = Boolean(data) && voice !== (data?.settings.tts_voice_id ?? "");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Default voice</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Spoken when a script names no profile and carries no voice of its own.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          placeholder="Voice id"
          className="h-9 w-full max-w-md rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
        />
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
