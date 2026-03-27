from __future__ import annotations

from typing import Any, Dict
import json
import re

def render_onboarding_guide(pack: Dict[str, Any]) -> str:
    """
    Render a professional onboarding guide for engineers, operators, and stakeholders.
    Strictly follows the required headings and structure.
    """
    lines = []
    lines.append("# System Onboarding Guide\n")
    # Purpose and Context
    lines.append("## Purpose and Context\n")
    lines.append("This system provides evidence-backed analysis of software repositories, surfacing operational risks and unknowns. Evidence-backed analysis ensures that claims about the system are verifiable and not based on undocumented assumptions. By explicitly surfacing unknowns, the system reduces the risk of hidden gaps and enables safer onboarding, operation, and evaluation.\n")
    # How to Approach This System
    lines.append("## How to Approach This System\n")
    lines.append("- **If you are evaluating this tool:** Start with the 'Repository Analysis Summary' (ONEPAGER.md) for a high-level overview, then review the 'Immediate Risk Briefing' below.\n- **If you are deploying or operating it:** See 'First 24 Hours' and 'First Week' for operational steps and evidence model guidance.\n- **If you inherited this codebase:** Begin with 'System Architecture Overview' and 'Immediate Risk Briefing' to understand structure and risks.\n- **If something is currently broken:** Consult 'Common Failure Scenarios' and 'Escalation and Ownership' for troubleshooting and routing.\n")
    # Immediate Risk Briefing (Known Unknowns)
    lines.append("## Immediate Risk Briefing (Known Unknowns)\n")
    unknowns = pack.get("unknowns", [])
    # Select top 5 unknowns
    priority_unknowns = [
        "deployment/docs",
        "ops/runbook",
        "dr/disaster_recovery",
        "api/map",
        "frontend/prod_build",
    ]
    selected_unknowns = []
    for cat in priority_unknowns:
        for u in unknowns:
            if u.get("category") == cat and u.get("status") == "UNKNOWN":
                selected_unknowns.append(u)
                break
        if len(selected_unknowns) >= 5:
            break
    if len(selected_unknowns) < 5:
        for u in unknowns:
            if u.get("status") == "UNKNOWN" and u not in selected_unknowns:
                selected_unknowns.append(u)
            if len(selected_unknowns) >= 5:
                break
    lines.append("| Gap | Why It Matters | Evidence Required to Close It |")
    lines.append("|-----|---------------|------------------------------|")
    if not selected_unknowns:
        lines.append("| None | No major unknowns detected | N/A |\n")
    else:
        for u in selected_unknowns:
            gap = u.get("category", "?")
            why = u.get("description", "No description.")
            evidence = u.get("evidence_needed") or u.get("closure_hint") or "Evidence required to close this unknown."
            lines.append(f"| {gap} | {why} | {evidence} |")
    lines.append("")
    # First 24 Hours
    lines.append("## First 24 Hours\n")
    lines.append("- Run the analyzer using the documented CLI command.\n- Locate outputs in the latest run directory under `output/runs/`.\n- Open `ONEPAGER.md` for an executive summary.\n- Open `ONBOARDING_GUIDE.md` for onboarding steps.\n- Review `DOSSIER.md` for full technical details.\n")
    # First Week
    lines.append("## First Week\n")
    lines.append("- Study the evidence model: VERIFIED (evidence-backed), INFERRED (not fully evidenced), UNKNOWN (no evidence).\n- Run analysis on a real external repository.\n- Interpret outputs using the onboarding guide and summary.\n- Review CI and configuration gates only if they are evidence-backed in the claims.\n")
    # First Month
    lines.append("## First Month\n")
    lines.append("- Practice operating under failure scenarios.\n- Review security posture and secrets handling if evidenced.\n- Identify known risk areas and production-readiness gaps.\n- Check for observability/logging if present.\n- If any area is not evidenced, treat as Unknown.\n")
    # System Architecture Overview
    lines.append("## System Architecture Overview\n")
    lines.append("```mermaid\ngraph TD\n    A[Target Repository] --> B[Analyzer Engine]\n    B --> C[Evidence Pack + Reports]\n    C --> D[Human Review / Deployment Decisions]\n```\n")
    # Example Output Walkthrough
    lines.append("## Example Output Walkthrough\n")
    # manifest.json excerpt
    manifest = pack.get("manifest_excerpt")
    if manifest:
        lines.append("> manifest.json excerpt:\n")
        lines.append("```")
        lines.extend(manifest.splitlines()[:10])
        lines.append("```")
        lines.append("> This section shows the run context and configuration.\n")
    # evidence_pack.v1.json excerpt
    evidence_pack = pack.get("evidence_pack_excerpt")
    if evidence_pack:
        lines.append("> evidence_pack.v1.json excerpt:\n")
        lines.append("```")
        lines.extend(evidence_pack.splitlines()[:10])
        lines.append("```")
        lines.append("> This indicates the structure of the evidence pack.\n")
    # DOSSIER.md excerpt
    dossier = pack.get("dossier_excerpt")
    if dossier:
        lines.append("> DOSSIER.md excerpt:\n")
        lines.append("```")
        lines.extend(dossier.splitlines()[:10])
        lines.append("```")
        lines.append("> This confirms the technical findings and evidence.\n")
    lines.append("")
    # Escalation and Ownership
    lines.append("## Escalation and Ownership\n")
    if not selected_unknowns:
        lines.append("No major unknowns requiring escalation.\n")
    else:
        for u in selected_unknowns:
            gap = u.get("category", "?")
            route = u.get("escalation") or "Likely requires original author or DevOps; see codebase or client for input."
            lines.append(f"- {gap}: {route}")
    lines.append("")
    # Common Failure Scenarios
    lines.append("## Common Failure Scenarios\n")
    scenarios = pack.get("failure_scenarios", [])
    if not scenarios:
        lines.append("No common failure scenarios evidenced.\n")
    else:
        for s in scenarios[:5]:
            lines.append(f"**Scenario:** {s.get('scenario','?')}\n**Symptoms:** {s.get('symptoms','?')}\n**Likely Cause:** {s.get('cause','?')}\n**Where to Check:** {s.get('where','?')}\n**Resolution Path:** {s.get('resolution','?')}\n")
    return "\n".join(lines)

