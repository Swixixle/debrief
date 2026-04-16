# Debrief — technical state report

**Generated:** 2026-04-13  
**Purpose:** Honest snapshot for product decisions — what exists, what runs end-to-end, what is stubbed, and what would block a demo.

---

## 1. What Debrief is

Debrief is a **codebase intelligence product** for people who shipped software (often with AI help) and need a **plain-language, evidence-backed picture of what they actually have**: behavior, dependencies, security surface (secrets, CVEs, exposed endpoints), and optional **tamper-evident receipts** tied to a time-based chain. It is aimed at **solo builders, small teams, and advisors** who want defensible summaries without manually reverse-engineering a repo — with **Learner**-oriented reporting as the primary voice and **Pro** as the denser, evidence-heavy variant.

---

## 2. Full file tree (annotated)

The repository has **433 tracked files** (`git ls-files`). Below: **root and major subtrees** with roles. Dense leaf directories are summarized; individual files in those dirs follow the same patterns (e.g. shadcn/Radix UI wrappers).

| Path | Role |
|------|------|
| **Root** | |
| `AGENTS.md` | Short agent/onboarding pointer for this repo. |
| `CHANGELOG.md` | Release-style changelog. |
| `CONTRIBUTING.md` | Contributor guidelines. |
| `Dockerfile` | Container image for app (see also `docker-compose.yml`). |
| `LICENSE` | MIT. |
| `Makefile` | Convenience targets. |
| `ONBOARDING.md` | Environment setup, first run. |
| `README.md` | Product overview, quickstart, known failure modes. |
| `RISKS_AND_GAPS.md` | Risk register and doc/ops gaps. |
| `docker-compose.yml` | Local Postgres + Redis (and related) for dev. |
| `drizzle.config.ts` | Drizzle Kit config → `shared/schema.ts`. |
| `package.json` / `package-lock.json` | Node workspace: scripts, deps, overrides. |
| `pyproject.toml` | Python package `debrief-analyzer`, deps, CLI entrypoints (`debrief`, legacy `pta`). |
| `render.yaml` | Render Blueprint: web service, worker, Redis, DB wiring. |
| `tsconfig.json` / `tsconfig.server.json` | TypeScript project boundaries. |
| `uv.lock` | Locked Python dependency versions (do not edit unless doing dependency work). |
| `vitest.config.ts` | Unit test runner config. |
| `.cursor/rules/debrief.mdc` | Cursor project rules (names, commands, constraints). |
| `.env.example` | Authoritative env var template. |
| `.gitignore` | Ignore rules. |
| `.replit` | Replit-oriented config stub. |
| **`client/`** | Vite + React SPA; Tauri shell under `src-tauri/`. |
| `client/components.json` | shadcn/ui config. |
| `client/index.html` | SPA entry HTML. |
| `client/package.json` | Client-only deps if split (see root for main install). |
| `client/postcss.config.js` / `tailwind.config.ts` / `vite.config.ts` | Frontend build. |
| `client/src/App.tsx` | Wouter routes → pages. |
| `client/src/main.tsx` | React root; optional `ClerkProvider` when publishable key present. |
| `client/src/index.css` | Global styles / Tailwind. |
| `client/src/components/` | Feature UI: `DebriefReport.tsx`, `ProgressPanel`, layout, education graph components, `ClerkNav`, `CreditBadge`, etc. |
| `client/src/components/ui/` | **Many files**: Radix-based primitives (button, dialog, tabs, …) — standard shadcn-style layer. |
| `client/src/components/education/` | Education Mode graph: nodes, edges, history panel, key health. |
| `client/src/contexts/DebriefApiKeyContext.tsx` | Browser `X-Api-Key` / open-web behavior. |
| `client/src/hooks/` | React Query hooks: projects, credits, toast, etc. |
| `client/src/lib/` | Utilities: `queryClient`, `clerkEnv`, `openWeb`, `portal`, `evidenceChainModel` client helpers. |
| `client/src/pages/` | **Screens:** `home`, `portal`, `project-list`, `project-details`, `project-progress`, `ci-feed`, `settings`, `billing`, `billing-success`, `targets`, `Timeline`, `EvidenceChain` (education), `not-found`. |
| `client/src/history/` / `client/src/historyDiff/` | Git history / hotspot diff helpers for report UI. |
| `client/src-tauri/` | Tauri 2 desktop: `Cargo.toml`, `tauri.conf.json`, icons — wraps same web UI. |
| `client/replit_integrations/audio/` | Voice streaming helpers (Replit-oriented). |
| **`server/`** | Express API, workers, ingestion, billing, chain, tests. |
| `server/index.ts` | HTTP server bootstrap: middleware order, CORS, Stripe webhook route, static/Vite, WS. |
| `server/routes.ts` | Main API surface: projects, ingest, CI, webhooks, jobs, education endpoints, admin helpers. |
| `server/routes/targets-chain.ts` | Scheduled targets + receipt chain REST. |
| `server/routes/api-keys.ts` | User API key CRUD (intended Clerk-gated). |
| `server/routes/api-v1.ts` | Versioned API surface with credit checks. |
| `server/config.ts` | Boot validation / config report. |
| `server/db.ts` | Drizzle DB client. |
| `server/storage.ts` | DB access for projects, analyses, runs, etc. |
| `server/static.ts` | Prod static SPA + dev Vite middleware. |
| `server/ws.ts` | WebSocket progress for queued jobs. |
| `server/runProjectAnalysis.ts` | **Core orchestration:** cache, spawn Python analyzer, persist artifacts. |
| `server/analyzer-worker-entry.ts` | Standalone BullMQ worker entry. |
| `server/ci-worker.ts` | CI job leasing, clone, analyzer for GitHub CI feed. |
| `server/scheduler.ts` | node-cron scheduler for chain targets (when enabled). |
| `server/receiptChainFinalize.ts` | Chain finalization after analysis. |
| `server/ingestion/` | Normalize all inputs to local dir: `ingest.ts`, `git-clone.ts`, `audio_ingest.ts`, etc. |
| `server/queue/` | `analyzer-queue.ts`, `analyzer-worker.ts`, job progress helpers. |
| `server/cache/run-cache.ts` | Content-hash cache for analyzer outputs. |
| `server/billing/` | `stripe.ts`, `credits.ts`, `webhook.ts`, `routes.ts`. |
| `server/auth/` | `api-keys.ts`, `clerk.ts` (helper only). |
| `server/middleware/` | `clerk.ts` (**stub**), `apiKeyAuth.ts`, `rateLimiter.ts`, `upsertUser.ts`. |
| `server/chain/` | Canonical receipt bytes, verify. |
| `server/claims/`, `server/diff/`, `server/canon/` | Dossier/diff/claims pipeline pieces. |
| `server/coverage/` | Test coverage scan integration. |
| `server/educationChainModel.ts` | Builds education graph model for a run. |
| `server/educationReceptionist.ts` | LLM “receptionist” for node explanations. |
| `server/buildHistory.ts` | Infer build tech history from run dir for education. |
| `server/keys/` | Access key + signing key generation and status copy for UI. |
| `server/replit_integrations/` | Image/audio/batch helpers for hosted environments. |
| `server/analyzer/` | **Python package** re-export + `analyzer_cli.py` shim. |
| `server/analyzer/src/` | Core Python: `analyzer.py`, `analyzer_cli.py`, `receipt_chain.py`, `core/*`, renderers. |
| `server/analyzer/tests/` | Pytest suite (contracts, receipt chain, graphs, etc.). |
| `server/analyzer/fixtures/` | Tiny repos and fixtures for tests. |
| `server/__tests__/` | Vitest tests (chain, worker security, education, evidence bundle, etc.). |
| **`shared/`** | Types and schemas shared by client and server. |
| `shared/schema.ts` | Drizzle tables (projects, runs, analyses, users, chain, CI, …). |
| `shared/routes.ts` | Shared API typing / client contract hints. |
| `shared/evidenceChainModel.ts` | Education graph model builder + history stages. |
| `shared/educationTopology.ts` | Topological ordering for education nodes. |
| `shared/models/chat.ts` | `conversations` / `messages` tables (chat persistence schema). |
| `shared/schemas/*.json` | JSON Schema for dossier, claims, coverage, howto, etc. |
| `shared/*.ts` | URL matchers, clone-analyze helpers, etc. |
| **`docs/`** | User and internal documentation. |
| `docs/ARCHITECTURE.md` | System design (CI, BullMQ, chain). |
| `docs/API.md`, `docs/DATA_MODEL.md`, `docs/RUNBOOK.md`, `docs/DEPLOYMENT.md`, `docs/CONFIGURATION.md`, … | Ops and API reference. |
| `docs/internal/` | Engineering notes: typecheck debt, security audit, process docs. |
| **`tests/`** | Cross-cutting fixtures (e.g. dossier JSON) used by tests. |
| **`scripts/`** | Build, smoke, security check scripts. |
| **`examples/`** | Sample outputs. |
| **`extensions/vscode/`** | VS Code extension stub. |
| **`integrations/`** | Slack/Discord stubs. |
| **`.github/`** | `dependabot.yml`, workflows, `debrief-action/` (GitHub Action template + bundled `dist`). |

