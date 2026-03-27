# Debrief

Read any codebase. Get a verified plain-language brief.

## What it does

Debrief analyzes a codebase and produces:

- A plain-English report of what the code actually does  
- Security and dependency audit with CVE-style flagging  
- API surface map (endpoints, webhooks, auth posture)  
- A cryptographic receipt per run (integrity metadata)

**Modes:**

- **Learner** — For builders using AI who want to understand what they have, what’s risky, and what to learn next.  
- **Pro** — Full signed dossier for diligence and compliance-style review.

## Quickstart

```bash
# Install JS dependencies
npm install

# Python env (from repo root)
python3 -m venv .venv
.venv/bin/pip install -e .

# Environment
cp .env.example .env
# Set AI_INTEGRATIONS_OPENAI_API_KEY (or OPENAI_API_KEY) for LLM runs
# Set DATABASE_URL if you use the web app + DB

# Optional: Postgres + Redis for local dev
docker compose up -d

# Run the web app (Express + Vite client)
npm run dev

# Analyze a repo (CLI)
.venv/bin/python -m server.analyzer.analyzer_cli analyze \
  https://github.com/user/repo \
  --output-dir ./out/my-run \
  --mode learner
```

## Input types

GitHub, GitLab, Bitbucket, Replit, local folder (dev), zip upload, deployed URL surface scan, audio (Whisper), pasted text, Notion (public page). See `docs/CONTEXT.md` for the ingestion router and APIs.

## Repo layout

| Path | Purpose |
|------|---------|
| `client/` | React UI, Vite config, `src-tauri/` (desktop) |
| `server/` | Express API, ingestion, queue/cache stubs, Python analyzer under `server/analyzer/` |
| `shared/` | Drizzle schema, shared routes, JSON schemas |
| `docs/` | Product and engineering context |
| `extensions/`, `integrations/` | Stubs for editor and bots |
| `out/` | **Local run output — gitignored** |

## Desktop

```bash
npm run dev   # terminal 1 — API on PORT from .env (default 5000)
npm run desktop:dev
```

## Architecture

- `docs/CONTEXT.md` — technical architecture and pipeline notes  
- `docs/MARKET_CONTEXT.md` — positioning  

## License

TBD