def render_onepager(pack: Dict[str, Any]) -> str:
    """
    Render a professional executive summary for meetings.
    Strictly follows the required headings and structure.
    """
    lines = []
    lines.append("# Repository Analysis Summary\n")
    lines.append("## What This Tool Does\n")
    lines.append("This tool analyzes a software repository and produces a deterministic, evidence-backed summary of its structure, deployment, security posture, and operational risks. It is designed for decision-makers and stakeholders who need a concise, trustworthy briefing.\n")
    lines.append("## What It Found in This Repository\n")
    # Top 5 verified claims
    verified_sections = _get_verified_sections(pack)
    verified_claims = []
    for section in [
        "runtime/entrypoint",
        "ci/gating",
        "deployment/model",
        "security/posture",
        "output/artifacts",
    ]:
        claims = verified_sections.get(section, [])
        for claim in claims:
            if claim.get("evidence"):
                verified_claims.append((section, claim))
            if len(verified_claims) >= 5:
                break
        if len(verified_claims) >= 5:
            break
    if len(verified_claims) < 5:
        for section, claims in verified_sections.items():
            for claim in claims:
                if claim.get("evidence") and (section, claim) not in verified_claims:
                    verified_claims.append((section, claim))
                if len(verified_claims) >= 5:
                    break
            if len(verified_claims) >= 5:
                break
    if not verified_claims:
        lines.append("- No verified claims with deterministic evidence were found.\n")
    else:
        for section, claim in verified_claims[:5]:
            stmt = claim.get("statement") or claim.get("summary") or section
            lines.append(f"- {stmt}")
    lines.append("")
    lines.append("## Gaps and Risks\n")
    unknowns = pack.get("unknowns", [])
    priority_unknowns = [
        "deployment/docs",
        "ops/runbook",
        "dr/disaster_recovery",
        "api/map",
        "frontend/prod_build",
    ]
    selected_unknowns = []
    for cat in priority_unknowns:
        for u in unknowns:
            if u.get("category") == cat and u.get("status") == "UNKNOWN":
                selected_unknowns.append(u)
                break
        if len(selected_unknowns) >= 5:
            break
    if len(selected_unknowns) < 5:
        for u in unknowns:
            if u.get("status") == "UNKNOWN" and u not in selected_unknowns:
                selected_unknowns.append(u)
            if len(selected_unknowns) >= 5:
                break
    if not selected_unknowns:
        lines.append("- No major gaps or risks detected.\n")
    else:
        for u in selected_unknowns:
            cat = u.get("category", "?")
            desc = u.get("description", "No description.")
            evidence_needed = u.get("evidence_needed") or u.get("closure_hint") or "Evidence required to close this gap."
            lines.append(f"- {cat}: {desc} (To close: {evidence_needed})")
    lines.append("")
    lines.append("## Why the Findings Are Trustworthy\n")
    lines.append("- All findings are backed by deterministic evidence (file hashes, code snippets, or file existence).\n- No claims are promoted to verified without evidence.\n- Unknowns are explicitly listed with what evidence would close them.\n- The tool never infers or guesses claim status.\n")
    completeness = pack.get("metrics", {}).get("completeness_score")
    if completeness is not None:
        lines.append(f"Completeness score: {completeness}/100 (computed from verified claims, unknowns, and how-to coverage).\n")
    lines.append("## How to Run It\n")
    lines.append("1. Install Python 3.10+ and create a virtual environment.\n2. Install dependencies: `pip install -r requirements.txt`\n3. Run the analyzer:\n\n   ../../.venv/bin/python -m analyzer_cli analyze ../.. --output-dir ../../output --no-llm\n\n4. Find the outputs in the latest run directory under `output/runs/`.\n")
    return "\n".join(lines)