**Note:** A literal line-by-line list of all 433 paths is available with `git ls-files`; the table above is the maintainable map of *where* things live.

---

## 3. Stack — dependencies (versions and purpose)

### Node (runtime & app) — from `package.json`

**Runtime / product**

| Package | Version (range) | Purpose |
|---------|-----------------|--------|
| `express` | ^5.0.1 | HTTP API |
| `drizzle-orm` | ^0.45.2 | Postgres ORM |
| `drizzle-zod` | ^0.8.3 | Zod integration for Drizzle |
| `pg` | ^8.20.0 | Postgres driver |
| `connect-pg-simple` | ^10.0.0 | Session store (Postgres) |
| `express-session` | ^1.18.1 | Sessions |
| `passport` / `passport-local` | ^0.7.0 / ^1.0.0 | Auth scaffolding (legacy/local) |
| `bullmq` | ^5.71.1 | Redis-backed job queue |
| `ioredis` | ^5.10.1 | Redis client |
| `node-cron` | ^3.0.3 | Scheduler ticks |
| `ws` | ^8.20.0 | WebSockets |
| `zod` | ^3.25.76 | Request/body validation |
| `ajv` | ^8.18.0 | JSON Schema validation |
| `openai` | ^6.33.0 | OpenAI SDK (server: receptionist, ingestion, etc.) |
| `@clerk/clerk-react` | ^5.61.4 | Browser Clerk components |
| `@clerk/express` | ^2.0.7 | Server Clerk (installed; **not wired** — see §10) |
| `stripe` | ^21.0.1 | Billing |
| `@stripe/stripe-js` | ^9.0.0 | Stripe.js (client) |
| `multer` | ^2.1.1 | Multipart uploads |
| `extract-zip` / `unzipper` | ^2.0.1 / ^0.12.3 | Archive handling |
| `nodemailer` | ^8.0.4 | SMTP alerts |
| `express-rate-limit` | ^8.3.1 | Rate limiting |
| `p-limit` / `p-retry` | ^7.x | Concurrency / retry |
| `yargs` | ^18.0.0 | Node CLI (`server/cli.ts`) |
| `date-fns` | ^4.1.0 | Date utilities |
| `memorystore` | ^1.6.7 | In-memory session fallback |

