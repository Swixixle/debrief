"""
Phase 4: Deterministic Diff Mode

Compares two EvidencePack v1 files and produces:
  - diff.json (machine-readable)
  - DIFF_REPORT.md (human-readable)

Only deterministic comparison signals are allowed:
  - Claim add/remove per section
  - Snippet hash changes within claims
  - Unknown category status delta
  - RCI / DCI delta

NOT allowed:
  - Interpreting risk
  - Calling something "more secure"
  - Generating vulnerability claims
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Set


def diff_packs(pack_a: Dict[str, Any], pack_b: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministic comparison of two EvidencePack v1 structures.
    Returns a diff object with added/removed/changed items per section.
    """
    verified_a = pack_a.get("verified", {})
    verified_b = pack_b.get("verified", {})
    all_sections = sorted(set(list(verified_a.keys()) + list(verified_b.keys())))

    sections_diff = {}
    for section in all_sections:
        items_a = verified_a.get(section, []) if isinstance(verified_a.get(section), list) else []
        items_b = verified_b.get(section, []) if isinstance(verified_b.get(section), list) else []
        sections_diff[section] = _diff_verified_items(items_a, items_b)

    diff: Dict[str, Any] = {
        "diff_version": "1.0",
        "pack_a": {
            "run_id": pack_a.get("run_id"),
            "generated_at": pack_a.get("generated_at"),
        },
        "pack_b": {
            "run_id": pack_b.get("run_id"),
            "generated_at": pack_b.get("generated_at"),
        },
        "verified_sections": sections_diff,
        "unknowns": _diff_unknowns(
            pack_a.get("unknowns", []),
            pack_b.get("unknowns", []),
        ),
        "snippet_hashes": _diff_hashes(
            pack_a.get("hashes", {}).get("snippets", []),
            pack_b.get("hashes", {}).get("snippets", []),
        ),
        "rci_delta": _diff_metric(
            pack_a.get("metrics", {}).get("rci_reporting_completeness", {}),
            pack_b.get("metrics", {}).get("rci_reporting_completeness", {}),
        ),
        "dci_delta": _diff_metric(
            pack_a.get("metrics", {}).get("dci_v1_claim_visibility", {}),
            pack_b.get("metrics", {}).get("dci_v1_claim_visibility", {}),
        ),
    }

    return diff


def save_diff(diff: Dict[str, Any], output_dir: Path) -> tuple:
    diff_json_path = output_dir / "diff.json"
    diff_report_path = output_dir / "DIFF_REPORT.md"

    with open(diff_json_path, "w") as f:
        json.dump(diff, f, indent=2, default=str)

    report = render_diff_report(diff)
    with open(diff_report_path, "w") as f:
        f.write(report)

    return diff_json_path, diff_report_path


def _diff_verified_items(items_a: List[Dict], items_b: List[Dict]) -> Dict[str, Any]:
    key_a = {item.get("statement", item.get("description", "")): item for item in items_a}
    key_b = {item.get("statement", item.get("description", "")): item for item in items_b}

    keys_a = set(key_a.keys())
    keys_b = set(key_b.keys())

    added = [key_b[k] for k in sorted(keys_b - keys_a)]
    removed = [key_a[k] for k in sorted(keys_a - keys_b)]

    changed = []
    for k in sorted(keys_a & keys_b):
        a_hashes = _extract_hashes_from_item(key_a[k])
        b_hashes = _extract_hashes_from_item(key_b[k])
        if a_hashes != b_hashes:
            changed.append({
                "statement": k,
                "old_hashes": sorted(a_hashes),
                "new_hashes": sorted(b_hashes),
                "confidence_delta": round(
                    key_b[k].get("confidence", 0) - key_a[k].get("confidence", 0), 4
                ),
            })

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "summary": f"+{len(added)} -{len(removed)} ~{len(changed)}",
    }


def _diff_unknowns(unknowns_a: List[Dict], unknowns_b: List[Dict]) -> Dict[str, Any]:
    cats_a = {u.get("category", ""): u for u in unknowns_a}
    cats_b = {u.get("category", ""): u for u in unknowns_b}

    status_changes = []
    for cat in sorted(set(list(cats_a.keys()) + list(cats_b.keys()))):
        a_status = cats_a.get(cat, {}).get("status", "MISSING")
        b_status = cats_b.get(cat, {}).get("status", "MISSING")
        if a_status != b_status:
            status_changes.append({
                "category": cat,
                "old_status": a_status,
                "new_status": b_status,
            })

    return {
        "status_changes": status_changes,
        "summary": f"{len(status_changes)} category status change(s)",
    }


def _diff_hashes(hashes_a: List[str], hashes_b: List[str]) -> Dict[str, Any]:
    set_a = set(hashes_a)
    set_b = set(hashes_b)

    return {
        "added": sorted(set_b - set_a),
        "removed": sorted(set_a - set_b),
        "unchanged": len(set_a & set_b),
        "summary": f"+{len(set_b - set_a)} -{len(set_a - set_b)} ={len(set_a & set_b)}",
    }