def render_onepager_plain(pack: Dict[str, Any]) -> str:
    """
    Render a one-page, plain-English summary for non-engineers.
    Strictly follows the required headings and selection logic.
    """
    import datetime
    lines = []
    lines.append("# Repository Reconnaissance — One-Pager")
    lines.append("")
    # 2. What it does
    lines.append("## What it does")
    lines.append("")
    lines.append("This tool analyzes a software repository to produce a deterministic, evidence-backed summary of its structure, deployment, security posture, and operational readiness. It is designed to help technical leaders and decision-makers quickly understand what is present, what is missing, and how much can be trusted—without requiring code review skills.")
    lines.append("")
    # 3. What it produced for this repo
    lines.append("## What it produced for this repo")
    lines.append("")
    artifacts = pack.get("artifacts", [])
    if not artifacts:
        # Fallback: try to infer from summary
        summary = pack.get("summary", {})
        artifacts = summary.get("artifacts", [])
    if artifacts:
        lines.append("Artifacts generated:")
        for art in artifacts[:5]:
            lines.append(f"- {art}")
        if len(artifacts) > 5:
            lines.append(f"- ...and {len(artifacts)-5} more.")
    else:
        lines.append("- Evidence pack, report, and manifest files.")
    lines.append("")
    # 4. What it found (verified)
    lines.append("## What it found (verified)")
    lines.append("")
    # Deterministic selection of top 5 verified claims
    verified_sections = _get_verified_sections(pack)
    verified_claims = []
    for section in [
        "runtime/entrypoint",
        "ci/gating",
        "deployment/model",
        "security/posture",
        "output/artifacts",
    ]:
        claims = verified_sections.get(section, [])
        for claim in claims:
            if claim.get("evidence"):
                verified_claims.append((section, claim))
            if len(verified_claims) >= 5:
                break
        if len(verified_claims) >= 5:
            break
    # Fallback: fill with any other verified claims if <5
    if len(verified_claims) < 5:
        for section, claims in verified_sections.items():
            for claim in claims:
                if claim.get("evidence") and (section, claim) not in verified_claims:
                    verified_claims.append((section, claim))
                if len(verified_claims) >= 5:
                    break
            if len(verified_claims) >= 5:
                break
    if len(verified_claims) == 0:
        lines.append("- No verified claims with deterministic evidence were found.")
    else:
        for section, claim in verified_claims[:5]:
            stmt = claim.get("statement") or claim.get("summary") or section
            lines.append(f"- {stmt}")
    if len(verified_claims) < 3:
        lines.append("")
        lines.append("Fewer than 3 verified claims were available; see Unknowns and Evidence Pack.")
    lines.append("")
    # 5. What’s missing (unknowns)
    lines.append("## What’s missing (unknowns)")
    lines.append("")
    unknowns = pack.get("unknowns", [])
    # Deterministic selection of top 5 unknowns
    priority_unknowns = [
        "deployment/docs",
        "ops/runbook",
        "dr/disaster_recovery",
        "api/map",
        "frontend/prod_build",
    ]
    selected_unknowns = []
    for cat in priority_unknowns:
        for u in unknowns:
            if u.get("category") == cat and u.get("status") == "UNKNOWN":
                selected_unknowns.append(u)
                break
        if len(selected_unknowns) >= 5:
            break
    # Fill with any other unknowns if <5
    if len(selected_unknowns) < 5:
        for u in unknowns:
            if u.get("status") == "UNKNOWN" and u not in selected_unknowns:
                selected_unknowns.append(u)
            if len(selected_unknowns) >= 5:
                break
    if not selected_unknowns:
        lines.append("- No unknowns detected.")
    else:
        for u in selected_unknowns:
            cat = u.get("category", "?")
            desc = u.get("description", "No description.")
            evidence_needed = u.get("evidence_needed") or u.get("closure_hint") or "Evidence required to close this unknown."
            lines.append(f"- {cat}: {desc} (To close: {evidence_needed})")
    lines.append("")
    # 6. Why you should trust it
    lines.append("## Why you should trust it")
    lines.append("")
    lines.append("- All verified claims are backed by deterministic evidence (file hashes, code snippets, or file existence).\n- No claims are promoted to verified without evidence.\n- Unknowns are explicitly listed with what evidence would close them.\n- The tool never infers or guesses claim status.")
    completeness = pack.get("metrics", {}).get("completeness_score")
    if completeness is not None:
        lines.append("")
        lines.append(f"Completeness score: {completeness}/100 (computed from verified claims, unknowns, and how-to coverage).")
    lines.append("")
    # 7. How to run it
    lines.append("## How to run it")
    lines.append("")
    lines.append("1. Install Python 3.10+ and create a virtual environment.")
    lines.append("2. Install dependencies: `pip install -r requirements.txt`")
    lines.append("3. Run the analyzer:\n")
    lines.append("   ../../.venv/bin/python -m analyzer_cli analyze ../.. --output-dir ../../output --no-llm --render-mode engineer\n")
    lines.append("4. Find the outputs in the latest run directory under `output/runs/`.\n")
    lines.append("")
    return "\n".join(lines)
