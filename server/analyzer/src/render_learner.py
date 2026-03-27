"""
LEARNER_REPORT.md — non-technical, personalized coaching output.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional


ALLOWED_LEARN_RESOURCE_PREFIXES = (
    "https://developer.mozilla.org/",
    "https://docs.python.org/",
    "https://nodejs.org/",
    "https://react.dev/",
    "https://nextjs.org/docs",
    "https://www.freecodecamp.org/",
    "https://www.theodinproject.com/",
    "https://roadmap.sh/",
    "https://fastapi.tiangolo.com/",
    "https://expressjs.com/",
    "https://flask.palletsprojects.com/",
    "https://supabase.com/docs",
    "https://neon.tech/docs",
)

TOOL_PRICING_URLS: Dict[str, str] = {
    "Cursor": "https://cursor.com/pricing",
    "GitHub Copilot": "https://github.com/features/copilot/plans",
    "Supabase": "https://supabase.com/pricing",
    "Replit": "https://replit.com/pricing",
    "Snyk": "https://snyk.io/plans/",
    "SonarQube": "https://www.sonarqube.org/pricing/",
    "Semgrep": "https://semgrep.dev/pricing",
    "Railway": "https://railway.app/pricing",
    "Render": "https://render.com/pricing",
    "Netlify": "https://www.netlify.com/pricing/",
    "Vercel": "https://vercel.com/pricing",
    "Neon": "https://neon.tech/pricing",
    "PlanetScale": "https://planetscale.com/pricing",
}


def _fetch_url_text(url: str, limit: int = 14000, timeout: float = 14.0) -> str:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "PTA-LearnerReport/1.0 (pricing snapshot; contact: debrief)"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()[: limit * 2]
        return raw.decode("utf-8", errors="replace")[:limit]
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        return f"(fetch failed: {e})"


def collect_pricing_context(detected_tools: List[str]) -> str:
    """Live-fetch pricing page excerpts; LLM extracts tiers — no hardcoded prices."""
    chunks: List[str] = []
    seen_urls: set = set()
    for name in detected_tools:
        url = TOOL_PRICING_URLS.get(name)
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        text = _fetch_url_text(url)
        chunks.append(f"=== {name} ({url}) ===\n{text}\n")
    return "\n".join(chunks)[:32000] if chunks else "(No matching pricing pages fetched — suggest (price unverified — check directly).)"


def enrich_pricing_with_web_search(analyzer: Any, tool_names: List[str]) -> str:
    """
    Supplement urllib-captured HTML with model + web_search_preview (live search).
    Never hardcodes prices here — model returns natural language from search results.
    """
    if getattr(analyzer, "no_llm", False) or not getattr(analyzer, "client", None):
        return ""
    names = [t for t in tool_names if t in TOOL_PRICING_URLS][:6]
    if not names:
        return ""
    client = analyzer.client
    try:
        if not hasattr(client, "responses"):
            return ""
        model = getattr(analyzer, "llm_model", None) or "gpt-4.1"
        prompt = (
            "Search the public web and summarize CURRENT pricing for each tool: free tier if any, "
            "and lowest paid tier with currency. One tight bullet per tool; if you cannot verify a number, "
            'write (price unverified — check directly). Tools: '
            + ", ".join(names)
        )
        resp = client.responses.create(
            model=model,
            tools=[{"type": "web_search_preview"}],
            input=prompt,
        )
        return (getattr(resp, "output_text", None) or "").strip()[:12000]
    except Exception:
        return ""


def detect_stack_signals(repo: Path, file_index: List[str]) -> Dict[str, Any]:
    """Signals for stack audit — no paths in final output to user, only facts."""
    tools_set: set = set()
    lock_hints: List[str] = []
    ai_assist_hints: List[str] = []
    ci_hints: List[str] = []

    check_files = {
        "package.json": "npm",
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "requirements.txt": "pip",
        "pyproject.toml": "python",
        "Cargo.toml": "rust",
        "go.mod": "go",
        "Gemfile": "ruby",
    }

    for rel in file_index:
        low = rel.replace("\\", "/").lower()
        name = Path(rel).name
        if name in check_files:
            lock_hints.append(check_files[name])
        if name == "package.json":
            p = repo / rel
            try:
                data = json.loads(p.read_text(encoding="utf-8", errors="replace"))
                deps_all = {
                    **(data.get("dependencies") or {}),
                    **(data.get("devDependencies") or {}),
                }
                for dep in list(deps_all.keys())[:50]:
                    dl = dep.lower()
                    if "eslint" in dl:
                        tools_set.add("ESLint")
                    if "prettier" in dl:
                        tools_set.add("Prettier")
                    if "jest" in dl or "vitest" in dl:
                        tools_set.add("JavaScript testing")
                    if "@supabase" in dl or dl == "supabase":
                        tools_set.add("Supabase")
            except (OSError, json.JSONDecodeError):
                pass
        if ".cursorrules" in low or ".cursor/" in low:
            ai_assist_hints.append("Cursor config present")
        if "copilot" in low or ".github/copilot-instructions" in low:
            ai_assist_hints.append("GitHub Copilot hints")
        if ".github/workflows" in low:
            ci_hints.append("GitHub Actions")
        if "netlify.toml" in name.lower():
            ci_hints.append("Netlify")
        if "vercel.json" in name.lower():
            ci_hints.append("Vercel")
        if name.lower() == "dockerfile" or "docker-compose" in name.lower():
            ci_hints.append("Docker")
        if name.lower() == "render.yaml":
            tools_set.add("Render")
        if name.lower() == "railway.json" or name.lower() == "railway.toml":
            tools_set.add("Railway")
        if ".replit" in low or name.lower() == "replit.nix":
            tools_set.add("Replit")
            ci_hints.append("Replit hosting")

    if any("package.json" in f.replace("\\", "/") for f in file_index):
        tools_set.add("Node.js ecosystem")
    if any("pyproject.toml" == Path(f).name or f.endswith("requirements.txt") for f in file_index):
        tools_set.add("Python ecosystem")

    # Map to pricing fetches (hypotheses for audit — final copy must justify in prose)
    if ai_assist_hints:
        if any("Cursor" in h for h in ai_assist_hints):
            tools_set.add("Cursor")
        if any("Copilot" in h for h in ai_assist_hints):
            tools_set.add("GitHub Copilot")

    return {
        "tool_names_for_pricing": sorted(
            [t for t in tools_set if t in TOOL_PRICING_URLS]
        ),
        "stack_labels": sorted(tools_set | set(lock_hints)),
        "ai_assist_hints": ai_assist_hints,
        "ci_hints": ci_hints,
        "lock_hints": list(dict.fromkeys(lock_hints)),
    }


def heuristic_ai_smells(
    claims: Any,
    api_surface: Optional[Dict[str, Any]],
    repo: Path,
    file_index: List[str],
) -> List[Dict[str, str]]:
    flags: List[Dict[str, str]] = []
    # Claims inferred/unknown
    raw = claims or {}
    arr = raw.get("claims") if isinstance(raw, dict) else None
    boring_claim = re.compile(
        r"^(primary languages:|project is named|project description:|npm script|key dependencies:)",
        re.I,
    )
    if isinstance(arr, list):
        for c in arr[:80]:
            if not isinstance(c, dict):
                continue
            st = (c.get("status") or c.get("confidence") or "").lower()
            stmt = (c.get("statement") or c.get("claim") or "").strip()
            if not stmt or boring_claim.match(stmt):
                continue
            ev = c.get("evidence") or []
            if st == "inferred" and isinstance(ev, list) and len(ev) > 0:
                continue
            if st in ("inferred", "unknown", "unverified", "not_implemented"):
                stmt_low = stmt.lower()
                behavioral = any(
                    k in stmt_low
                    for k in (
                        "auth",
                        "endpoint",
                        "route",
                        "password",
                        "secret",
                        "token",
                        "payment",
                        "database",
                        "stores",
                        "upload",
                        "user data",
                    )
                )
                risky_wording = any(
                    k in stmt_low
                    for k in (
                        "might ",
                        "may ",
                        "likely ",
                        "assumed ",
                        "placeholder",
                        "todo",
                        "fixme",
                    )
                )
                if not (behavioral or risky_wording):
                    continue
                if len(stmt) < 400:
                    topic = " ".join(stmt.split()[:4])[:48]
                    flags.append(
                        {
                            "problem": f'A review note relied on weak proof: "{stmt[:200]}".',
                            "why": "If this was guessed instead of double-checked, the real app behavior could surprise you.",
                            "search": f"{topic} manual test checklist production",
                        }
                    )
                if len(flags) >= 4:
                    break

    # Silent except
    scanned = 0
    for rel in file_index:
        if scanned > 40:
            break
        if not rel.endswith(".py") and not rel.endswith(".js") and not rel.endswith(".ts"):
            continue
        p = repo / rel
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        scanned += 1
        if re.search(r"except\s*:\s*$|except\s+Exception\s*:\s*\n\s*pass", text, re.M):
            flags.append(
                {
                    "problem": "Some code catches errors and does nothing afterward (silent failure).",
                    "why": "Users see broken behavior with no message; you get harder bugs in production.",
                    "search": "python bare except pass best practices logging",
                }
            )
            break

    # Auth mismatch: many OPEN vs few authenticated
    if api_surface:
        eps = api_surface.get("endpoints") or []
        if isinstance(eps, list) and len(eps) > 5:
            open_n = sum(1 for e in eps if isinstance(e, dict) and e.get("auth") == "OPEN")
            auth_n = sum(1 for e in eps if isinstance(e, dict) and e.get("auth") == "AUTHENTICATED")
            if open_n >= 3 and auth_n >= 1:
                flags.append(
                    {
                        "problem": "Some routes look authenticated and others look wide open in a static scan.",
                        "why": "Attackers often probe the open ones first; inconsistent auth is a common oversight.",
                        "search": "web API authentication middleware all routes",
                    }
                )

    # Fake / placeholder libs (light heuristic)
    for rel in file_index[:120]:
        if not rel.endswith(".py"):
            continue
        try:
            line = (repo / rel).read_text(encoding="utf-8", errors="replace")[:4000]
        except OSError:
            continue
        if "TODO: replace" in line or "your-api-key-here" in line.lower():
            flags.append(
                {
                    "problem": "Stub or placeholder text that looks like it came from a tutorial.",
                    "why": "Easy to ship by accident; can leak fake credentials or broken integrations.",
                    "search": "remove placeholder API keys before production checklist",
                }
            )
            break

    return flags[:8]


def dci_bucket(score: float) -> str:
    pct = int(round(100 * score))
    if pct >= 90:
        return (
            f"About **{pct}%** of key statements in this run tied back to checkable source evidence — "
            "in plain terms: **solid, verifiable code**. Most of what it claims to do, it actually points to in the repo."
        )
    if pct >= 70:
        return (
            f"Roughly **{pct}%** of statements were anchored in checkable evidence — "
            "**working code with some parts we couldn't fully verify**. That is normal for a project this size."
        )
    if pct >= 50:
        return (
            f"About **{pct}%** of statements were clearly anchored — "
            "**works but has larger areas we couldn't confirm**. A cleanup pass before you show it widely is a good idea."
        )
    return (
        f"Only about **{pct}%** of statements were tightly anchored — "
        "**hard to verify a lot of this from files alone**. That is not automatically bad, but it is worth a deeper read before you share."
    )


def render_learner_report(
    *,
    analyzer: Any,
    run_dir: Path,
    howto: Dict[str, Any],
    claims: Dict[str, Any],
    api_surface: Dict[str, Any],
    dossier_body: str,
    evidence_pack: Dict[str, Any],
    file_index: List[str],
) -> Path:
    """Write LEARNER_REPORT.md; uses LLM when client available."""
    repo = Path(analyzer.repo_dir)
    stack = detect_stack_signals(repo, file_index)
    pricing_fetch = collect_pricing_context(stack["tool_names_for_pricing"])
    web_pricing = enrich_pricing_with_web_search(analyzer, stack["tool_names_for_pricing"])
    if web_pricing:
        pricing_fetch = (
            pricing_fetch
            + "\n\n=== Live web search summary (verify; prices change) ===\n"
            + web_pricing
        )
    smells = heuristic_ai_smells(claims, api_surface, repo, file_index)

    metrics = (evidence_pack.get("metrics") or {}).get("dci_v1_claim_visibility") or {}
    dci_score = float(metrics.get("score") or 0.0)
    section6 = dci_bucket(dci_score)

    open_eps = [e for e in (api_surface.get("endpoints") or []) if isinstance(e, dict) and e.get("auth") == "OPEN"][
        :12
    ]

    dep_sum = (evidence_pack or {}).get("dependency_graph_summary") or {}
    payload = {
        "dependency_osv_hint": {
            "flagged_cve_count": dep_sum.get("flagged_cve_count"),
            "ecosystems": dep_sum.get("count_by_ecosystem"),
        },
        "stack": stack,
        "howto_summary": {
            "target": howto.get("target"),
            "prereqs": (howto.get("prereqs") or [])[:12],
            "unknowns": (howto.get("unknowns") or [])[:8],
        },
        "claims_excerpt": json.dumps(claims, default=str)[:8000],
        "dossier_excerpt_plain": dossier_body[:6000],
        "api_summary": api_surface.get("summary"),
        "open_endpoints_count": len(open_eps),
        "heuristic_flags": smells,
        "pricing_page_excerpts": pricing_fetch,
        "section6_dci_language": section6,
    }

    if getattr(analyzer, "no_llm", False) or not getattr(analyzer, "client", None):
        md = _learner_report_fallback(payload, section6, smells, stack)
        out = run_dir / "LEARNER_REPORT.md"
        out.write_text(md, encoding="utf-8")
        return out

    system = """You write LEARNER_REPORT.md for someone who built software without being a career engineer.