**React client**

| Package | Version | Purpose |
|---------|---------|--------|
| `react` / `react-dom` | ^19.2.4 | UI |
| `wouter` | ^3.3.5 | Routing |
| `@tanstack/react-query` | ^5.95.2 | Server state |
| `@xyflow/react` | ^12.10.2 | Education graph |
| `@dagrejs/dagre` | ^3.0.0 | Graph layout |
| `react-markdown` | ^10.1.0 | Render markdown reports |
| `framer-motion` | ^11.18.2 | Motion |
| `recharts` | ^3.8.1 | Charts (history/metrics) |
| `lucide-react` | ^0.577.0 | Icons |
| Radix UI packages (`@radix-ui/*`) | various ^1–2 | Accessible primitives |
| `class-variance-authority` / `clsx` / `tailwind-merge` | — | Styling utilities |
| `react-hook-form` / `@hookform/resolvers` | — | Forms |
| `cmdk` / `vaul` / `input-otp` / `embla-carousel-react` | — | Command palette, drawer, OTP, carousel |
| `next-themes` | ^0.4.6 | Theming |
| `@jridgewell/trace-mapping` | ^0.3.25 | Source map / trace |
| `@tauri-apps/api` | ^2.10.1 | Desktop bridge |

**Build / dev**

| Package | Version | Purpose |
|---------|---------|--------|
| `typescript` | ^5.9.3 | Types |
| `tsx` / `ts-node` | — | TS execution |
| `vite` / `@vitejs/plugin-react` | ^8 / ^6 | Bundler |
| `esbuild` | ^0.27.4 | Bundling in `scripts/build.ts` |
| `tailwindcss` / `@tailwindcss/vite` / `@tailwindcss/typography` | ^4.x | CSS |
| `vitest` / `@vitest/ui` | ^4.1.2 | Unit tests |
| `drizzle-kit` | ^0.31.10 | Migrations/push |
| `glob` | ^13.0.6 | Build scripts |
| `@tauri-apps/cli` | ^2.10.1 | Desktop builds |

