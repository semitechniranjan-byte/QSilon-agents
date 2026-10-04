# QSilon Voice Agent — Project Handover

**Everything a new session needs to know.** Supersedes `HANDOVER.txt` (12 Sep 2026), which
is kept only for history. Last updated: 27 September 2026.

---

## 1. What this is

An AI voice agent that places outbound calls in Hindi and English, holds a real
conversation with the customer, scores the outcome, and reports it.

- Main use case: **EMI collection** for an NBFC client (agent persona "Roshini", speaking
  for Bajaj Auto Credit). Also built: real estate, e-commerce delivery confirmation, salon.
- Live console: **https://www.qsilon.com**
- Company name is spelled **QSilon** (capital Q, capital S).

### Who uses it

| Role | Sees |
|---|---|
| admin (`qsilonadmin@gmail.com`) | everything, including full phone numbers |
| operator (`qsilonuser@gmail.com`) | no Templates / Agents / Settings; phone numbers masked |

Passwords are in Render's environment, never in this file or in chat.

---

## 2. How work gets done (process — read this first)

- **Code lives in `C:\Users\rupes\Documents\GitHub\niranjan mama`.**
  There is also `C:\Users\rupes\Documents\RESUME\niranjan mama` — that is NOT the project.
- **Claude commits. The user pushes.** Never push, never force-push.
- The user writes Hinglish; reply in Hinglish. Code, comments and commit messages in English.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Render auto-deploys `main` after the user pushes. The React app is built by the deploy
  (`frontend/dist` is git-ignored) and served by FastAPI.

### Things that must not be done

- **Never run `CallHandler.initialize()` against production** — it creates junk sessions in
  the client's Conversations list. Use `h.db.initialize()` for database work.
- **Never run the backend locally against the production Mongo.** Boot starts the retry
  sweeper, which will place real calls from a laptop.
- **Never delete production data without explicit consent**, and keep a JSON backup first.
- **Do not remove commit `744cfe8`** from history — it contains `vobiz_service.py`.
- Do not put API keys, passwords or customer numbers into documents or chat.
- **Shell heredocs in this environment collapse `\\` to `\`.** Patching Python through a
  bash heredoc silently fails to match. Use the Edit/Write tools for code with escapes.

---

## 3. Services in use

| Job | Provider | Notes |
|---|---|---|
| Telephony | **Vobiz** (India) | ₹0.45/min, 60-second pulse, one DID (₹600) |
| Speech to text | **Deepgram** nova-3 streaming | servers in Sacramento, California — no India region |
| Brain | **Gemini 3.5 flash-lite** (paid, Tier 1) | via Google's OpenAI-compatible endpoint |
| Backup brain | **Groq** `openai/gpt-oss-120b` | free tier is enough; it only runs on a hedge |
| Voice | **Cartesia** sonic-3 | US-hosted; plan decides how many calls can run at once |
| Database | **MongoDB Atlas**, db `voice_clone` | |
| Hosting | **Render**, Starter, Oregon | see below |

Also wired but unused: Twilio, Exotel, Plivo (`*_service.py` + their own WebSocket routes).

---

## 4. Hosting

### Today

Render, Starter plan, Oregon (0.5 vCPU), ~₹620/month. FastAPI serves both the API and the
built React console.

**Why Oregon and not Mumbai** — this was checked by measuring, and the first answer was
wrong. Deepgram is in California and Cartesia is in the US. A server in Mumbai would put
the ocean crossing in the *middle* of every turn (server→STT and server→TTS), instead of
once at the edge (phone→server). Mumbai would be roughly **200ms slower per turn**, not
faster. Only move to India if the STT and TTS move to India too.

Measured from India: Deepgram 270–290ms, Cartesia ~620ms to first byte, Gemini ~130ms.

### History

Render suspended the service in September for non-payment: RBI rules stop foreign cards
from being auto-charged for Indian customers. The user paid manually and it is running.

### Google Cloud (account exists, unused so far)

- Project `gen-lang-client-0975520793`, **₹28,694 of credit, expires 29 November 2026**.
- The credit **cannot pay for Gemini API in AI Studio** (Google's own rule). It can pay for
  Compute Engine, Google's TTS/STT and other Cloud services.
- India billing supports **UPI autopay and card e-mandate up to ₹15,000**, which is what
  makes it a fix for the suspension problem.
- If a move happens: **Compute Engine, `us-west1`, e2-medium (~₹2,650/mo) or e2-standard-2
  (~₹4,800/mo)**. A stopped VM costs almost nothing (Lightsail still charges when stopped,
  which is why Lightsail was dropped).
- Cloud Run and any serverless option are unsuitable: the app needs long-lived WebSockets,
  an always-on background sweeper, and exactly one instance.

---

## 5. Architecture

```
                        ┌──────────────────────────────┐
   Customer ───PSTN───► │  Vobiz  (telephony, India)   │
   (mobile)  ◄──────────│  number + audio stream       │
                        └───────┬──────────────┬───────┘
                   webhook      │              │  WebSocket (8kHz audio)
                   /webhooks/   │              │  /vobiz-stream
                   vobiz/answer ▼              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            FastAPI app  (api.py) — ONE instance               │
   │   REST API      WebSockets        Background                  │
   │   /sessions     /vobiz-stream     _retry_sweeper (5 min)      │
   │   /campaigns    /stream           run_campaign tasks          │
   │   /datasheets   /exotel-stream    boot: clear stale runs      │
   │   /reports      /plivo-stream                                 │
   │   /analytics                                                  │
   │   CallHandler (one per live call)   call_registry (memory)    │
   │   React console served from frontend/dist                     │
   └───┬─────────────┬─────────────┬─────────────┬────────────────┘
       ▼             ▼             ▼             ▼
   Deepgram      Gemini        Cartesia      MongoDB Atlas
   (hears)       (decides)     (speaks)      (remembers)
                 └─ Groq backup, started 0.5s in