Rules:
- NO file paths, NO line numbers, NO code blocks, NO repository URLs.
- Plain English only; short sentences; warm and direct.
- Every bullet must be grounded in the JSON context — no generic advice that fits any project.
- Use EXACTLY these section headings in order (markdown ##):

## 1 — What You Actually Built
## 2 — What's Holding It Together
## 3 — What the AI Got Wrong
## 4 — What to Learn Next
## 5 — Your Stack, Audited
## 6 — Is This Real Code
## 7 — What's Safe to Show
## 8 — Your Next Move

Section 2 must be a three-column markdown layout using these column titles in bold on one line each:
**WORKING WELL** | **WATCH OUT** | **FIX THIS FIRST**
Then under each, use bullet lines starting with emoji: ✅ ⚠️ 🔴 as specified by column (✅ only under WORKING WELL, ⚠️ under WATCH OUT, 🔴 under FIX THIS FIRST).
Max 4 bullets per column.

Section 4: max 5 items. Each item: **Concept** — sentence why it matters for THIS project — link on its own line starting with → 
Links MUST be only MDN, official docs, freeCodeCamp, The Odin Project, roadmap.sh, or the tool's own docs/getting-started (https only).

Section 5: Order matters — NEVER put the disclaimer first.
(a) **What you're currently using**
(b) **What you might be overpaying for**
(c) **Cheaper or better alternatives for this specific stack**
(d) Then on its own, the disclaimer quote exactly:
"These are suggestions based on what we found in your codebase, not endorsements. Prices change — verify before switching."
Combine pricing_page_excerpts (live HTTP snippets) with any web search supplement for tiers. Never invent numbers: if unclear, say (price unverified — check directly). Mention dependency_osv_hint only if it adds meaningful context for this repo.

Section 7: No file paths, no folder names, no word "paths", no "routes", no "endpoints" — describe behaviors only.

Section 8: Exactly ONE sentence only (one period), then optional one link on the next line starting with → . No second sentence, no semicolon chains.

Section 6: paste or closely paraphrase the provided section6_dci_language paragraph (plain language band).
"""
    user = json.dumps(payload, default=str)[:24000]
    try:
        rsp = analyzer.client.chat.completions.create(
            model=analyzer.llm_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_completion_tokens=6000,
        )
        txt = (rsp.choices[0].message.content or "").strip()
    except Exception as e:
        txt = ""

    if not txt:
        txt = _learner_report_fallback(payload, section6, smells, stack)

    out = run_dir / "LEARNER_REPORT.md"
    out.write_text(txt, encoding="utf-8")
    return out


def _learner_report_fallback(payload: Dict[str, Any], section6: str, smells: List[Dict], stack: Dict) -> str:
    lines = [
        "## 1 — What You Actually Built",
        "",
        "The full coach-style write-up needs the analysis service’s language step, which was not available in this run. "
        f"From what was scanned automatically, this project mixes "
        f"{', '.join((stack.get('stack_labels') or [])[:8]) or 'general application code'}. "
        "Re-run with the language step enabled for a richer opening section.",
        "",
        "## 2 — What's Holding It Together",
        "",
        "**WORKING WELL** | **WATCH OUT** | **FIX THIS FIRST**",
        "",
        "✅ The repository has real structure and dependencies we could read automatically.",
        "",
        "⚠️ Some parts of the automated review had lower confidence — treat labels as hints, not proof.",
        "",
        "🔴 Anything you haven't personally run end-to-end is not ready to present as finished.",
        "",
        "## 3 — What the AI Got Wrong",
        "",
    ]
    if smells:
        for s in smells[:5]:
            lines.extend(
                [
                    f"- **Issue:** {s.get('problem', '')}",
                    f"  - **Why it matters:** {s.get('why', '')}",
                    f"  - **Look up:** {s.get('search', '')}",
                    "",
                ]
            )
    else:
        lines.append(
            "No obvious AI-shaped problems were flagged automatically. "
            "That said, always read code you did not write line by line before shipping."
        )
        lines.append("")
    lines.extend(
        [
            "## 4 — What to Learn Next",
            "",
            "**Environment variables** — Most apps eventually need secrets outside the source tree.",
            "→ https://www.freecodecamp.org/news/how-to-use-node-environment-variables/",
            "",
            "## 5 — Your Stack, Audited",
            "",
            "**What you're currently using**",
            "",
            ", ".join((stack.get("stack_labels") or ["(run with LLM for detail)"])),
            "",
            "**What you might be overpaying for**",
            "",
            "Compare overlapping paid tools once you know your monthly bill — this scan never sees your invoices.",
            "",
            "**Cheaper or better alternatives for this specific stack**",
            "",
            "(price unverified — check directly) — turn the coaching writer on with internet access, then re-run for fresh price notes.",
            "",
            '"These are suggestions based on what we found in your codebase, not endorsements. Prices change — verify before switching."',
            "",
            "## 6 — Is This Real Code",
            "",
            section6,
            "",
            "## 7 — What's Safe to Show",
            "",
            "- **Show this:** pieces you have personally run and that behave the way you expect.",
            "- **Not ready yet:** anything you have not tested, plus open pages that skip login if the app touches private information.",
            "",
            "## 8 — Your Next Move",
            "",
            "Before you demo, run through the main user flow yourself on a clean machine and fix the first broken step you hit. "
            "If you use secrets in code, start here: https://www.freecodecamp.org/news/how-to-use-node-environment-variables/",
            "",
        ]
    )
    return "\n".join(lines)