**Optional**

| Package | Purpose |
|---------|--------|
| `bufferutil` | Optional WS perf |

### Python — from `pyproject.toml`

| Package | Constraint | Purpose |
|---------|------------|--------|
| `cryptography` | >=43.0.0 | Signing, crypto primitives |
| `gitpython` | >=3.1.46 | Git operations |
| `jsonschema` | >=4.26.0 | Schema validation |
| `openai` | >=2.21.0 | LLM calls in analyzer |
| `python-dotenv` | >=1.2.1 | Env loading |
| `rich` | >=14.3.2 | CLI UX (pulls Pygments — see security notes) |
| `typer` | >=0.23.1 | CLI framework |
| `pyyaml` | >=6.0.1 | YAML |

**Dev (optional extras):** `pytest`, `pytest-mock`.

Exact transitive versions are pinned in **`uv.lock`**.

---

## 4. What actually works right now (end-to-end)

These paths are **implemented and used in production-oriented flows** (subject to env: DB, Python, keys, optional Redis).

- **GitHub URL analyze (home):** Validate `github.com` URL → create project → analyze (sync) or **enqueue** with BullMQ when `DEBRIEF_USE_BULLMQ=1` + `REDIS_URL` + worker process → Python analyzer → artifacts persisted → **Debrief report** UI (`DebriefReport`).
- **Multi-ingest:** Zip upload, audio (Whisper), pasted/dropped text, Notion URL, GitLab/Bitbucket HTTPS, Replit URL path, URL surface scan, local path (when allowed) — routed through `server/ingestion/` → same analyzer pipeline.
- **Learner vs Pro:** `reportAudience` selects `--mode learner` vs default dossier path in Python; DB stores audience; UI toggles on home.
- **CI feed:** GitHub webhook → `ci_runs` / `ci_jobs` → worker clone + analyzer → `out/ci/<run_id>/` → `/ci` UI polling.
- **Evidence / receipt chain (when enabled):** `DEBRIEF_CHAIN_ENABLED`, `scheduled_targets`, `receipt_chain`, scheduler + BullMQ integration, verify/export APIs, timeline UI.
- **Content-hash cache:** Skips re-running analyzer for identical inputs (local mode path in `runProjectAnalysis`).
- **Web progress:** Job polling + **`/ws?jobId=`** progress events when using queue.
- **Education Mode (UI + data):** `/education/:runId/chain` loads merged model from DB chain + run; pipeline/history views; graph interactions; **receptionist** calls OpenAI when API key present.
- **Stripe webhook route:** `POST /api/billing/webhook` (raw body) for checkout completion — **credits accrue to `users` when metadata resolves** (meaningful when Clerk user IDs are real).
- **Open web mode:** `DEBRIEF_OPEN_WEB=1` bypasses shared `API_KEY` on browser-facing routes (still rate-limited) — matches `render.yaml` for public home.