```

### One call, step by step

1. `campaign_service` (or the Test Call page) calls `vobiz_service.make_call()` with an
   `answer_url` carrying the `session_id`.
2. Vobiz hits `/webhooks/vobiz/answer`; the app returns XML with a `<Stream>` pointing at
   `wss://…/vobiz-stream?session_id=…`.
3. The WebSocket opens, a `CallHandler` is built, the Deepgram stream opens, and the backup
   LLM's HTTPS connection is warmed during the greeting.
4. Greeting is spoken (first audio 130–176ms). `greeting_delay_seconds` (Settings) can hold
   it back if a carrier bridges audio late; default 0.
5. Each turn: caller speaks → energy gate → Deepgram (~300ms) → Gemini, **streamed** →
   each finished sentence is spoken by Cartesia as it lands → caller hears the reply.
6. Barge-in: interim transcripts trigger `_interrupt_playback`, which stops TTS.
7. On hangup: Gemini scores the call (~1.6s) — outcome code, promise date/time/amount,
   cooperation, summary — and writes it to `sessions`.
8. Outcomes in `SUPPRESS_ON_CODES` (wrong number, death, legal threat, fraud, suicide
   threat) add the number to the do-not-call list automatically.

### Bulk calling

```
Excel upload → datasheet → list format (built from the file's header + the script's
{VARIABLES}) → Auto Dialer run
   • only inside calling hours          • do-not-call checked before every dial
   • 5 at a time (semaphore)            • Pause / Resume / Stop / Rerun
   • unanswered → retry after a gap, up to max attempts
_retry_sweeper (every 5 min) picks up due retries and scheduled runs; anything that fell
due while the server was down runs on the next pass (the query is `<= now`).
```

---

## 6. Key files

| File | Holds |
|---|---|
| `api.py` | every HTTP + WebSocket endpoint, startup tasks, the retry sweeper |
| `call_handler.py` | one live call: audio, VAD, STT, LLM, streamed speaking, hangup, scoring |
| `campaign_service.py` | bulk runs, calling hours, retries, DND, disposition rules |
| `db_service.py` | every Mongo access |
| `stt_stream_service.py` | the Deepgram streaming socket |
| `tts_service.py` | Cartesia + the spoken-audio cache |
| `llm_service.py` | OpenAI-compatible chat client, streaming and non-streaming |
| `template_service.py` | resolves prompt/greeting/voice per use case + language |
| `datasheet_service.py` | Excel/CSV parsing, mapping |
| `vobiz_service.py` | Vobiz REST + AudioStream XML |
| `call_registry.py` | live calls in memory + the global concurrency semaphore |
| `frontend/src/pages/` | Dashboard, Campaigns (Auto Dialer), Sessions (Conversations), Calls (Test Call), Agents, Reports, Analytics, Templates, DatasheetTemplates (Call Lists), Settings, Login |

---

## 7. Database (MongoDB Atlas, `voice_clone`)

