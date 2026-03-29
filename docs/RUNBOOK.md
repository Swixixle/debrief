# Operations runbook — Debrief

Last updated: 2026-03-28

This runbook matches the current Express + React + Postgres + optional Redis/BullMQ + Python analyzer layout.

---

## 1. Health checks

| Check | Endpoint / command | Notes |
|-------|---------------------|--------|
| Liveness + DB ping | `GET /health` | Returns `{ ok, db, uptime }`. Rate-limited (30/min). Good for load balancers. |
| Deep health | `GET /api/health` | Returns `status`: `healthy` \| `degraded` \| `unhealthy` and `checks`. In **production** with `API_KEY` set, detailed fields (analyzer path, CI worker counts, disk) require a valid `X-Api-Key` header; without it you still get basic checks. **503** when checks contain errors. |
| CI subsystem | `GET /api/ci/health` | CI/worker-oriented status (used in some docker examples). |
| Scheduler snapshot | `GET /api/scheduler/status` | **Admin-gated** via `requireDevAdmin` (see `server/routes/targets-chain.ts`): not a public probe. Returns `targets[]` with `missed`, `lastRunAt`, `chainLength`, etc. Use after auth as the app expects. |
| Chain integrity (API) | `GET /api/targets/:targetId/chain/verify` | Verifies **database** `receipt_chain` rows via `verifyChainRowsOrdered`. Requires same auth/rate-limit rules as other target routes. |
| Chain integrity (filesystem) | `debrief verify-chain <target_id> [--json]` | Python CLI against `PTA_CHAIN_STATE_DIR` / `out/chain_state` JSON receipts; exit `0` if intact, `1` if broken (with `--json` for automation). |

**Suggested production sequence:** `GET /health` → if OK, `GET /api/health` with API key → spot-check `/api/targets/.../chain/verify` for a known target after deploy.

---

## 2. Common failures and first response

### 2.1 Analyzer job stuck (BullMQ path)

**Symptoms:** UI or logs show analysis queued; worker not progressing; Redis connected but job idle.

** Preconditions:** `DEBRIEF_USE_BULLMQ=1`, `REDIS_URL` set, worker process running (`DEBRIEF_RUN_ANALYZER_WORKER=1` on worker, often `0` on API).

**Checks:**

1. Logs prefixed `[analyzer-worker]` or `[scheduler]` / `broadcastJobProgress`.
2. Confirm worker entry: `server/analyzer-worker-entry.ts` → queue name **`debrief-analyzer`** (`server/queue/analyzer-queue.ts`).
3. Stalled jobs: use **Redis/BullMQ tooling** (e.g. Redis CLI, or a Bull Board if you add one — not bundled). Inspect keys for `bull:debrief-analyzer:*`. Failed jobs retry up to **3** times with exponential backoff (`defaultJobOptions`).

Redis is free-tier (25MB cap, no persistence). If jobs are disappearing on restart, this is expected — free Redis does not persist. Upgrade tier before relying on job recovery across deploys.

**Mitigation:** Restart worker after fixing root cause (Python crash, disk, env). For poison messages, remove or fail the specific job ID in Redis-aware tooling; avoid blindly flushing Redis in production.

**Note:** **GitHub CI jobs** use a **separate** poll loop in `server/ci-worker.ts` (not BullMQ). Stuck CI: see `/api/ci/health`, job lease expiry (~5 min), `CI_PRESERVE_WORKDIR` for debug.

### 2.2 Scheduled run missed

**Detection:**

- **`GET /api/scheduler/status`** → `missed: true` when `lastRunAt` is older than ~1.5× interval (`server/scheduler.ts`).
- **Gap receipts:** scheduler calls Python `record-gap` then `finalizeGapReceipt` (`recordGapPython`).
- **UI:** Timeline for target (`/timeline/:targetId`) shows chain history.

**Catch-up:** On scheduler start, targets with no/fresh `lastRunAt` get `enqueueForTarget(..., catchUp=true)`. Manually trigger analysis: enqueue via app UI (new debrief) or POST flows that add a Bull job with `chainContext` (`server/routes/targets-chain.ts`).

**Config:** `DEBRIEF_SCHEDULER_ENABLED=true`, `DEBRIEF_CHAIN_ENABLED=true`, BullMQ + Redis available; cron uses `DEBRIEF_SCHEDULER_TIMEZONE` (default UTC).

### 2.3 SMTP alert not firing

**Code path:** `server/alertDispatch.ts` → `sendAnomalyEmail`.

**Checks:**