"""
Phase 3: Mode Rendering

Renders analysis reports from EvidencePack only.
Never re-reads extraction artifacts directly.
Never re-runs extraction or analysis.

Uses verify_policy for any verification checks.

Modes:
  - engineer: Full file:line references, raw evidence, verbose
  - auditor: VERIFIED + UNKNOWN only, evidence anchors, no inferred narrative
  - executive: Metrics first (RCI + DCI), surface area summaries, no file:line clutter
"""

from typing import Dict, Any, List
from pathlib import Path


def render_report(pack: Dict[str, Any], mode: str = "engineer") -> str:
    if mode == "engineer":
        return _render_engineer(pack)
    elif mode == "auditor":
        return _render_auditor(pack)
    elif mode == "executive":
        return _render_executive(pack)
    elif mode == "plain":
        return render_onepager_plain(pack)
    else:
        return _render_engineer(pack)


def assert_pack_written(pack_path: Path) -> None:
    if pack_path is None:
        raise RuntimeError("save_evidence_pack() returned None; refusing to render report")
    if pack_path.is_dir():
        expected_file = pack_path / "evidence_pack.v1.json"
    else:
        expected_file = pack_path
    if not expected_file.exists() or not expected_file.is_file():
        raise RuntimeError(
            f"Evidence pack missing on disk: expected {expected_file}. "
            "Refusing to render report to prevent silent partial output."
        )


def save_report(content: str, output_dir: Path, mode: str) -> Path:
    filename = f"REPORT_{mode.upper()}.md"
    path = output_dir / filename
    with open(path, "w") as f:
        f.write(content)
    return path


def _render_evidence_anchor(ev: dict) -> str:
    display = ev.get("display", ev.get("path", "?"))
    snippet_hash = ev.get("snippet_hash", "")
    if snippet_hash:
        return f"`{display}` (hash: `{snippet_hash}`)"
    return f"`{display}`"


def _get_verified_sections(pack: Dict[str, Any]) -> Dict[str, List[Dict]]:
    verified = pack.get("verified", {})
    if isinstance(verified, dict):
        return verified
    return {}


def _count_verified_claims(pack: Dict[str, Any]) -> int:
    total = 0
    for section_claims in _get_verified_sections(pack).values():
        if isinstance(section_claims, list):
            total += len(section_claims)
    return total


def _get_rci(pack: Dict[str, Any]) -> Dict[str, Any]:
    return pack.get("metrics", {}).get("rci_reporting_completeness", {})


def _get_dci(pack: Dict[str, Any]) -> Dict[str, Any]:
    return pack.get("metrics", {}).get("dci_v1_claim_visibility", {})


def _get_dci_v2(pack: Dict[str, Any]) -> Dict[str, Any]:
    return pack.get("metrics", {}).get("dci_v2_structural_visibility", {})