| Collection | Holds |
|---|---|
| `sessions` | one row per call: number, times, status, `disposition_code`, `model_data` (promise, summary), `interruption_count` |
| `conversations` | every line spoken, both sides, with timestamps |
| `campaigns`, `executions` | dialler runs, their counters, control state, schedule |
| `datasheets`, `datasheet_templates` | uploaded lists and their formats |
| `templates` | prompts, greetings, voices per use case + language |
| `dispositions` | outcome codes and labels (can be read out of the scripts) |
| `suppressions` | do-not-call numbers (unique index on the number) |
| `mapping_keys` | file column → script variable |
| `queuecalls`, `runqueuecalls`, `background_jobs` | queue and scoring jobs |
| `app_settings`, `agents` | settings and agent config |

---

## 8. Latency — the whole story

It started at **4810ms** per turn. Current measured: **688–845ms**, and the newest change
should bring it to roughly **400–500ms** (not yet confirmed on a real call).

What made the difference, in order:

1. **Gemini paid tier.** The free tier throttled at 10–15 requests/minute.
2. **The hedge race.** The backup model starts **0.5s** in, *alongside* the primary; first
   usable answer wins. Tried at 1.5s and turns went to 2107ms — **do not raise it**.
3. **Warming the backup's HTTPS connection during the greeting** (963ms → 467ms on the
   first hedge of a call).
4. **Cached audio for repeated lines** (Sept 27). Those turns now wait 0ms for TTS.
5. **Streaming the reply** (Sept 27). Each finished sentence is spoken while the rest is
   still being written — the single largest remaining win.

### What to look for in the logs

```
TURN [sid] streamed | CALLER WAITED 450ms (whole reply took 900ms) reply='...'
TTS-CACHE hit (41234 bytes): 'Pushti ke liye dhanyavaad...'
GREETING [sid] first audio 150ms, 600ms total
LLM [sid] primary silent past 0.5s; racing the backup
CONFIG: llm primary=... backup=... hedge=...
```

`CALLER WAITED` is the real number: start of the turn to the first audio of any piece of
the reply.

### Emergency switch

`LLM_STREAM_REPLIES=false` in Render's environment puts every reply back to being
generated in full and spoken in one piece.

### Things that are NOT latency levers

- Prompt size. Measured: 2992-char prompt → 1053ms; 237-char prompt → 968ms.
- Moving the server to India (see Hosting).

---

## 9. Costs

Per **talk-minute** (₹88/USD):

| Item | ₹/min |
|---|---:|
| Vobiz (call ₹0.69 + stream ₹0.29, effective) | 0.97 |
| Cartesia TTS | 1.42 |
| Deepgram STT | 0.65 |
| Gemini | 0.11 |
| Traffic | 0.02 |
| **Total** | **₹3.17** |

Fixed: Vobiz number ₹600/month + hosting ₹620/month (Render).

**The Vobiz finding (verified against 97 real calls):** the rate is ₹0.45/min but billing
is on a **60-second pulse** — 74.3 minutes of talk billed as 111 minutes (`₹0.45 × 111 =
₹49.95`, and the invoice said ₹50). Asking Vobiz for per-second billing is worth about
₹0.22/min.

Saving already banked: the audio cache removes roughly **₹0.45/min** of Cartesia.

A typical run: 100 leads ≈ 25 minutes of talk ≈ ₹335, ~73 real conversations.

---

## 10. What is built (feature list)

**Calling**
- Hindi/English agent, barge-in, silence nudges, graceful sign-off, hangup from the console
- Test Call: placeholders come from the script's `{VARIABLES}`; customer details fill in
- Per-use-case scripts, greetings and voices

**Auto Dialer** (was "Campaigns")
- Bulk runs, 5 at a time, Pause / Resume / Stop / Rerun
- Scheduled runs, auto-retry with gap and max attempts, calling hours
- Do-not-call list: by hand, imported from a file, or added automatically by the agent
- Per-use-case dispositions, read out of the scripts

**Call Lists** (was "Datasheets") — tabs: Your Lists / List Formats / Result Fields
- Excel/CSV upload, list format built from the file's header matched to script variables
- Format edit/delete, preview of the first 10 rows, automatic mapping-key discovery

**After the call**
- Every call scored by Gemini: outcome, promise date/time/amount, cooperation, summary
- Re-score a past execution