1. Env: `SMTP_HOST` required; without it logs **`[alert] SMTP_HOST not set — skipping email`**.
2. `SMTP_PORT` (default 587), optional `SMTP_USER` / `SMTP_PASS`, `SMTP_FROM`.
3. Nodemailer **8.x** transport: verify TLS and credentials with a one-off script or staging send.

**Logs:** Lines prefixed **`[alert]`** (failures, webhook non-2xx).

### 2.4 Chain verification failure

**On-disk receipts (Python):**

```bash
debrief verify-chain <TARGET_UUID> --json
# or: python -m server.analyzer.src.analyzer_cli verify-chain <TARGET_UUID> --json
```

Inspect `chain_intact`, `broken_at_sequence`, `broken_reason`, `signature_failures` in JSON.

**Database mirror:**

`GET /api/targets/:targetId/chain/verify` — reflects `receipt_chain` table ordering and hashes, not necessarily every filesystem edge case.

**Export:** `GET /api/targets/:targetId/chain/export` — downloadable bundle for offline review.

### 2.5 Render / static deploy issues

**Symptoms:** 404 on client routes, blank UI, MIME errors.

**Checks:**

1. `npm run build` produces `dist/index.cjs`, `dist/worker.cjs`, and **`dist/public`** (Vite output). Production server serves SPA from `dist/public` (`server/static.ts` path logic).
2. **Environment:** `NODE_ENV=production`, `DATABASE_URL`, required secrets, `ALLOWED_ORIGINS` if browser and API differ.
3. **Worker:** If using BullMQ, ensure a **second** Render service (or dyno) runs the worker entry with `REDIS_URL` and worker env flags.

4. **Key auto-generation:** `ensureSigningKeys()` and `ensureAccessKeys()` run only in the API process (`dist/index.cjs`), not the worker (`dist/worker.cjs`). In production, always set `DEBRIEF_CHAIN_SIGNING_PRIVATE_KEY`, `DEBRIEF_CHAIN_SIGNING_PUBLIC_KEY`, `API_KEY`, and `ADMIN_KEY` explicitly in your platform environment (Render env group: **debrief-secrets**). Do not rely on auto-generation in the worker process.

---

## 3. Logs and levels

- **Where:** stdout/stderr (container logs on Render, `docker logs`, local terminal).
- **`LOG_LEVEL`:** Referenced in `.env.example` (e.g. `info`); underlying loggers vary by subsystem.
- **Prefixes to grep:**
  - **`[SECURITY]`** — CORS / production config (e.g. missing `ALLOWED_ORIGINS`).
  - **`[scheduler]`** — cron tick, gap recording, enqueue failures.
  - **`[redis:`** / **`[analyzer-worker]`** — BullMQ/Redis connectivity.
  - **`[alert]`** — SMTP/webhook anomaly dispatch.
  - **`[FATAL]`** — uncaught exceptions / unhandled rejections in `server/index.ts` boot path.

---

## 4. Database and migrations

- **Push schema (dev/single-node):** from repo root, with `DATABASE_URL` set:

  ```bash
  npm run db:push
  ```

  Uses **Drizzle Kit** (`drizzle-kit push`) against `shared/schema.ts` (includes `scheduled_targets`, `receipt_chain`).

- **State:** No bundled migration history viewer; use Postgres `\d scheduled_targets`, `\d receipt_chain`, or Drizzle Studio if configured locally.

- **Backups:** Standard Postgres practices (managed provider snapshots).

---

## 5. Environment variables

- **Canonical template:** root `.env.example` (grouped: LLM, server, DB, Redis/BullMQ, Clerk, Stripe, chain, scheduler, SMTP, desktop, CORS).

- **Minimal web + DB:** `DATABASE_URL`, `PORT`, Node env, OpenAI keys if LLM runs.

- **Chain + scheduler:** `DEBRIEF_CHAIN_ENABLED`, `PTA_CHAIN_STATE_DIR` (optional), signing keys (`DEBRIEF_CHAIN_*`), `DEBRIEF_SCHEDULER_ENABLED`, `DEBRIEF_SCHEDULER_TIMEZONE`.

- **Queue:** `REDIS_URL`, `DEBRIEF_USE_BULLMQ=1`, worker flag `DEBRIEF_RUN_ANALYZER_WORKER=1` on worker process only.

- **Cross-origin SPA:** `ALLOWED_ORIGINS` (comma-separated, trimmed); see `.env.example` for production warning behavior.

For full variable semantics, see **`docs/CONFIGURATION.md`** and **`docs/DEPLOYMENT.md`** (being aligned with Debrief naming).