---

## 5. What is stubbed or incomplete

- **Server Clerk integration:** `server/middleware/clerk.ts` sets **`clerkEnabled = false`** and **no-ops** `withClerk`, `requireClerkSession`, and `getAuth` (always `userId: null`). `@clerk/express` is not actually enforcing sessions on the API. Client may still show Clerk chrome if `VITE_CLERK_PUBLISHABLE_KEY` is set — **server does not trust it**.
- **Clerk-gated routes:** e.g. `POST /api/keys` uses `requireClerkSession` (no-op) + `getAuth` → **no real session**; API key issuance path is not production-safe until middleware is real.
- **Billing enforcement:** `DEBRIEF_BILLING_ACTIVE` defaults off; when off, `checkCredits` always returns OK; anonymous users never charged credits even when on (see `credits.ts`).
- **Cross-language canonical receipt parity:** Documented gap (R9 in `RISKS_AND_GAPS.md`) — Node vs Python canonical bytes should be integration-tested.
- **Large monorepos:** Timeouts / partial chunking — called out in `README.md`.
- **Tauri on Windows:** Not validated.
- **GitHub Action (`debrief-action`):** Template / thin; not positioned as complete product integration.
- **Integrations:** `extensions/vscode/`, `integrations/slack`, `integrations/discord` — stubs.
- **TypeScript CI:** `npm run check` does not fail CI; debt in `docs/internal/TYPECHECK_TODO.md`.
- **Some Vitest tests:** Skipped (`cliHelpSmoke`, `diffDossier`) or environment-sensitive (`coverage.test.ts` uses `git init` in `/tmp` — can fail in sandboxed CI).
- **Docs drift:** `docs/DEPLOYMENT.md` still has legacy hostnames in nginx examples (`pta.yourdomain.com`); product name in prose should stay **Debrief**.

---

## 6. The UI

| Route | Screen | Look & feel (high level) | What works |
|-------|--------|---------------------------|------------|
| `/` | Home | Centered marketing + **Learner/Pro** toggle; repo URL input; optional API key panel; examples; drag-drop zip/audio/text | GitHub submit, Replit detection, uploads, mic record, paste URL; queue progress panel when job enqueued |
| `/portal` | Portal | Brief “Redirecting…” screen | **Immediate client redirect** to `/` (stable shared entry URL) |
| `/projects` | Project list | Lists debrief projects | Load, navigate to detail |
| `/projects/:id` | Project detail | **DebriefReport**: markdown dossier, claims, dependency graph, API surface tab, learner tab, history/diff affordances, link to Education | Core reading + run selection; evidence tabs when data exists |
| `/projects/:id/progress` | Progress | Progress / polling / WS | Shown for long runs |
| `/ci` | CI feed | Table/cards of CI runs | Polls CI API |
| `/settings` | Settings | Keys, preferences | Partially tied to Clerk/API key story |
| `/billing` | Billing | Stripe checkout entry | UI exists; meaningful when Stripe + user IDs aligned |
| `/billing/success` | Success | Post-checkout | Redirect target |
| `/targets` | Targets | Scheduled target management | CRUD against chain APIs (auth: API key / open web per deploy) |
| `/timeline/:targetId` | Timeline | Chain visualization | Fetches chain endpoints |
| `/education/:runId/chain` | Education Mode | **React Flow** graph, history mode, key health panel, receptionist tabs | Graph + fetch model + receptionist (needs OpenAI + auth mode allowing `/api/education/receptionist`) |
| `*` | Not found | 404 | — |

