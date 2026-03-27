# Context

Project context and status notes for PTA / Debrief.

---

**Status as of March 27 2026 — demo ready**

Core analyzer: working, tested, self-analyzes cleanly.
Dependency graph: live with OSV CVE flagging.
Signing: SHA-256 integrity block in DOSSIER + receipt.json per run.
Output structure: all artifacts consolidated under runs/<run-id>/.
ONEPAGER: CFO-facing, no file paths, under 3 min read.
Demo script: docs/DEMO_SCRIPT.md — 10 min live demo to M&A advisor.
Smoke test: passing.

Next milestone: first real demo to a human buyer.
Target: boutique M&A advisory firm, 1 live run on a repo they care about.

**Local dev:** `docker compose up -d` starts Postgres + Redis using the repo root `docker-compose.yml`. Point `DATABASE_URL` / `REDIS_URL` in `.env` at those services.

**Database:** Run `npm run db:push` with `DATABASE_URL` set (e.g. via `.env`) so newer columns/tables exist: `analyses.dependency_graph`, `analyses.api_surface`, `analyses.learner_report`, `analyses.input_type`, `projects.report_audience`, `projects.user_id`, `projects.last_run_at`, plus **`users`**, **`credit_transactions`**, and **`runs`** (run history for charts/diffs; **`runs.run_metadata`** JSONB defaults to `{}` for branch, commit, environment, flags, `input_type_detail`, `tauri_version`, etc.). Drizzle applies additive schema changes; take a backup before pushing if you are risk-averse.

---

**API Surface — Version A in progress**

Extracts HTTP endpoints, webhooks (inbound + outbound), WebSocket
connections from owned codebases. Adds API_SURFACE.md and
api_surface.json to run output. Open endpoints auto-flagged in
security posture section (LLM dossier prompt + deterministic appendix).
UI tab added to DebriefReport.

Version B (third-party OpenAPI/Postman spec input) locked as
next milestone after Version A ships.

---

**Learner Mode — added**

`--mode learner` on the analyzer CLI produces **LEARNER_REPORT.md** alongside
standard output. Eight sections, all personalized to the actual codebase — no generic advice.

Key sections:

- **What the AI Got Wrong:** scans for AI code generation failure
  patterns, explains in plain English
- **Stack Audit:** detects tools in use, flags overlap and overpaying,
  suggests cheaper/better alternatives with live-fetched pricing (HTTP snippets to vendor pages plus optional web search)
- **Your Next Move:** one concrete instruction, not a list

**UI toggle:** Pro Report / Learner Report on the home input screen; stored as `projects.report_audience`. The project debrief view shows both tabs when a learner report exists.

**Market:** AI-native non-engineer coders. Top-of-funnel for
enterprise buyers. Free or low-cost tier candidate.
**Distribution:** word of mouth in vibe-coding communities.

---

**Production architecture — locked March 2026**

**Input surface:** GitHub, local (dev / desktop), Replit, zip, deployed **URL surface** snapshot (headers + assets; flagged as surface-only), **audio** (Whisper → text workspace), pasted **text** / README, **Notion** public page (HTML strip), **GitLab** & **Bitbucket** https clones. All branches normalize to a **local directory** before the Python analyzer; ingest metadata is recorded on the analysis row (`input_type`) and in API responses.

**Ingest API:** `POST /api/ingest/analyze` (JSON body with discriminated `ingest`), `POST /api/ingest/analyze-upload` (multipart `file` + `kind` = `zip` | `audio`). Temp dirs are cleaned up after each analyzer process exits.

**Output surface:** Web UI (Vite + Express; Vite root `client/`), **Tauri** desktop shell (`client/src-tauri/`, `npm run desktop:dev`), **CLI**, **REST** API (`X-Api-Key`).

**Pricing (planned):** Stripe + credits — see `server/billing/stripe.ts`, `server/billing/credits.ts`. Toggle enforcement with `DEBRIEF_ENFORCE_CREDITS=1` only after Clerk + user rows back the balance.

**Auth (planned):** Clerk — `server/auth/clerk.ts`; set `CLERK_SECRET_KEY` when ready.

**Queue / cache (planned):** BullMQ + Redis — `server/queue/analyzer-queue.ts` (`REDIS_URL`, `DEBRIEF_USE_BULLMQ=1`). Content-hash cache — `server/cache/analysis-cache.ts`.

**Desktop:** Tauri 2, bundle id `com.debrief.app`, default window **1200×800**, **dragDropEnabled** on. Run backend (`npm run dev`) then `npm run desktop:dev` so `devUrl` loads `http://localhost:5000`.

**Audio:** `server/ingestion/audio_ingest.ts` uses OpenAI **Whisper**; learner reports get a top banner when `input_type` is `audio`.

**Integrations (stub):** `extensions/vscode/`, `.github/workflows/debrief-sample.yml`, `integrations/slack/`, `integrations/discord/`.

**Run history:** `runs` table + `GET /api/projects/:projectId/runs`, `GET .../runs/:runId`, `GET .../runs/:runId/diff/:prevRunId`. UI: History panel + DCI sparkline on project debrief; `?runId=` loads a specific run’s stored analysis.

**Primary mode:** Learner; Pro remains the upgrade path.

---

**Production pipeline — wired March 2026**

Ingestion router (`server/ingestion/ingest.ts`): all input types normalized to a local path. GitHub / GitLab / Bitbucket / Replit use `git clone --depth 1 --single-branch`; commit + branch recorded via `git-meta`; `ingest_manifest.json` on disk; temp dirs registered for cleanup. Zip uses **unzipper** + project-root detection (`package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`). URL ingest writes `surface_scan.md` + probes (robots, sitemap, common API paths); **audio** uses Whisper over `fetch` + `File`, `description.md` + `audio_manifest.json`; **text** / **Notion** → `description.md` where applicable.

Project **analyze** and **clone-analyze** run through `ingest()` then the existing Python pipeline on that directory (no duplicate clone in `runAnalysis`). **Redis** content-hash cache (`server/cache/run-cache.ts`): 24h TTL; hits skip the analyzer and reuse stored artifacts; `cache_hit` in `run_metadata`; UI banner “Returned from cache”. Each successful (non-cached) run inserts a **`runs`** row (metrics + `analysis_id` link). **`POST /api/ingest/audio`**: multipart → transcript + hash (optional `repoUrl` reserved for future job enqueue).

BullMQ worker file **`server/queue/analyzer-worker.ts`** is a stub until jobs are moved off the API process; queue remains **`server/queue/analyzer-queue.ts`**.

Planned but not fully landed in this commit: WebSocket job progress, `GET /api/jobs/:jobId`, Clerk/Stripe enforcement, Tauri tray animations — see repo issues / next sprint.