def _diff_metric(metric_a: Dict[str, Any], metric_b: Dict[str, Any]) -> Dict[str, Any]:
    score_a = metric_a.get("score", 0)
    score_b = metric_b.get("score", 0)
    delta = round(score_b - score_a, 4)

    components_a = metric_a.get("components", {})
    components_b = metric_b.get("components", {})

    component_deltas = {}
    all_keys = sorted(set(list(components_a.keys()) + list(components_b.keys())))
    for k in all_keys:
        va = components_a.get(k, 0)
        vb = components_b.get(k, 0)
        component_deltas[k] = round(vb - va, 4)

    direction = "improved" if delta > 0 else ("declined" if delta < 0 else "unchanged")

    return {
        "old_score": score_a,
        "new_score": score_b,
        "delta": delta,
        "direction": direction,
        "component_deltas": component_deltas,
    }


def _extract_hashes_from_item(item: Dict) -> Set[str]:
    hashes = set()
    ev = item.get("evidence")
    evs: list = []
    if isinstance(ev, dict):
        evs = [ev]
    elif isinstance(ev, list):
        evs = ev
    for e in evs:
        if isinstance(e, dict):
            h = e.get("snippet_hash", "")
            if h:
                hashes.add(h)
    return hashes


def render_diff_report(diff: Dict[str, Any]) -> str:
    lines = [
        "# PTA Diff Report",
        "",
        f"**Pack A:** run_id={diff.get('pack_a', {}).get('run_id', '?')} generated={diff.get('pack_a', {}).get('generated_at', '?')}",
        f"**Pack B:** run_id={diff.get('pack_b', {}).get('run_id', '?')} generated={diff.get('pack_b', {}).get('generated_at', '?')}",
        "",
        "---",
        "",
    ]

    dci = diff.get("dci_delta", {})
    lines.append("## DCI_v1_claim_visibility Delta")
    lines.append("")
    lines.append(f"- Old: {dci.get('old_score', 0):.2%}")
    lines.append(f"- New: {dci.get('new_score', 0):.2%}")
    lines.append(f"- Delta: {dci.get('delta', 0):+.2%} ({dci.get('direction', '?')})")
    lines.append("")

    rci = diff.get("rci_delta", {})
    lines.append("## RCI_reporting_completeness Delta")
    lines.append("")
    lines.append(f"- Old: {rci.get('old_score', 0):.2%}")
    lines.append(f"- New: {rci.get('new_score', 0):.2%}")
    lines.append(f"- Delta: {rci.get('delta', 0):+.2%} ({rci.get('direction', '?')})")
    for k, v in rci.get("component_deltas", {}).items():
        lines.append(f"  - {k}: {v:+.2%}")
    lines.append("")

    sections_diff = diff.get("verified_sections", {})
    for section_name in sorted(sections_diff.keys()):
        section = sections_diff[section_name]
        lines.append(f"## {section_name} ({section.get('summary', '')})")
        lines.append("")

        added = section.get("added", [])
        if added:
            lines.append("**Added:**")
            for item in added:
                lines.append(f"- {item.get('statement', item.get('description', '?'))}")
            lines.append("")

        removed = section.get("removed", [])
        if removed:
            lines.append("**Removed:**")
            for item in removed:
                lines.append(f"- {item.get('statement', item.get('description', '?'))}")
            lines.append("")

        changed = section.get("changed", [])
        if changed:
            lines.append("**Changed (evidence hash delta):**")
            for item in changed:
                lines.append(f"- {item.get('statement', '?')} (confidence delta: {item.get('confidence_delta', 0):+.0%})")
            lines.append("")

        if not added and not removed and not changed:
            lines.append("No changes detected.")
            lines.append("")

    unknowns = diff.get("unknowns", {})
    lines.append(f"## Unknown Category Changes ({unknowns.get('summary', '')})")
    lines.append("")
    for change in unknowns.get("status_changes", []):
        lines.append(f"- **{change.get('category', '?')}**: {change.get('old_status', '?')} -> {change.get('new_status', '?')}")
    if not unknowns.get("status_changes"):
        lines.append("No category status changes.")
    lines.append("")

    hashes = diff.get("snippet_hashes", {})
    lines.append(f"## Snippet Hash Changes ({hashes.get('summary', '')})")
    lines.append("")
    added_h = hashes.get("added", [])
    removed_h = hashes.get("removed", [])
    if added_h:
        lines.append(f"**New hashes:** {len(added_h)}")
        for h in added_h[:10]:
            lines.append(f"- `{h}`")
        if len(added_h) > 10:
            lines.append(f"- ... and {len(added_h) - 10} more")
        lines.append("")
    if removed_h:
        lines.append(f"**Removed hashes:** {len(removed_h)}")
        for h in removed_h[:10]:
            lines.append(f"- `{h}`")
        if len(removed_h) > 10:
            lines.append(f"- ... and {len(removed_h) - 10} more")
        lines.append("")
    lines.append(f"Unchanged: {hashes.get('unchanged', 0)}")
    lines.append("")

    return "\n".join(lines)