**Layout:** Shared `Layout` with nav; **ClerkNav** only renders when publishable key exists; **CreditBadge** reflects billing state client-side.

---

## 7. The analysis pipeline (repo URL submit)

**Typical path: Home → GitHub URL**

1. **Client** validates **github.com** only for the main field; normalizes to `https://github.com/owner/repo`.
2. **Create project** (`POST /api/projects` or equivalent in `use-projects`): persists project row (`mode: github`, URL, `reportAudience`).
3. If **BullMQ** active: returns **202** with `jobId`; worker consumes job. Else: synchronous analyze trigger.
4. **Ingestion (worker or server):** For GitHub, clone (depth 1, branch) into temp workspace — details in `server/ingestion/` + `runProjectAnalysis`.
5. **Cache:** For `local` path mode, **content hash** may short-circuit and clone prior artifacts (GitHub flow uses ingest temp path; cache behavior is keyed accordingly in `runProjectAnalysis`).
6. **Python:** `python -m server.analyzer.analyzer_cli analyze <path> --output-dir … [--mode learner] [--target-id …]` with env e.g. `DEBRIEF_ANALYZER_MODEL`, chain vars.
7. **Analyzer (Python)** — two layers per `docs/ARCHITECTURE.md`:
   - **Deterministic:** file index, patterns, evidence, snippets with hashes, TruffleHog secrets scan, dependency graph, API surface extraction, receipts.
   - **Semantic (LLM):** if API key present — dossier narrative, risk/integration interpretation; **disabled** with `--no-llm` (CI may still run LLM if keys present).
8. **Artifacts:** Under `out/<projectId>/runs/<run-id>/` (resolved via `getLatestAnalyzerRunDir`): at minimum **`operate.json`, `DOSSIER.md`, `claims.json`**; optional **`LEARNER_REPORT.md`, `dependency_graph.json`, `api_surface.json`, `coverage.json`, `target_howto.json`, secrets JSON, receipt chain files**, etc.
9. **Persist:** `storage.createAnalysis` + `insertRun` + project status **completed**; optional **chain finalization** if `chainContext` provided.
10. **Client** navigates to `/projects/:id` and renders stored markdown/JSON.

**AI models**

- **Analyzer default model:** `gpt-4.1` (`DEFAULT_LLM_MODEL` / CLI `--model` / env `DEBRIEF_ANALYZER_MODEL`).
- **Audio:** OpenAI **Whisper** transcription (`server/ingestion/audio_ingest.ts`).
- **Education receptionist:** OpenAI chat + **second-pass “quality” rewrite** (`server/educationReceptionist.ts`).

---

## 8. Education Mode

**What it is:** A **teaching view** that situates a single debrief **run** inside Debrief’s **evidence chain** and infrastructure — cognitive graph of nodes (analyzer, receipts, storage, exports, queue, etc.) with states and anomalies.

**What it does**

- Fetches **`GET /api/runs/:runId/education/chain`** → `getEducationChainModelForRun` loads **run**, **project**, optional **scheduled target**, **receipt_chain** rows, verifies ordering, reads optional **`secrets_scan.json`**, infers **build history**, merges **key health** statuses for env/config.
- **Shared model** built in `shared/evidenceChainModel.ts` (roles, layers, history stages).
- **UI:** `client/src/pages/EvidenceChain.tsx` — React Flow, two **education modes:**
  - **Pipeline** — animated flow through the system.
  - **History (“How it grew”)** — narrative stages with construction ordering.

**How it works (data):** Mostly **read-only** over existing DB + disk artifacts; highlights nodes based on verification results and run state (`minimal` graph when no target/chain rows).

---

## 9. The Receptionist AI

**What it is:** A **small OpenAI-powered explainer** for a **selected graph node** in Education Mode — tuned for **non-expert** readers (9th–10th grade, define jargon).

**Four modes** (tabs in UI; `z.enum` in API)

| Mode | Intent |
|------|--------|
| **Explain** | Up to 3 sentences: what this node is, why it exists, “so what?” |
| **Other Ways** | Alternative architectural patterns **without** saying “you should switch” |
| **Suggestions** | Only if anomalies warrant; otherwise exact “nothing to change” message |
| **Keep It** | Direct reassurance or risk call — **no hedging** |