**Dashboard**
- Six outcome tiles with counts **and shares**, each opening the calls behind it
- Promises to chase: Overdue / Today / Tomorrow with a Call button per customer
- Date filter: 7 / 15 / 30 days / All time / Custom (kept in the URL); it drives calls,
  runs, answer rate and outcomes — the queue and promises stay live
- Full phone number for an admin, with a copy button

**Reports / Analytics / Conversations**
- CSV of 20 columns including the LLM summary; whole campaign or a single call; filters
- Outcome shares that add to exactly 100% with the denominator stated, languages, calls
  per day, promise rate
- Conversations table with filters, transcript view and one-click recall
- **Call everyone in a filtered list** (`POST /sessions/recall-batch`): opens from any
  outcome tile, rings one call per customer (repeats merged), skips do-not-call numbers,
  obeys calling hours, holds the same concurrency limit as a dialler run, shows progress
  and can be stopped. Runs are kept in memory, newest 20.

---

## 11. Settings and constants worth knowing

| Name | Value | Where |
|---|---|---|
| `LLM_HEDGE_AFTER_SECONDS` | 0.5 | `call_handler.py` — do not raise |
| `LLM_TOTAL_DEADLINE_SECONDS` | 4.0 | `call_handler.py` |
| `SPEAK_MIN_CHARS` / `SPEAK_SENTENCE_ENDS` | 12 / `.?!।` | streamed speaking |
| `LLM_STREAM_REPLIES` | true | `config.py` / env |
| `STT_MIN_CONFIDENCE`, `FILLER_MIN_CONFIDENCE` | 0.5, 0.5 | `call_handler.py` |
| `STT_TRUST_WITHOUT_ENERGY` | 0.9 | believes a very confident transcript |
| `NOISE_CALIBRATION_FRAMES`, `NOISE_FLOOR_MULTIPLIER` | 40, 3.0 | per-call noise floor |
| `RECOVERY_SPEECH_QUIET_SECONDS`, `RECOVERY_MAX_REARMS` | 1.2, 4 | interruption rescue |
| `ENDPOINTING_MS`, `UTTERANCE_END_MS` | 300, 1000 | Deepgram (1000 is its floor) |
| `MAX_CONCURRENT_CALLS` | 5 | the real ceiling on this instance |
| Calling hours | 9–21 | `campaign_service.py` — **see compliance below** |
| `DEFAULT_MAX_ATTEMPTS`, `DEFAULT_RETRY_GAP_HOURS` | 3, 4 | retries |
| TTS cache | 48 entries, lines ≤ 200 chars | `tts_service.py` |
| `DEEPGRAM_MODEL` | config default `nova-2`; production runs **nova-3** via env | verify in the boot log |

`/etc/secrets/.env` is loaded with `override=False`, so Render's dashboard variables win.

---

## 12. Compliance — needs action

RBI's circular of **12 August 2022** forbids recovery calls **before 8:00 and after
19:00**. The system's calling hours default to **9:00–21:00**, so collection calls between
19:00 and 21:00 break the rule. **Set the end hour to 19 in Settings.** Other use cases
(real estate, delivery, salon) are not recovery calls and are not covered.

---

## 13. Limits of the current design

- **Exactly one instance may run.** Live calls, running campaigns and their pause/stop
  state are in memory. Two copies would break them.
- **5 concurrent calls.** Cartesia's plan also caps this — roughly 4× its TTS concurrency.
  The plan the account is on has not been confirmed.
- **The retry sweeper lives in that one process.** Server down = no retries until it is up.
- Deepgram has no India endpoint (EU and Australia only).
- Hindi scripts exist for collections; **real_estate has no Hindi script**, and it needs
  COMPANY_NAME, PROJECT_NAME, APPROVED_PROPERTY_INFO, AGENT_CALLBACK_NUMBER columns.

---

## 14. Open items / next plan (agreed, not started)

| # | Work | Estimate |
|---|---|---|
| 1 | Barge-in and background noise: real VAD (Silero/WebRTC), per-call noise floor, ~200ms of continuous speech before stopping, ignore "haan/hmm/ji", ignore the agent's own echo, resume where cut | 3–5 days |
| 2 | Language-correct variables: typed template variables (amount/date/time) rendered per language — `5000` → "paanch hazaar rupaye", `2026-09-20` → "bees September"; type auto-detected from the Excel column; "how it will be said" preview | 3–4 days (Hindi+English), ~1 day per further language |
| 3 | Call-flow nodes in Templates — Level 1: a map generated from the prompt with failure paths (3–4 days). Level 2: a real node engine with per-node prompts, retries, fallbacks, node-level analytics and A/B (2–3 weeks) | see left |
| 4 | Start the LLM on an interim transcript (saves the 300ms endpointing wait) | 2 days |
| 5 | Cartesia WebSocket TTS with a pre-opened connection | 1–2 days |
| 6 | Deepgram keyterms ("EMI", "kist", "hazaar", names) + numerals | 2 hours |
| 7 | A latency page: p50/p95 per stage | 1 day |

