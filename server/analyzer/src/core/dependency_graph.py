"""
Extract direct dependencies from common lockfiles and query OSV.dev for known CVEs.
Outputs dependency_graph.json structure + DEPENDENCIES.md text.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None  # type: ignore


@dataclass
class Dep:
    name: str
    version: str
    ecosystem: str
    kind: str  # production | development
    source_file: str
    license: Optional[str] = None
    osv_vulnerable: bool = False
    osv_ids: List[str] = field(default_factory=list)

    def as_json_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d


def _read_text(p: Path, limit: int = 2_000_000) -> Optional[str]:
    try:
        raw = p.read_bytes()[:limit]
        if b"\x00" in raw[:4096]:
            return None
        return raw.decode("utf-8", errors="replace")
    except OSError:
        return None


def _parse_package_json_dev_names(repo: Path) -> Tuple[Set[str], Set[str]]:
    """Return (prod_names, dev_names) from package.json if present."""
    prod: Set[str] = set()
    dev: Set[str] = set()
    pj = repo / "package.json"
    if not pj.is_file():
        return prod, dev
    try:
        data = json.loads(pj.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return prod, dev
    for k, bucket in (("dependencies", prod), ("optionalDependencies", prod), ("devDependencies", dev)):
        if isinstance(data.get(k), dict):
            bucket.update(data[k].keys())
    return prod, dev


def _parse_package_lock(repo: Path, dev_names: Set[str]) -> List[Dep]:
    pl = repo / "package-lock.json"
    if not pl.is_file():
        return []
    try:
        data = json.loads(pl.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return []
    out: List[Dep] = []
    lock_ver = data.get("lockfileVersion", 1)
    if lock_ver >= 2:
        packages = data.get("packages") or {}
        root_deps = (data.get("dependencies") or {}).keys()
        for rel_path, meta in packages.items():
            if not rel_path or rel_path == "":
                continue
            if not rel_path.startswith("node_modules/"):
                continue
            name = meta.get("name")
            if not name:
                parts = rel_path.split("node_modules/")
                name = parts[-1].split("/")[-1] if parts else None
            if not name:
                continue
            ver = meta.get("version") or ""
            if not ver:
                continue
            # Top-level direct deps appear as immediate children of root node_modules in v2+
            depth = rel_path.count("node_modules")
            if depth != 1:
                continue
            kind = "development" if name in dev_names else "production"
            lic = None
            if isinstance(meta.get("license"), str):
                lic = meta["license"]
            elif isinstance(meta.get("license"), dict):
                lic = meta["license"].get("type")
            out.append(Dep(name=name, version=ver, ecosystem="npm", kind=kind, source_file="package-lock.json", license=lic))
        return out
    # lock v1
    deps = data.get("dependencies") or {}
    for name, meta in deps.items():
        if not isinstance(meta, dict):
            continue
        ver = meta.get("version") or ""
        if not ver:
            continue
        kind = "development" if name in dev_names else "production"
        out.append(Dep(name=name, version=ver, ecosystem="npm", kind=kind, source_file="package-lock.json"))
    return out


def _parse_yarn_lock(repo: Path, dev_names: Set[str]) -> List[Dep]:
    yl = repo / "yarn.lock"
    if not yl.is_file():
        return []
    text = _read_text(yl)
    if not text:
        return []
    out: List[Dep] = []
    # Split into blocks; first line is "pkg@range:" (Yarn v1 / Berry-ish)
    for block in re.split(r"\n(?=[^ \n#/])", text):
        lines = [ln for ln in block.split("\n") if ln.strip() and not ln.strip().startswith("#")]
        if not lines:
            continue
        head = lines[0].rstrip(":").strip().strip('"')
        if "@" not in head:
            continue
        at = head.rfind("@")
        if at <= 0:
            continue
        pkg = head[:at].strip('"')
        ver_line = next((ln for ln in lines if ln.strip().startswith("version ")), "")
        m = re.search(r'version\s+"([^"]+)"', ver_line)
        if not m:
            continue
        ver = m.group(1)
        kind = "development" if pkg in dev_names else "production"
        out.append(Dep(name=pkg, version=ver, ecosystem="npm", kind=kind, source_file="yarn.lock"))
    return out


def _parse_pnpm_lock(repo: Path, dev_names: Set[str]) -> List[Dep]:
    pl = repo / "pnpm-lock.yaml"
    if not pl.is_file() or yaml is None:
        return []
    try:
        data = yaml.safe_load(pl.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return []
    if not isinstance(data, dict):
        return []
    out: List[Dep] = []
    importers = data.get("importers") or {}
    root = importers.get(".") or importers.get("") or data.get("importers", {})
    if isinstance(root, dict) and "dependencies" not in root and "." in importers:
        root = importers.get(".", {})
    if not isinstance(root, dict):
        return []
    for section, kind_default in (("dependencies", "production"), ("devDependencies", "development")):
        sect = root.get(section)
        if not isinstance(sect, dict):
            continue
        for name, spec in sect.items():
            ver = ""
            if isinstance(spec, str):
                ver = spec.lstrip("^~>=<")
            elif isinstance(spec, dict):
                ver = str(spec.get("version", "")).lstrip("^~>=<")
            if not ver:
                continue
            kind = "development" if name in dev_names or section == "devDependencies" else "production"
            out.append(Dep(name=name, version=ver, ecosystem="npm", kind=kind, source_file="pnpm-lock.yaml"))
    return out


def _parse_requirements_txt(repo: Path) -> List[Dep]:
    req = repo / "requirements.txt"
    if not req.is_file():
        return []
    out: List[Dep] = []
    for line in req.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # name==1.0 or name>=1.0
        m = re.match(r"^([a-zA-Z0-9_\-\.\[\]]+)(?:\[[^\]]+\])?\s*[=<>!~]+\s*([0-9a-zA-Z\.\-\+]+)", line)
        if m:
            out.append(Dep(name=m.group(1).lower(), version=m.group(2), ecosystem="PyPI", kind="production", source_file="requirements.txt"))
            continue
        m2 = re.match(r"^([a-zA-Z0-9_\-\.]+)", line)
        if m2 and "://" not in line:
            out.append(Dep(name=m2.group(1).lower(), version="", ecosystem="PyPI", kind="production", source_file="requirements.txt"))
    return out


def _parse_pipfile_lock(repo: Path) -> List[Dep]:
    pl = repo / "Pipfile.lock"
    if not pl.is_file():
        return []
    try:
        data = json.loads(pl.read_text(encoding="utf-8", errors="replace"))
    except (json.JSONDecodeError, OSError):
        return []
    out: List[Dep] = []
    for section, kind in (("default", "production"), ("develop", "development")):
        block = data.get(section) or {}
        if not isinstance(block, dict):
            continue
        for name, meta in block.items():
            if name == "_meta":
                continue
            ver = ""
            if isinstance(meta, dict):
                ver = meta.get("version", "") or ""
                ver = ver.lstrip("=")
            out.append(Dep(name=name.lower(), version=ver, ecosystem="PyPI", kind=kind, source_file="Pipfile.lock"))
    return out


def _parse_pyproject_toml(repo: Path) -> List[Dep]:
    pp = repo / "pyproject.toml"
    if not pp.is_file():
        return []
    try:
        data = tomllib.loads(pp.read_text(encoding="utf-8", errors="replace"))
    except (tomllib.TOMLDecodeError, OSError):
        return []
    out: List[Dep] = []
    project = data.get("project") or {}
    deps = project.get("dependencies") or []
    if isinstance(deps, list):
        for d in deps:
            if isinstance(d, str):
                m = re.match(r"^([a-zA-Z0-9\-\._]+)(?:\[[^\]]+\])?\s*(.*)$", d.strip())
                if m:
                    name = m.group(1).lower()
                    rest = m.group(2).strip()
                    ver = ""
                    mv = re.search(r"([\d\.]+[a-z0-9\.\-]*)", rest)
                    if mv:
                        ver = mv.group(1)
                    out.append(Dep(name=name, version=ver, ecosystem="PyPI", kind="production", source_file="pyproject.toml"))
    opt = project.get("optional-dependencies") or {}
    if isinstance(opt, dict):
        for grp, lst in opt.items():
            if grp.lower() in ("dev", "test", "docs") and isinstance(lst, list):
                for d in lst:
                    if isinstance(d, str):
                        m = re.match(r"^([a-zA-Z0-9\-\._]+)", d.strip())
                        if m:
                            out.append(Dep(name=m.group(1).lower(), version="", ecosystem="PyPI", kind="development", source_file="pyproject.toml"))
    return out


def _parse_gemfile_lock(repo: Path) -> List[Dep]:
    gl = repo / "Gemfile.lock"
    if not gl.is_file():
        return []
    text = gl.read_text(encoding="utf-8", errors="replace")
    out: List[Dep] = []
    in_specs = False
    for line in text.splitlines():
        if line.strip() == "GEM":
            in_specs = False
        if line.strip() == "specs:":
            in_specs = True
            continue
        if in_specs and line.startswith("      "):
            m = re.match(r"^\s+([a-zA-Z0-9_\-]+)\s+\(([^)]+)\)", line)
            if m:
                out.append(Dep(name=m.group(1), version=m.group(2), ecosystem="RubyGems", kind="production", source_file="Gemfile.lock"))
    return out


def _parse_go_sum(repo: Path) -> List[Dep]:
    gs = repo / "go.sum"
    if not gs.is_file():
        return []
    seen: Set[Tuple[str, str]] = set()
    out: List[Dep] = []
    for line in gs.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) >= 2:
            mod, ver = parts[0], parts[1]
            if ver.startswith("v") or re.match(r"^v?\d+\.\d+", ver):
                key = (mod, ver)
                if key not in seen:
                    seen.add(key)
                    base = mod.split("/")[-1]
                    out.append(Dep(name=base, version=ver, ecosystem="Go", kind="production", source_file="go.sum"))
    return out[:500]


def _parse_cargo_lock(repo: Path) -> List[Dep]:
    cl = repo / "Cargo.lock"
    if not cl.is_file():
        return []
    try:
        data = tomllib.loads(cl.read_text(encoding="utf-8", errors="replace"))
    except (tomllib.TOMLDecodeError, OSError):
        return []
    pkgs = data.get("package")
    if not isinstance(pkgs, list):
        return []
    out: List[Dep] = []
    for p in pkgs:
        if not isinstance(p, dict):
            continue
        name = p.get("name")
        ver = p.get("version")
        if name and ver:
            out.append(Dep(name=name, version=ver, ecosystem="crates.io", kind="production", source_file="Cargo.lock"))
    return out


def collect_dependencies(repo_dir: Path) -> Tuple[List[Dep], List[str]]:
    repo = repo_dir.resolve()
    prod_names, dev_names = _parse_package_json_dev_names(repo)
    lockfiles: List[str] = []
    all_deps: List[Dep] = []

    parsers = [
        ("package-lock.json", lambda: _parse_package_lock(repo, dev_names)),
        ("yarn.lock", lambda: _parse_yarn_lock(repo, dev_names)),
        ("pnpm-lock.yaml", lambda: _parse_pnpm_lock(repo, dev_names)),
        ("requirements.txt", lambda: _parse_requirements_txt(repo)),
        ("Pipfile.lock", lambda: _parse_pipfile_lock(repo)),
        ("pyproject.toml", lambda: _parse_pyproject_toml(repo)),
        ("Gemfile.lock", lambda: _parse_gemfile_lock(repo)),
        ("go.sum", lambda: _parse_go_sum(repo)),
        ("Cargo.lock", lambda: _parse_cargo_lock(repo)),
    ]
    for fname, fn in parsers:
        p = repo / fname
        if p.is_file():
            lockfiles.append(fname)
            try:
                all_deps.extend(fn())
            except Exception as e:
                print(f"WARNING: dependency parse failed for {fname}: {e}", file=sys.stderr)

    # Deduplicate by (ecosystem, name, version, source)
    uniq: Dict[Tuple[str, str, str, str], Dep] = {}
    for d in all_deps:
        key = (d.ecosystem, d.name.lower(), d.version, d.source_file)
        if key not in uniq:
            uniq[key] = d
    merged = list(uniq.values())
    return merged, lockfiles


def osv_query_batch(deps: List[Dep], timeout: float = 45.0) -> None:
    """Annotate deps in-place with OSV vulnerability flags (batched)."""
    # Only query entries with name + version
    to_query = [d for d in deps if d.version and d.name]
    if not to_query:
        return
    batch_size = 80
    for i in range(0, len(to_query), batch_size):
        chunk = to_query[i : i + batch_size]
        queries = []
        ecosystem_map = {
            "npm": "npm",
            "PyPI": "PyPI",
            "RubyGems": "RubyGems",
            "Go": "Go",
            "crates.io": "crates.io",
        }
        for d in chunk:
            eco = ecosystem_map.get(d.ecosystem, d.ecosystem)
            queries.append({"package": {"name": d.name, "ecosystem": eco}, "version": d.version})
        body = json.dumps({"queries": queries}).encode("utf-8")
        req = urllib.request.Request(
            "https://api.osv.dev/v1/querybatch",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                data = json.loads(raw)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as e:
            print(f"WARNING: OSV batch query failed: {e}", file=sys.stderr)
            continue
        results = data.get("results") or []
        if len(results) != len(chunk):
            continue
        for dep, res in zip(chunk, results):
            vulns = res.get("vulns") or []
            # OSV returns vulns as list of {id: ...}
            ids: List[str] = []
            if isinstance(vulns, list):
                for v in vulns:
                    if isinstance(v, dict) and v.get("id"):
                        ids.append(str(v["id"]))
                    elif isinstance(v, str):
                        ids.append(v)
            if ids:
                dep.osv_vulnerable = True
                dep.osv_ids = ids[:5]


def build_dependency_graph(repo_dir: Path) -> Dict[str, Any]:
    deps, lockfiles = collect_dependencies(repo_dir)
    osv_query_batch(deps)
    prod = [d for d in deps if d.kind == "production"]
    dev = [d for d in deps if d.kind == "development"]
    flagged = [d for d in deps if d.osv_vulnerable]
    by_eco: Dict[str, int] = {}
    for d in deps:
        by_eco[d.ecosystem] = by_eco.get(d.ecosystem, 0) + 1
    graph = {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "lockfiles_detected": lockfiles,
        "summary": {
            "direct_total": len(deps),
            "direct_production": len(prod),
            "direct_development": len(dev),
            "flagged_cve_count": len(flagged),
            "count_by_ecosystem": by_eco,
        },
        "dependencies": [d.as_json_dict() for d in sorted(deps, key=lambda x: (x.ecosystem, x.name.lower()))],
    }
    return graph


def render_dependencies_md(graph: Dict[str, Any]) -> str:
    s = graph.get("summary") or {}
    lines = [
        "# Dependency inventory",
        "",
        f"- **Direct dependencies (total):** {s.get('direct_total', 0)}",
        f"- **Production:** {s.get('direct_production', 0)} · **Development:** {s.get('direct_development', 0)}",
        f"- **OSV-flagged (known vulnerabilities):** {s.get('flagged_cve_count', 0)}",
        "",
        "## Lockfiles used",
        "",
    ]
    for lf in graph.get("lockfiles_detected") or []:
        lines.append(f"- `{lf}`")
    if not graph.get("lockfiles_detected"):
        lines.append("- _(none detected)_")
    lines.extend(["", "## Table", "", "| Name | Version | Kind | Ecosystem | License | CVE flag | OSV IDs | Source |", "|------|---------|------|-----------|---------|--------|---------|--------|"])
    for d in graph.get("dependencies") or []:
        flag = "yes" if d.get("osv_vulnerable") else ""
        ids = ", ".join(d.get("osv_ids") or [])[:80]
        lic = d.get("license") or ""
        lines.append(
            f"| {d.get('name','')} | {d.get('version','')} | {d.get('kind','')} | {d.get('ecosystem','')} | {lic} | {flag} | {ids} | `{d.get('source_file','')}` |"
        )
    lines.extend(["", "_CVE flags via [OSV.dev](https://osv.dev) batch API — point-in-time; re-run for current data._", ""])
    return "\n".join(lines)