**How it works**

- **POST `/api/education/receptionist`** with `nodeId`, `mode`, `nodeContext`, `runId`.
- Server **`runReceptionist`**: builds prompt from `educationReceptionist.ts` (special case for **exposed secrets** state), calls OpenAI, then **`qualityPass`** second call to enforce readability rules.
- **Caching:** In-memory `Map` keyed by `runId|nodeId|mode`.
- **Requirements:** OpenAI API key on server; user must be allowed to call API (`X-Api-Key` or **`DEBRIEF_OPEN_WEB=1`**).

**Known limitation:** README notes QC can **over-strip** valid technical terms (“hedges”) — product risk for demos.

---

## 10. Authentication

**Clerk (intended)**

- **Client:** `ClerkProvider` when `VITE_CLERK_PUBLISHABLE_KEY` / `clerkPublishableKey()` resolves — Sign-in, `UserButton`, `ClerkNav`.
- **Server:** **`server/middleware/clerk.ts` is a deliberate stub** — `clerkEnabled === false`, no JWT validation, **`getAuth` always `userId: null`**.
- **`upsertUserMiddleware`:** No-ops when Clerk disabled.
- **`apiKeyAuth`:** Resolves **`Bearer dk_...`** keys to `users` row — **works independently of Clerk**.

**What’s gated**

- **Broad API protection:** `requireAuth` in `server/routes.ts` — if **`DEBRIEF_OPEN_WEB=1`**, passes; else requires **`API_KEY`** via `X-Api-Key` (production requires `API_KEY` set).
- **Clerk-specific routes** (e.g. `/api/keys`, billing session): **not truly gated** until real `@clerk/express` (or equivalent) replaces the stub.

---

## 11. Billing

**Stripe**

- **Env:** `STRIPE_SECRET_KEY`, webhook `STRIPE_WEBHOOK_SECRET`, publishable keys for client, price IDs `STRIPE_PRICE_*`.
- **Code:** `server/billing/stripe.ts` (client + pack mapping), `server/billing/routes.ts` (checkout), `server/billing/webhook.ts` (credit grants).

**`DEBRIEF_BILLING_ACTIVE`**

- Defined as **`process.env.DEBRIEF_BILLING_ACTIVE === "1"`** in `stripe.ts` / used by `credits.ts`.

| Flag | Behavior |
|------|----------|
| **Off (default / `render.yaml` uses `"0"`)** | `checkCredits` **always** `{ ok: true }` — **no deduction**; refunds no-op; Stripe UI may still be reachable but **not enforced**. |
| **On (`1`)** | Authenticated **`clerkUserId`** required for real deduction path; DB **atomic decrement** with balance check; failed balance → **checkout URL**; **`refundCredits`** on failure paths when wired; anonymous users still **bypass** (comment: extend with Redis session). |

**Credit costs (code):** `CREDIT_COSTS` — learner **1**, pro **5**, audio_only **1**, surface_scan **1**.

---

## 12. Tests

### Vitest (`npm run test:unit`)

- **~16 files** under `server/__tests__/` (plus `history.diff.spec.ts` imports client modules).
- **~87–92** `it/test` cases total (exact count shifts with skips); recent run: **80 passed, 6 skipped, 1 failed** in a sandboxed environment (`coverage.test.ts` **git init** restriction).
- **Coverage:** config boot, CI worker containment/security, evidence bundle crypto, receipt chain ordering (TS), education model + receptionist (mocked OpenAI), monitor drift, workspace paths, diff helpers, history git/scaffold, etc.

### Python (`pytest server/analyzer/tests/`)

- **11 test modules**; **~100** `test_*` functions collected (per-file counts in the 1–27 range).
- **Coverage:** analyzer core behaviors, operate/schema contracts, receipt chain, dependency graph, circular evidence, TruffleHog wiring, demo mode, normalization, audit blocks.