Bigger product ideas discussed (not scheduled): pay-during-the-call (UPI link + live
confirmation), Promise Autopilot (auto-call on the promise date), ₹ recovery ROI dashboard,
best-time-to-call per customer, 100% call QA audit, script A/B testing, mid-call language
switch, hardship detection with handover to a human, context-aware inbound.

Also open: the client deck (`docs/`) still says LLM ₹0.03/min and total ₹3.10/min — both
stale — and still spells the name "Qsilon". Presentations are parked.

---

## 15. Mistakes already made (do not repeat)

- Raising the hedge window to 1.5s → 2107ms turns. Reverted to 0.5s.
- Adding "hello" to the filler list dropped a real caller's whole call.
- `update_model_data` replaced the whole object and wiped the analysis on 82 sessions.
  It now `$set`s field by field.
- A diagnostic `CallHandler.initialize()` and a boot path created 19 junk sessions in the
  client's list. Boot now passes `persist_session=False`.
- An `analysis_prompt` NameError in `_run_one_row` silently broke every bulk call for two
  weeks. Campaigns now record `last_error`, which is how it was found.
- Runtime-built Tailwind class names are never generated. Write literal classes.
- Percentages rounded line by line added up to 99. They are now rounded with largest
  remainder, to one decimal, with the denominator shown.
- The dashboard's outcome tiles were counted in the browser from the latest 200 calls.
  They now come from `/analytics/summary`, counted in the database.
- Session duration includes ringing; Vobiz's own `Duration` is the talk time. Comparing the
  wrong one produced a wrong conclusion about the billing pulse.

---

## 16. Working locally

```bash
# frontend: type-check + build (dist is git-ignored; Render builds it on deploy)
cd frontend && npm run build
npx oxlint src/...            # lint the files you touched

# backend: syntax check
.venv/Scripts/python.exe -m py_compile api.py call_handler.py llm_service.py tts_service.py

# read-only database work (safe): connect with pymongo using settings.MONGO_URI
# never boot the app locally against production
```

Tests written for the newest work (in the session scratchpad, not in the repo — worth
moving into a `tests/` folder): TTS cache replay/barge-in/eviction, and streamed replies
(pieces, hedge, backup winning, broken stream, barge-in, no-punctuation ending, switch off).

---

## 17. Recent commits (newest first)

```
21b4fff  Speak the reply while the model is still writing it
ea97361  Show an admin the whole phone number
44b2e2e  Keep the audio for lines the agent repeats
d0c231c  Spell the company name QSilon
c344912  Show each outcome as a share of the calls, on the dashboard tiles too
219aae3  Filter the dashboard by period: 7, 15 or 30 days, all time, or two dates
39d1422  Make outcome percentages add up to 100 and say what they are of
cf764a5  Write down what a new session needs to know
edd04ed  Let the greeting wait for the caller's audio to be joined
1aa1975  Believe a certain transcript even when the meter heard nothing
3d37bcf  Book a run for later instead of waiting to press the button
3ba94dd  Read the outcome list out of the scripts instead of keeping it by hand
446858c  Call the unanswered back, and only during hours calls are allowed
f92607f  Look inside an uploaded list, and give its format real buttons
5ef7b70  Build a list format from the file and the script together
57e67eb  Name the two sections after what they hold
b763fb2  Open the promise piles from the cards that count them
20142a4  Hang up a test call from the console
```

---

## 18. Right now — what the next session should pick up

1. The user still has to **push** the four newest commits.
2. After the push: **one test call**, then read the log for `CALLER WAITED` and
   `TTS-CACHE hit`. Expect ~400–500ms, down from 688–845ms. If the speech sounds choppy
   between sentences, raise `SPEAK_MIN_CHARS`.
3. Set the calling end hour to **19** (RBI).
4. Then item 1 of the plan: barge-in and background noise. That needs 10–15 real call
   recordings, including noisy ones.