def _strip_paths_for_cfo(text: str) -> str:
    """Remove file-path-like segments so executive text stays path-free."""
    t = text
    t = re.sub(r"\s*\([^)]*(?:\.(?:toml|json|ya?ml|lock)|/)[^)]*\)", "", t)
    t = re.sub(
        r"\b[\w.-]+(?:/[\w.-]+)+\.(?:py|js|mjs|cjs|ts|tsx|jsx|go|rs|java|kt|rb|php|md|json|ya?ml|toml|html|css)\b",
        "",
        t,
    )
    t = re.sub(r"\s*,\s*,+", ", ", t)
    t = re.sub(r",(\s*[.,;:])+", r"\1", t)
    t = re.sub(r"\(\s*,", "(", t)
    t = re.sub(r",\s*\)", ")", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    t = re.sub(r"[:;,]\s*$", "", t).strip()
    if len(t) < 12:
        return "Capability indicated by static review (details are in the technical dossier for specialists)."
    return t


def render_onepager_cfo(
    pack: Dict[str, Any],
    dependency_summary: Dict[str, Any] | None = None,
) -> str:
    """
    Non-technical one-pager when LLM is unavailable: memo-style, no file paths or code.
    """
    dci = _get_dci(pack)
    score = float(dci.get("score") or 0)
    pct = int(round(100 * score))
    verified = pack.get("summary", {}).get("verified_claims", 0)
    total = pack.get("summary", {}).get("total_claims", 0) or 1
    lines: list[str] = []
    lines.append("# Executive brief")
    lines.append("")
    lines.append("## What this codebase is")
    lines.append("")
    opener_claims = (pack.get("verified") or {}).get("What the Target System Is")
    opener = None
    if isinstance(opener_claims, list):
        for c in opener_claims[:3]:
            st = (c.get("statement") or "").replace("`", "").strip()
            cand = _strip_paths_for_cfo(st)
            if cand.endswith(":"):
                cand = cand[:-1].strip()
            if len(cand) > 15:
                opener = cand
                break
    if opener:
        op_opening = opener[0].upper() + opener[1:] if opener[0].isalpha() else opener
        if op_opening[-1] not in ".!?":
            op_opening += "."
        lines.append(
            f"{op_opening} This memo summarizes what a read-only pass over the repository could support about scope, "
            "dependencies, and risk themes—the application was not executed as part of this review."
        )
    else:
        lines.append(
            "This is an independently analyzed software asset. The note below summarizes "
            "what static examination could credibly support about structure and operational posture—without running the system."
        )
    lines.append("")
    lines.append("## What it does")
    lines.append("")
    caps: list[str] = []
    seen_caps: set[str] = set()
    for section, claims in (pack.get("verified") or {}).items():
        if not isinstance(claims, list):
            continue
        for c in claims[:2]:
            stmt = (c.get("statement") or "").strip()
            if stmt and len(stmt) < 400:
                plain = _strip_paths_for_cfo(stmt.replace("`", ""))
                if plain.endswith(":"):
                    plain = plain[:-1].strip()
                if len(plain) < 18:
                    continue
                if plain and plain not in seen_caps:
                    seen_caps.add(plain)
                    caps.append(plain)
        if len(caps) >= 6:
            break
    if opener:
        okey = opener.lower()[:48]
        caps = [c for c in caps if c.lower()[:48] != okey]
    if len(caps) < 3:
        fillers = [
            "Ships automated tests and examples that imply intended behaviors (nothing was executed in this review).",
            "Exposes a public package or service surface consistent with its declared ecosystem.",
            "Documents setup and contributor workflows where present in repository metadata.",
        ]
        for f in fillers:
            if f not in seen_caps and f not in caps:
                caps.append(f)
                if len(caps) >= 3:
                    break
    if not caps:
        caps = [
            "Provides the functionality described in project documentation (not executed in this review).",
            "Declares third-party libraries typical for its stack.",
            "Can be built or run using commands inferred from repository metadata where present.",
        ]
    for c in caps[:6]:
        lines.append(f"- {c}")
    lines.append("")
    lines.append("## What it is NOT")
    lines.append("")
    lines.append("- Not a runtime assessment: behavior in production was not observed.")
    lines.append("- Not a security certification: no penetration testing or threat modeling was performed.")
    lines.append("- Not legal advice on licenses or compliance: dependency and license fields are informational only.")
    lines.append("- Not a substitute for management representations or a full quality audit.")
    lines.append("")
    lines.append("## Risk flags")
    lines.append("")
    risks: list[str] = []
    for u in (pack.get("unknowns") or [])[:12]:
        if not isinstance(u, dict):
            continue
        if u.get("status") != "UNKNOWN":
            continue
        desc = (u.get("description") or u.get("notes") or "").strip()
        cat = (u.get("category") or "").replace("_", " ").strip()
        if desc:
            plain = _strip_paths_for_cfo(desc) if re.search(
                r"/|\.(?:py|js|ts)\b", desc
            ) else desc
            sentence = plain[:280].strip()
            if sentence:
                if sentence[0].isalpha():
                    sentence = sentence[0].upper() + sentence[1:]
                risks.append(sentence)
        elif cat:
            risks.append(
                f"We could not verify {cat.lower()} from repository artifacts alone; specialists should confirm."
            )
        if len(risks) >= 5:
            break
    if dependency_summary and dependency_summary.get("flagged_cve_count", 0) > 0:
        risks.insert(
            0,
            f"Dependency scan: {dependency_summary['flagged_cve_count']} direct package(s) matched known vulnerability records (OSV) at analysis time.",
        )
    if not risks:
        risks.append("No high-priority unknowns were auto-flagged; review the full dossier for residual gaps.")
    for r in risks[:5]:
        lines.append(f"- {r}")
    lines.append("")
    lines.append("## Confidence level")
    lines.append("")
    lines.append(
        f"The diligence coverage index for this run is **{pct}%**, meaning about **{verified} of {total}** "
        "reviewed statements were backed by independently checkable evidence in source files—similar in spirit to "
        '“what share of claims a buyer could re-verify without trusting the narrative alone.” '
        "It is not a grade of product quality, security, or team competence—only of how much this specific pass could nail down."
    )
    lines.append("")
    lines.append("## How to get more")
    lines.append("")
    lines.append(
        "For counsel and technical specialists: use **DOSSIER.md** for the full evidence-based narrative and "
        "**REPORT_ENGINEER.md** for the structured engineering report; **receipt.json** records integrity metadata for this run."
    )
    lines.append("")
    return "\n".join(lines)


def _render_engineer(pack: Dict[str, Any]) -> str:
    lines = [
        f"# Program Totality Report — Engineer View",
        f"",
        f"**EvidencePack Version:** {pack.get('evidence_pack_version', '?')}",
        f"**Tool Version:** {pack.get('tool_version', '?')}",
        f"**Generated:** {pack.get('generated_at', '?')}",
        f"**Mode:** {pack.get('mode', '?')}",
        f"**Run ID:** {pack.get('run_id', '?')}",
        f"",
        "---",
        "",
    ]

    summary = pack.get("summary", {})
    dci = _get_dci(pack)
    dci_v2 = _get_dci_v2(pack)
    rci = _get_rci(pack)
    components = rci.get("components", {})

    lines.append(f"## PTA Contract Audit — Run {pack.get('run_id', '?')}")
    lines.append("")
    cov = pack.get("coverage", {})

    lines.append("### 1. System Snapshot")
    lines.append("")
    lines.append(f"| Measure | Value |")
    lines.append(f"|---------|-------|")
    lines.append(f"| Files Analyzed | {cov.get('analyzed_files', summary.get('total_files', 0))} |")
    lines.append(f"| Files Seen (incl. skipped) | {cov.get('total_files_seen', summary.get('total_files', 0))} |")
    lines.append(f"| Files Skipped | {cov.get('skipped_files', 0)} |")
    lines.append(f"| Claims Extracted | {summary.get('total_claims', 0)} |")
    lines.append(f"| Claims with Deterministic Evidence | {summary.get('verified_claims', 0)} |")
    lines.append(f"| Unknown Governance Categories | {summary.get('unknown_categories', 0)} |")
    lines.append(f"| Verified Structural Categories | {summary.get('verified_categories', 0)} |")
    lines.append(f"| Partial Coverage | {'Yes' if cov.get('partial', False) else 'No'} |")
    lines.append("")

    lines.append("### 2. Deterministic Coverage Index (DCI v1)")
    lines.append("")
    dci_score = dci.get('score', 0) or 0
    lines.append(f"**Score:** {dci_score:.2%}")
    lines.append(f"**Formula:** `{dci.get('formula', 'N/A')}`")
    lines.append("")
    lines.append(f"{summary.get('verified_claims', 0)} of {summary.get('total_claims', 0)} extracted claims contain hash-verified evidence.")
    lines.append("")
    lines.append("This measures claim-to-evidence visibility only.")
    lines.append("It does not measure code quality, security posture, or structural surface coverage.")
    lines.append("")

    lines.append("### 3. Reporting Completeness Index (RCI)")
    lines.append("")
    rci_score = rci.get('score', 0) or 0
    lines.append(f"**Score:** {rci_score:.2%}")
    lines.append(f"**Formula:** `{rci.get('formula', 'N/A')}`")
    lines.append("")
    lines.append("| Component | Score |")
    lines.append("|-----------|-------|")
    for k, v in components.items():
        lines.append(f"| {k} | {v:.2%} |")
    lines.append("")
    lines.append("RCI is a documentation completeness metric.")
    lines.append("It is not a security score and does not imply structural sufficiency.")
    lines.append("")

    lines.append("### 4. Structural Visibility (DCI v2)")
    lines.append("")
    lines.append(f"**Status:** {dci_v2.get('status', 'not_implemented')}")
    lines.append(f"**Formula (reserved):** `{dci_v2.get('formula', 'N/A')}`")
    lines.append("")
    lines.append("Routes, dependencies, schemas, and enforcement extractors are not active.")
    lines.append("Structural surface visibility is intentionally reported as null rather than estimated.")
    lines.append("This prevents silent overstatement of governance posture.")
    lines.append("")

    lines.append("### 5. Epistemic Posture")
    lines.append("")
    lines.append("PTA explicitly reports:")
    lines.append("- What is deterministically verified.")
    lines.append("- What is unknown.")
    lines.append("- What is not implemented.")
    lines.append("- What requires dedicated extractors.")
    lines.append("")
    lines.append("There is no inference-based promotion from UNKNOWN to VERIFIED.")
    lines.append("")

    lines.append("---")
    lines.append("")

    # --- Change Hotspots Section ---
    ch = pack.get("change_hotspots")
    if ch:
        lines.append(f"## Change hotspots (last {ch['window'].get('since', '?')})")
        lines.append("")
        top = ch.get("top") or []
        if not top:
            lines.append("No hotspots detected in the selected window.")
        else:
            lines.append("| Path | Score | Commits | Churn | Authors | Flags |")
            lines.append("| ---- | ----- | ------- | ----- | ------- | ----- |")
            for h in top:
                score = "{:.3f}".format(h.get("score", 0))
                churn = h.get("churn", {})
                added = churn.get("added") or 0
                deleted = churn.get("deleted") or 0
                churn_total = added + deleted
                flags = ", ".join(h.get("flags") or [])
                lines.append(f"| {h.get('path','')} | {score} | {h.get('commits',0)} | {churn_total} | {h.get('authors',0)} | {flags} |")
        lines.append("")

    verified_sections = _get_verified_sections(pack)
    for section_name, claims in sorted(verified_sections.items()):
        lines.append(f"## Verified: {section_name}")
        lines.append("")
        if not isinstance(claims, list) or not claims:
            lines.append("No verified claims in this section.")
            lines.append("")
            continue
        for claim in claims:
            lines.append(f"### {claim.get('statement', '?')}")
            lines.append(f"Confidence: {claim.get('confidence', 0):.0%}")
            for ev in claim.get("evidence", []):
                if isinstance(ev, dict):
                    lines.append(f"- Evidence: {_render_evidence_anchor(ev)}")
            lines.append("")

    structural = pack.get("verified_structural", {})
    has_structural = any(v for k, v in structural.items() if k != "_notes" and isinstance(v, list) and v)
    structural_notes = structural.get("_notes", {})

    lines.append("## Verified Structural (deterministic extractors only)")
    lines.append("")
    if has_structural:
        for bucket, items in sorted(structural.items()):
            if bucket == "_notes" or not isinstance(items, list) or not items:
                continue
            lines.append(f"### {bucket}")
            lines.append("")
            for item in items:
                lines.append(f"- {item.get('statement', '?')}")
                src = item.get("source", "")
                if src:
                    lines.append(f"  Source: `{src}`")
            lines.append("")
    for bucket, note in sorted(structural_notes.items()) if isinstance(structural_notes, dict) else []:
        lines.append(f"- **{bucket}**: {note}")
    if structural_notes:
        lines.append("")

    lines.append("## Known Unknown Surface")
    lines.append("")
    lines.append("| Category | Status | Notes |")
    lines.append("|----------|--------|-------|")
    for u in pack.get("unknowns", []):
        status = u.get("status", "UNKNOWN")
        lines.append(f"| {u.get('category', '?')} | {status} | {u.get('notes', '')} |")
    lines.append("")

    hashes = pack.get("hashes", {}).get("snippets", [])
    lines.append(f"## Snippet Hashes ({len(hashes)} total)")
    lines.append("")
    for h in hashes[:20]:
        lines.append(f"- `{h}`")
    if len(hashes) > 20:
        lines.append(f"- ... and {len(hashes) - 20} more")
    lines.append("")

    return "\n".join(lines)


def _render_auditor(pack: Dict[str, Any]) -> str:
    lines = [
        f"# Program Totality Report — Auditor View",
        f"",
        f"**EvidencePack Version:** {pack.get('evidence_pack_version', '?')}",
        f"**Generated:** {pack.get('generated_at', '?')}",
        f"",
        "This report shows only VERIFIED and UNKNOWN findings.",
        "No inferred narrative is included.",
        "",
        "---",
        "",
    ]

    lines.append("## Known Unknown Surface")
    lines.append("")
    lines.append("| Category | Status | Description | Evidence Anchors |")
    lines.append("|----------|--------|-------------|------------------|")
    for u in pack.get("unknowns", []):
        status = u.get("status", "UNKNOWN")
        ev_anchors = ", ".join(
            _render_evidence_anchor(e) for e in u.get("evidence", []) if isinstance(e, dict)
        ) or "—"
        lines.append(f"| {u.get('category', '?')} | **{status}** | {u.get('description', '')} | {ev_anchors} |")
    lines.append("")

    verified_sections = _get_verified_sections(pack)
    for section_name, claims in sorted(verified_sections.items()):
        if not isinstance(claims, list) or not claims:
            continue
        lines.append(f"## Verified: {section_name}")
        lines.append("")
        for claim in claims:
            lines.append(f"- **{claim.get('statement', '?')}**")
            lines.append(f"  Confidence: {claim.get('confidence', 0):.0%}")
            for ev in claim.get("evidence", []):
                if isinstance(ev, dict):
                    lines.append(f"  - Evidence anchor: {_render_evidence_anchor(ev)}")
            lines.append("")

    dci = _get_dci(pack)
    dci_v2 = _get_dci_v2(pack)
    rci = _get_rci(pack)
    lines.append("## DCI_v1_claim_visibility")
    lines.append("")
    lines.append(f"**{dci.get('score', 0):.2%}** — {dci.get('interpretation', '')}")
    lines.append("")
    lines.append("## DCI_v2_structural_visibility")
    lines.append("")
    lines.append(f"**Status:** {dci_v2.get('status', 'not_implemented')} — {dci_v2.get('interpretation', '')}")
    lines.append("")
    lines.append("## RCI_reporting_completeness")
    lines.append("")
    lines.append(f"**{rci.get('score', 0):.2%}** — {rci.get('interpretation', '')}")
    lines.append("")

    return "\n".join(lines)


def _render_executive(pack: Dict[str, Any]) -> str:
    summary = pack.get("summary", {})
    dci = _get_dci(pack)
    rci = _get_rci(pack)
    unknowns = pack.get("unknowns", [])
    unknown_count = len([u for u in unknowns if u.get("status") == "UNKNOWN"])
    verified_cat_count = len([u for u in unknowns if u.get("status") == "VERIFIED"])

    dci_v2 = _get_dci_v2(pack)

    lines = [
        f"# Program Totality Report — Executive Summary",
        f"",
        f"**Generated:** {pack.get('generated_at', '?')}",
        f"",
        "---",
        "",
        "## Key Metrics",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| DCI_v1_claim_visibility | {dci.get('score', 0):.1%} |",
        f"| DCI_v2_structural_visibility | {dci_v2.get('status', 'not_implemented')} |",
        f"| RCI_reporting_completeness | {rci.get('score', 0):.1%} |",
        f"| Files Scanned | {summary.get('total_files', 0)} |",
        f"| Total Claims | {summary.get('total_claims', 0)} |",
        f"| Verified Claims | {summary.get('verified_claims', 0)} |",
        f"| Unknown Categories | {unknown_count} / {len(unknowns)} |",
        f"| Verified Categories | {verified_cat_count} / {len(unknowns)} |",
        "",
        f"*DCI_v1_claim_visibility: {dci.get('interpretation', '')}*",
        f"*DCI_v2_structural_visibility: {dci_v2.get('interpretation', '')}*",
        f"*RCI_reporting_completeness: {rci.get('interpretation', '')}*",
        "",
        "## RCI Coverage Breakdown",
        "",
    ]

    components = rci.get("components", {})
    for k, v in components.items():
        bar_filled = int(v * 20)
        bar = "#" * bar_filled + "-" * (20 - bar_filled)
        lines.append(f"- **{k}**: [{bar}] {v:.0%}")
    lines.append("")

    lines.append("## Verified Surface Area")
    lines.append("")
    verified_sections = _get_verified_sections(pack)
    if verified_sections:
        for section_name, claims in sorted(verified_sections.items()):
            count = len(claims) if isinstance(claims, list) else 0
            lines.append(f"- {section_name}: {count} verified claim(s)")
    else:
        lines.append("- No verified claims with deterministic evidence.")
    lines.append("")

    if unknown_count > 0:
        lines.append("## Operational Blind Spots")
        lines.append("")
        lines.append("*The following categories lack deterministic evidence.*")
        lines.append("")
        for u in unknowns:
            if u.get("status") == "UNKNOWN":
                lines.append(f"- **{u.get('category', '?')}**: {u.get('description', '')}")
        lines.append("")

    return "\n".join(lines)