### How to run

```bash
npm run build && npm run test:unit
pytest server/analyzer/tests/
```

---

## 13. Deployment

**Where:** **`render.yaml`** defines **Render** services: **`debrief-api`** (web), **`debrief-worker`**, **`debrief-redis`**, **`debrief-db`**. README “Live” URL placeholder — **verify actual production URL** in hosting dashboard / GitHub About.

**Required / typical env (minimum viable)**

- **`DATABASE_URL`** — Postgres.
- **`npm run db:push`** after schema changes.
- **Node build:** `pip install -e .` + `npm install` + `npm run build` (as in Render build command).
- **`PYTHON_EXEC_PATH`** — must resolve on host (Render notes in yaml).
- **Production:** `NODE_ENV=production`, **`PORT`**, **`APP_URL`** (Stripe redirects, links).

**Queue / scale-out**

- **`REDIS_URL`**, **`DEBRIEF_USE_BULLMQ=1`**, worker **`DEBRIEF_RUN_ANALYZER_WORKER=1`** on separate process (`node dist/worker.cjs`).

**Chain / scheduler**

- **`DEBRIEF_CHAIN_ENABLED`**, optional **`DEBRIEF_SCHEDULER_ENABLED`**, **`PTA_CHAIN_STATE_DIR`**, signing keys per `.env.example`.

**Public browser**

- **`DEBRIEF_OPEN_WEB=1`** + **`VITE_DEBRIEF_OPEN_WEB=true`** (as in `render.yaml`).

**CORS**

- **`ALLOWED_ORIGINS`** comma list for production browser origins — **unset → warning + blocked cross-origin** (see `server/index.ts`).

**Secrets group**

- Render **`debrief-secrets`** env group referenced in yaml — OpenAI, Clerk, Stripe, signing keys, etc.

---

## 14. Known issues and gaps (consolidated)

- **Clerk stub on server** — biggest auth gap for multi-tenant product.
- **Billing inactive by default**; anonymous bypass when active; no Redis session limits for anon.
- **Education receptionist QC** may damage technical precision.
- **Monorepo / timeout** scaling incomplete.
- **Pygments transitive CVE** (via `rich`) — tracked in risk register.
- **Nodemailer path** not fully smoke-tested against real SMTP.
- **TS errors non-blocking** in CI.
- **Python analyzer** large surface area with **thin** tests on full LLM/dossier paths (R7).
- **Documentation / nginx examples** still mention legacy PTA hostnames in places.
- **Cross-runtime receipt canonicalization** test gap (R9).
- **Dependabot / lockfiles** — project rule: do not casually edit `package-lock.json` / `uv.lock`.

---

## 15. What would make it demo-ready (minimum)

This repo’s **`docs/CONTEXT.md`** already claimed “demo ready” for core analyzer; for a **credible external demo**, prioritize:

1. **One stable hosted URL** with `ALLOWED_ORIGINS` correct and **`DEBRIEF_OPEN_WEB`** decision explicit (public vs key).
2. **Secrets env group** complete: **`DATABASE_URL`**, **`OPENAI_API_KEY`**, Redis if queue, Python on path, **`npm run db:push`** applied.
3. **Worker + Redis** if demos use concurrent or long analyses — avoid blocking API.
4. **Pick a medium-sized public repo** that finishes under timeout; avoid >500-file monorepo unless you pre-check.
5. **Rehearse Education Mode** with a run that has **chain rows** (scheduled target) if you want the full graph; otherwise expect **minimal** education graph — set expectations.
6. **Receptionist:** verify OpenAI key and **spot-check** tab output for jargon stripping.
7. **Clerk + billing:** either **hide** Sign in / Billing in demo **or** finish real `@clerk/express` middleware before claiming “accounts work.”
8. **Stripe:** keep **`DEBRIEF_BILLING_ACTIVE=0`** until checkout + webhook + user linkage are validated end-to-end.

---

*This document is a point-in-time engineering snapshot; when behavior changes, update it or replace with a fresh audit.*
