# Session handoffs

Use this file (or new dated sections below) for short **session handoff** notes: what changed, what’s next, env vars, and verification commands.

Longer product/engineering context lives in `docs/CONTEXT.md` and `docs/MARKET_CONTEXT.md`.

---

## 2026-03-27 — Repo cleanup / layout

- **Layout:** Frontend tooling lives under `client/` (`vite.config.ts`, `tailwind.config.ts`, `postcss`, `components.json`, `tsconfig.json`). Tauri → `client/src-tauri/` (update `frontendDist` / `beforeBuildCommand` for repo root). Claim/coverage helpers moved from top-level `src/` → `server/claims`, `server/coverage`, `server/canon`. JSON schemas `dossier_v2` / `coverage_report_v1` → `shared/schemas/`.
- **Scripts:** `npm run desktop:dev` / `desktop:build` run from `client/`; `script/build.ts` passes `client/vite.config.ts` to Vite.
- **Ignore:** Expanded `.gitignore` (out, env, Python/Node/OS/IDE, `client/src-tauri/target/`). Run `git rm --cached` for any stray tracked artifacts if they appear.
- **Dev DB:** `docker compose up -d` per root `docker-compose.yml`.

