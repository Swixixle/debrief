import re
from pathlib import Path
from typing import Optional, Any

# Helper: Structured snippet evidence from first regex match
def make_evidence_from_first_match(repo_dir: Path, rel_path: str, pattern: str) -> Optional[dict]:
    p = repo_dir / rel_path
    if not p.exists():
        return None
    try:
        rx = re.compile(pattern)
    except re.error as e:
        print(f"WARNING: invalid regex pattern for evidence search: {pattern!r} ({e})", flush=True)
        return None
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return None
    for i, line in enumerate(lines, start=1):
        if rx.search(line):
            return make_evidence_from_line(rel_path, i, line)
    return None

# Safe evidence append utility
def _append_snippet_evidence_if_possible(item: Any, ev: Optional[dict]) -> None:
    if ev is None:
        return
    if not isinstance(item, dict):
        return
    for key in ("evidence", "evidence_items", "proof", "sources"):
        if key in item and isinstance(item[key], list):
            item[key].append(ev)
            return

# Recursively apply evidence to section
def _apply_ev_to_section(section_obj: Any, ev: Optional[dict]) -> None:
    if ev is None:
        return
    if isinstance(section_obj, dict):
        _append_snippet_evidence_if_possible(section_obj, ev)
        for nested_key in ("claims", "items", "steps", "entries", "rows"):
            if nested_key in section_obj:
                _apply_ev_to_section(section_obj[nested_key], ev)
    elif isinstance(section_obj, list):
        for x in section_obj:
            _apply_ev_to_section(x, ev)
import json
import platform
import traceback
import subprocess
from dataclasses import dataclass, asdict

# --- Phase 2 Reliability Hardening Helpers ---
@dataclass
class RunContext:
    repo_root: str
    output_dir: str
    mode: str
    render_mode: str
    no_llm: bool
    run_id: str
    git_sha: str
    python: str
    platform: str

def _utc_now_compact() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

def _safe_print(s: str) -> None:
    print(s, flush=True)

def run_stage(name: str, fn, ctx: RunContext):
    _safe_print(f"STAGE START: {name} | run_id={ctx.run_id} | sha={ctx.git_sha}")
    try:
        result = fn()
        _safe_print(f"STAGE END:   {name} | ok")
        return result
    except Exception as e:
        _safe_print(f"STAGE FAIL:  {name} | {type(e).__name__}: {e}")
        _safe_print("CONTEXT:")
        _safe_print(json.dumps(asdict(ctx), indent=2, sort_keys=True))
        _safe_print("TRACEBACK:")
        _safe_print(traceback.format_exc())
        raise

def _get_git_sha(repo_root: str) -> str:
    try:
        out = subprocess.check_output([
            "git", "rev-parse", "HEAD"
        ], cwd=repo_root, stderr=subprocess.DEVNULL, text=True).strip()
        return out if out else "unknown"
    except Exception:
        return "unknown"

def _validate_llm_or_fallback(self):
    if self.no_llm:
        return
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    if not api_key:
        _safe_print("WARNING: AI_INTEGRATIONS_OPENAI_API_KEY missing; falling back to no_llm=True")
        self.no_llm = True
        self.client = None
        return
import os
import json
import asyncio
import hashlib
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from rich.console import Console
import openai
from dotenv import load_dotenv
from datetime import datetime, timezone

from .core.acquire import acquire_target, AcquireResult
from .core.replit_profile import ReplitProfiler
from .core.evidence import make_evidence, make_evidence_from_line, make_file_exists_evidence, validate_evidence_list
from .core.unknowns import compute_known_unknowns
from .core.adapter import build_evidence_pack, save_evidence_pack
from .core.render import render_report, save_report, assert_pack_written
from .core.operate import build_operate, validate_operate
from .version import PTA_VERSION, OPERATE_SCHEMA_VERSION, TARGET_HOWTO_SCHEMA_VERSION
from .schema_validator import validate_operate_json, validate_target_howto_json

load_dotenv()


class Analyzer:



    def _artifact_path(self, filename: str) -> Path:
        # Canonical artifact path: always write to run_dir/filename
        return self.run_dir / filename

    def __init__(self, source: str, output_dir: str, mode: str = "github", root: Optional[str] = None, no_llm: bool = False, render_mode: str = "engineer"):
        self.source = source
        self.mode = mode
        self.output_dir = Path(output_dir)

        # --- Patch: define repo_dir as resolved project root for evidence helpers ---
        # Prefer explicit root arg if provided; otherwise infer from self.root or cwd
        if root is not None:
            self.repo_dir = Path(root).resolve()
        else:
            self.repo_dir = Path(self.root).resolve() if getattr(self, "root", None) else Path.cwd().resolve()
        self.packs_dir = self.output_dir / "packs"
        self.console = Console()
        self.replit_profile: Optional[Dict[str, Any]] = None
        self.acquire_result: Optional[AcquireResult] = None
        self.root_scope = root
        self._profiler: Optional[ReplitProfiler] = None
        self._self_skip_paths: set = set()
        self._skipped_count: int = 0
        self.no_llm = no_llm
        self.render_mode = render_mode


        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.packs_dir.mkdir(parents=True, exist_ok=True)


        self.client = None
        if not no_llm:
            self.client = openai.OpenAI(
                api_key=os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY"),
                base_url=os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

            )



    @staticmethod
    def get_console():
        return Console()

    def _detect_self_skip(self):
        analyzer_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        try:
            rel = os.path.relpath(analyzer_dir, self.repo_dir)
            if not rel.startswith(".."):
                self._self_skip_paths = {rel}
                return rel
        except ValueError:
            pass
        return None

    async def run(self, *, include_history=False, history_since="90d", history_top=15, history_include=None, history_exclude=None, demo=False):
        import json
        from pathlib import Path

        git_sha = _get_git_sha(str(self.repo_dir))
        run_id = f"{_utc_now_compact()}-{git_sha[:7] if git_sha != 'unknown' else 'nogit'}"
        base_output_dir = self.output_dir
        run_dir = base_output_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        self.run_dir = run_dir

        ctx = RunContext(
            repo_root=str(self.repo_dir),
            output_dir=str(run_dir),
            mode=self.mode,
            render_mode=self.render_mode,
            no_llm=self.no_llm,
            run_id=run_id,
            git_sha=git_sha,
            python=platform.python_version(),
            platform=f"{platform.system()} {platform.release()} ({platform.machine()})",
        )
        manifest_path = run_dir / "manifest.json"
        manifest_path.write_text(json.dumps(asdict(ctx), indent=2, sort_keys=True), encoding="utf-8")
        _safe_print(f"Manifest written: {manifest_path}")

        validator = getattr(self, "_validate_llm_or_fallback", None)
        if callable(validator):
            validator()
        ctx.no_llm = self.no_llm
        manifest_path.write_text(json.dumps(asdict(ctx), indent=2, sort_keys=True), encoding="utf-8")

        try:
            def acquire():
                self.console.print("[bold]Step 1: Acquiring target...[/bold]")
                self.acquire_result = acquire_target(
                    target=self.source if self.mode != "replit" else None,
                    replit_mode=(self.mode == "replit"),
                    output_dir=run_dir,
                )
                self.repo_dir = self.acquire_result.root_path
                self.mode = self.acquire_result.mode
                self.console.print(f"  Mode: {self.mode}, Root: {self.repo_dir}, RunID: {self.acquire_result.run_id}")
                if self.root_scope:
                    scoped = self.repo_dir / self.root_scope
                    if scoped.is_dir():
                        self.repo_dir = scoped
                    else:
                        self.console.print(f"[yellow]Warning:[/yellow] --root {self.root_scope} not found, using full target")
                return None
            run_stage("acquire_target", acquire, ctx)

            analyzer_self_root = self._detect_self_skip()

            file_index = run_stage("index_files", self.index_files, ctx)
            self.console.print(f"  Indexed {len(file_index)} files (skipped {self._skipped_count} self-files)")

            def create_packs():
                return self.create_evidence_packs(file_index)
            packs = run_stage("create_evidence_packs", create_packs, ctx)

            if self.mode == "replit":
                def replit_profile_stage():
                    self.console.print("[bold]Step 3b: Replit profiling...[/bold]")
                    profiler = ReplitProfiler(self.repo_dir, self_root=analyzer_self_root)
                    self._profiler = profiler
                    self.replit_profile = profiler.detect()
                    self.save_json("replit_profile.json", self.replit_profile)
                    packs["replit"] = json.dumps(self.replit_profile, indent=2, default=str)
                    self.console.print(f"  is_replit={self.replit_profile.get('is_replit')}, "
                                       f"secrets={len(self.replit_profile.get('required_secrets', []))}, "
                                       f"port={self.replit_profile.get('port_binding', {})}")
                run_stage("replit_profile", replit_profile_stage, ctx)

            if self.no_llm:
                def build_deterministic():
                    self.console.print("[bold]Step 4: Building deterministic howto (--no-llm)...[/bold]")
                    howto = self._build_deterministic_howto()
                    howto["completeness"] = self._compute_completeness(howto)
                    dossier = self._build_deterministic_dossier(howto)
                    claims = self._build_deterministic_claims(howto, file_index)
                    return howto, dossier, claims
                howto, dossier, claims = run_stage("build_deterministic", build_deterministic, ctx)
            else:
                async def extract_and_generate():
                    self.console.print("[bold]Step 4: Extracting how-to...[/bold]")
                    howto = await self.extract_howto(packs)
                    howto = self._normalize_howto_evidence(howto)
                    howto["completeness"] = self._compute_completeness(howto)
                    self.console.print("[bold]Step 5: Generating claims & dossier...[/bold]")
                    dossier, claims = await self.generate_dossier(packs, howto)
                    claims = self._verify_claims_evidence(claims)
                    return howto, dossier, claims
                howto, dossier, claims = await run_stage("extract_and_generate", extract_and_generate, ctx)

            howto = self._add_howto_metadata(howto)
            self.save_json("index.json", file_index)
            self.save_json_with_validation("target_howto.json", howto, validate_target_howto_json)
            self.save_json("claims.json", claims)
            replit_detected = self.replit_profile.get("replit_detected", False) if self.replit_profile else False
            replit_detection_ev = self.replit_profile.get("replit_detection_evidence", []) if self.replit_profile else []
            self.save_json("coverage.json", {
                "mode_requested": self.mode,
                "mode": self.mode,
                "run_id": self.acquire_result.run_id,
                "scanned": len(file_index),
                "skipped": self._skipped_count,
                "replit_detected": replit_detected,
                "replit_detection_evidence": replit_detection_ev,
                "is_replit": replit_detected,
                "self_skip": {
                    "enabled": bool(self._self_skip_paths),
                    "excluded_paths": list(self._self_skip_paths),
                    "excluded_file_count": self._skipped_count,
                    "reason": "Analyzer source files excluded to prevent false-positive pattern matches"
                }
            })
            with open(run_dir / "DOSSIER.md", "w") as f:
                f.write(dossier)

            def build_operate_stage():
                self.console.print("[bold]Step 5b: Building operate.json...[/bold]")
                operate = build_operate(
                    repo_dir=self.repo_dir,
                    file_index=file_index,
                    mode=self.mode,
                    replit_profile=self.replit_profile,
                )
                op_errors = validate_operate(operate)
                if op_errors:
                    self.console.print(f"  [yellow]operate.json validation warnings: {len(op_errors)}[/yellow]")
                    for e in op_errors[:5]:
                        self.console.print(f"    - {e}")
                self.save_json_with_validation("operate.json", operate, validate_operate_json)
                self.console.print(f"  operate.json saved ({len(operate.get('gaps', []))} gaps, "
                                   f"boot={operate.get('readiness', {}).get('boot', {}).get('score', 0)}%)")
            run_stage("build_operate", build_operate_stage, ctx)

            def compute_unknowns_stage():
                self.console.print("[bold]Step 6: Computing Known Unknowns...[/bold]")
                known_unknowns = compute_known_unknowns(
                    howto=howto,
                    claims=claims,
                    coverage={
                        "mode": self.mode,
                        "scanned": len(file_index),
                    },
                    file_index=file_index,
                )
                self.save_json("known_unknowns.json", known_unknowns)
                verified_count = len([u for u in known_unknowns if u["status"] == "VERIFIED"])
                unknown_count = len([u for u in known_unknowns if u["status"] == "UNKNOWN"])
                self.console.print(f"  {verified_count} VERIFIED, {unknown_count} UNKNOWN out of {len(known_unknowns)} categories")
                return known_unknowns
            known_unknowns = run_stage("compute_known_unknowns", compute_unknowns_stage, ctx)

            change_hotspots = None
            if include_history:
                def compute_hotspots_stage():
                    repo_path = str(self.repo_dir)
                    try:
                        opts = HistoryOptions(
                            repo_path=Path(repo_path).resolve(),
                            since=history_since,
                            top=max(1, history_top),
                            include_globs=_parse_globs(history_include),
                            exclude_globs=_parse_globs(history_exclude),
                        )
                        report = compute_hotspots_via_node(opts)
                        return {
                            "window": report["window"],
                            "totals": report["totals"],
                            "top": report.get("hotspots", [])[:history_top],
                        }
                    except Exception as e:
                        raise RuntimeError(f"Failed to compute git hotspots: {e}\nMake sure Node.js 22+ is installed and the Node CLI artifact is built.")
                change_hotspots = run_stage("compute_hotspots", compute_hotspots_stage, ctx)

            def build_evidence_pack_stage():
                self.console.print("[bold]Step 7: Building EvidencePack v1...[/bold]")
                evidence_pack = build_evidence_pack(
                    howto=howto,
                    claims=claims,
                    coverage={
                        "mode": self.mode,
                        "scanned": len(file_index),
                    },
                    file_index=file_index,
                    known_unknowns=known_unknowns,
                    replit_profile=self.replit_profile,
                    mode=self.mode,
                    run_id=self.acquire_result.run_id if self.acquire_result else None,
                    skipped_files=self._skipped_count,
                )
                if change_hotspots:
                    evidence_pack["change_hotspots"] = change_hotspots
                pack_path = save_evidence_pack(evidence_pack, run_dir)
                assert_pack_written(pack_path)
                self.console.print(f"  EvidencePack saved to {pack_path}")
                return evidence_pack
            evidence_pack = run_stage("build_evidence_pack", build_evidence_pack_stage, ctx)

            from .core.render import render_onboarding_guide, render_onepager
            manifest_excerpt = ""
            manifest_path_onb = run_dir / "manifest.json"
            if manifest_path_onb.exists():
                manifest_excerpt = manifest_path_onb.read_text(encoding="utf-8")[:1000]
            evidence_pack_excerpt = ""
            evidence_pack_path = run_dir / "evidence_pack.v1.json"
            if evidence_pack_path.exists():
                evidence_pack_excerpt = evidence_pack_path.read_text(encoding="utf-8")[:1000]
            dossier_excerpt = ""
            dossier_path_onb = run_dir / "DOSSIER.md"
            if dossier_path_onb.exists():
                dossier_excerpt = dossier_path_onb.read_text(encoding="utf-8")[:1000]
            evidence_pack["manifest_excerpt"] = manifest_excerpt
            evidence_pack["evidence_pack_excerpt"] = evidence_pack_excerpt
            evidence_pack["dossier_excerpt"] = dossier_excerpt
            onboarding_content = render_onboarding_guide(evidence_pack)
            with open(run_dir / "ONBOARDING_GUIDE.md", "w") as f:
                f.write(onboarding_content)
            onepager_content = render_onepager(evidence_pack)
            with open(run_dir / "ONEPAGER.md", "w") as f:
                f.write(onepager_content)

            def render_report_stage():
                self.console.print(f"[bold]Step 8: Rendering {self.render_mode} report...[/bold]")
                report_content = render_report(evidence_pack, mode=self.render_mode)
                report_path = save_report(report_content, run_dir, self.render_mode)
                self.console.print(f"  Report saved to {report_path}")
            run_stage("render_report", render_report_stage, ctx)

            _safe_print("[bold green]All outputs written.[/bold green]")
        except Exception:
            (run_dir / "FAILED").write_text("Analyzer run failed. See logs above.\n", encoding="utf-8")
            raise

    def index_files(self) -> List[str]:
        skip_dirs = {".git", "node_modules", "__pycache__", ".pythonlibs", ".cache",
                     ".local", ".config", "out", ".upm", ".replit_agent"}
        skip_extensions = {".lock", ".png", ".jpg", ".jpeg", ".gif", ".ico",
                           ".woff", ".woff2", ".ttf", ".eot", ".map"}
        file_list = []
        self._skipped_count = 0
        for root, dirs, files in os.walk(self.repo_dir):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            rel_root = os.path.relpath(root, self.repo_dir)
            if any(rel_root == sp or rel_root.startswith(sp + os.sep) for sp in self._self_skip_paths):
                self._skipped_count += len(files)
                continue
            for file in files:
                ext = os.path.splitext(file)[1]
                if ext in skip_extensions:
                    continue
                rel_path = os.path.relpath(os.path.join(root, file), self.repo_dir)
                file_list.append(rel_path)
        return file_list

    def create_evidence_packs(self, file_index: List[str]) -> Dict[str, str]:
        packs: Dict[str, List[str]] = {
            "docs": [],
            "config": [],
            "code": [],
            "ops": [],
        }

        for f in file_index:
            lower = f.lower()
            if "readme" in lower or ".md" in lower or "doc" in lower or "changelog" in lower:
                packs["docs"].append(f)
            elif any(cfg in lower for cfg in [
                "package.json", "requirements.txt", "pyproject.toml", "cargo.toml",
                "docker", ".env", "config", ".replit", "replit.nix", "makefile",
                "taskfile", ".github/workflows", "tsconfig", "vite.config",
            ]):
                packs["config"].append(f)
            elif any(ops in lower for ops in [
                "dockerfile", "docker-compose", ".github", "ci", "deploy", "k8s", "helm",
            ]):
                packs["ops"].append(f)
            elif any(ext in lower for ext in [
                ".ts", ".js", ".py", ".go", ".rs", ".java", ".rb", ".tsx", ".jsx",
            ]):
                packs["code"].append(f)

        evidence = {}
        for category, files in packs.items():
            content = ""
            limit = 30 if category == "config" else 20
            for f in files[:limit]:
                try:
                    text = (self.repo_dir / f).read_text(errors='ignore')
                    lines = text.splitlines()
                    line_limit = 300 if category == "config" else 500
                    numbered_lines = "\n".join(
                        [f"L{i+1}: {line}" for i, line in enumerate(lines[:line_limit])]
                    )
                    content += f"\n--- FILE: {f} ---\n{numbered_lines}\n"
                except Exception:
                    pass

            pack_content = content[:100000]
            evidence[category] = pack_content
            (self.packs_dir / f"{category}_pack.txt").write_text(pack_content)

        return evidence

    MAX_FILE_SIZE = 2 * 1024 * 1024
    MAX_SNIPPET_LINES = 50
    BINARY_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2",
                         ".ttf", ".eot", ".mp3", ".mp4", ".zip", ".tar", ".gz",
                         ".pdf", ".exe", ".dll", ".so", ".o", ".pyc", ".class"}

    def _safe_resolve_path(self, path: str) -> Optional[Path]:
        if ".." in path.split(os.sep) or ".." in path.split("/"):
            return None
        norm = os.path.normpath(path)
        if norm.startswith("..") or os.path.isabs(norm):
            return None
        ext = os.path.splitext(norm)[1].lower()
        if ext in self.BINARY_EXTENSIONS:
            return None
        repo_resolved = self.repo_dir.resolve()
        parts = Path(norm).parts
        candidate = self.repo_dir
        for part in parts:
            candidate = candidate / part
            if candidate.is_symlink():
                return None
        try:
            resolved = candidate.resolve()
            resolved.relative_to(repo_resolved)
        except ValueError:
            return None
        if not resolved.exists() or not resolved.is_file():
            return None
        try:
            size = resolved.stat().st_size
            if size > self.MAX_FILE_SIZE:
                return None
        except OSError:
            return None
        return resolved

    def _parse_evidence_string(self, ev_str: str) -> Optional[dict]:
        if not isinstance(ev_str, str):
            return ev_str if isinstance(ev_str, dict) else None
        m = re.match(r'^([^:]+):(\d+)(?:-(\d+))?', ev_str.strip())
        if not m:
            return None
        path = m.group(1)
        line_start = int(m.group(2))
        line_end = int(m.group(3)) if m.group(3) else line_start
        if line_end - line_start > self.MAX_SNIPPET_LINES:
            line_end = line_start + self.MAX_SNIPPET_LINES
        snippet = self._read_lines_from_repo(path, line_start, line_end)
        if snippet is None:
            return None
        return make_evidence(path, line_start, line_end, snippet)

    def _read_lines_from_repo(self, path: str, line_start: int, line_end: int = 0) -> Optional[str]:
        if line_end < line_start:
            line_end = line_start
        filepath = self._safe_resolve_path(path)
        if filepath is None:
            return None
        try:
            raw = filepath.read_bytes()
            if b'\x00' in raw[:4096]:
                return None
            content = raw.decode("utf-8", errors="ignore")
            lines = content.splitlines()
            if line_start < 1 or line_start > len(lines):
                return None
            clamped_end = min(line_end, len(lines))
            selected = lines[line_start - 1 : clamped_end]
            # Whitespace policy: lines are stripped (trimmed) before hashing.
            # This normalizes indentation differences and reduces noise in
            # evidence verification. Both make_evidence() and _verify_single_evidence()
            # use this same canonicalization, ensuring hash consistency.
            return "\n".join(line.strip() for line in selected)
        except Exception:
            pass
        return None

    def _read_line_from_repo(self, path: str, line_num: int) -> Optional[str]:
        return self._read_lines_from_repo(path, line_num, line_num)

    def _normalize_howto_evidence(self, howto: dict) -> dict:
        evidence_fields = ["install_steps", "config", "run_dev", "run_prod", "verification_steps", "common_failures"]
        for field in evidence_fields:
            items = howto.get(field, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if "evidence" in item and isinstance(item["evidence"], str):
                    parsed = self._parse_evidence_string(item["evidence"])
                    item["evidence"] = parsed if parsed else item["evidence"]

        rp = howto.get("replit_execution_profile", {})
        if isinstance(rp, dict):
            pb = rp.get("port_binding", {})
            if isinstance(pb, dict) and "evidence" in pb:
                ev_list = pb["evidence"]
                if isinstance(ev_list, list):
                    pb["evidence"] = [
                        self._parse_evidence_string(e) if isinstance(e, str) else e
                        for e in ev_list
                    ]
            secrets = rp.get("required_secrets", [])
            if isinstance(secrets, list):
                for s in secrets:
                    if "referenced_in" in s and isinstance(s["referenced_in"], list):
                        s["referenced_in"] = [
                            self._parse_evidence_string(r) if isinstance(r, str) else r
                            for r in s["referenced_in"]
                        ]
            obs = rp.get("observability", {})
            if isinstance(obs, dict) and "evidence" in obs:
                ev_list = obs["evidence"]
                if isinstance(ev_list, list):
                    obs["evidence"] = [
                        self._parse_evidence_string(e) if isinstance(e, str) else e
                        for e in ev_list
                    ]

        return howto

    def _verify_claims_evidence(self, claims_data: dict) -> dict:
        claims = claims_data.get("claims", [])
        for claim in claims:
            evidences = claim.get("evidence", [])
            verified = []
            for ev in evidences:
                if not isinstance(ev, dict):
                    parsed = self._parse_evidence_string(str(ev))
                    if parsed:
                        verified.append(parsed)
                    continue

                path = ev.get("path", "")
                line_start = ev.get("line_start", 0)
                if path and line_start > 0:
                    snippet = self._read_line_from_repo(path, line_start)
                    if snippet is not None:
                        correct_hash = hashlib.sha256(
                            snippet.encode("utf-8", errors="ignore")
                        ).hexdigest()[:12]
                        ev["snippet_hash"] = correct_hash
                        ev["snippet_hash_verified"] = True
                    else:
                        ev["snippet_hash_verified"] = False
                else:
                    ev["snippet_hash_verified"] = False

                verified.append(ev)

            claim["evidence"] = verified

            has_valid = any(
                isinstance(e, dict) and e.get("snippet_hash_verified", False)
                for e in verified
            )
            if not has_valid and claim.get("confidence", 0) > 0.20:
                claim["confidence"] = 0.20
                claim["status"] = "unverified"

        claims_data["claims"] = claims
        return claims_data

    def _verify_single_evidence(self, ev: dict) -> bool:
        path = ev.get("path", "")
        line_start = ev.get("line_start", 0)
        line_end = ev.get("line_end", line_start)
        claimed_hash = ev.get("snippet_hash", "")
        if not path or line_start <= 0 or not claimed_hash:
            return False
        snippet = self._read_lines_from_repo(path, line_start, line_end)
        if snippet is None:
            return False
        actual_hash = hashlib.sha256(
            snippet.encode("utf-8", errors="ignore")
        ).hexdigest()[:12]
        return actual_hash == claimed_hash

    def _compute_completeness(self, howto=None) -> dict:
        howto = howto or {}
        score = 0
        missing = []
        deductions = []

        def _is_verified_evidence(ev):
            if not isinstance(ev, dict):
                return False
            if ev.get("kind") == "file_exists":
                return (Path(self.repo_dir) / ev.get("path", "")).exists()
            if ev.get("snippet_hash_verified") is True:
                return True
            if ev.get("snippet_hash") and self._verify_single_evidence(ev):
                return True
            return False

        def _has_actionable_evidence(items, require_command=False):
            if not isinstance(items, list) or len(items) == 0:
                return False
            actionable_count = 0
            for s in items:
                ev = s.get("evidence")
                has_ev = _is_verified_evidence(ev)
                if require_command:
                    cmd = s.get("command")
                    has_cmd = isinstance(cmd, str) and len(cmd.strip()) > 0 and cmd.strip().lower() not in ("unknown", "null", "n/a", "none")
                    if has_ev and has_cmd:
                        actionable_count += 1
                else:
                    if has_ev:
                        actionable_count += 1
            return actionable_count > 0

        def _has_config_evidence(items):
            if not isinstance(items, list) or len(items) == 0:
                return False
            for c in items:
                ev = c.get("evidence")
                name = c.get("name", "")
                purpose = c.get("purpose", "")
                has_ev = _is_verified_evidence(ev)
                has_content = bool(name) and bool(purpose) and len(purpose) > 5
                if has_ev and has_content:
                    return True
            return False

        run_steps = howto.get("run_dev", [])
        if _has_actionable_evidence(run_steps, require_command=True):
            score += 20
        else:
            missing.append("run_dev: no step with both a runnable command and verified evidence")

        config = howto.get("config", [])
        if _has_config_evidence(config):
            score += 15
        else:
            missing.append("config: no config item with name+purpose+verified evidence")

        port_found = False
        rp = howto.get("replit_execution_profile", {})
        if isinstance(rp, dict):
            pb = rp.get("port_binding", {})
            if isinstance(pb, dict):
                ev_list = pb.get("evidence", [])
                if isinstance(ev_list, list) and any(
                    _is_verified_evidence(e) for e in ev_list
                ):
                    port_found = True
        if not port_found and self.replit_profile:
            rpb = self.replit_profile.get("port_binding", {})
            if isinstance(rpb, dict):
                ev_list = rpb.get("evidence", [])
                if isinstance(ev_list, list) and any(
                    _is_verified_evidence(e) for e in ev_list
                ):
                    port_found = True
        if port_found:
            score += 15
        else:
            missing.append("port_behavior: no port evidence with verified snippet_hash")

        verify = howto.get("verification_steps", [])
        if _has_actionable_evidence(verify, require_command=True):
            score += 20
        else:
            missing.append("verification_steps: no step with both a runnable command and verified evidence")

        examples = howto.get("usage_examples", [])
        valid_examples = [
            e for e in (examples if isinstance(examples, list) else [])
            if isinstance(e, dict) and e.get("description") and len(e.get("description", "")) > 5
        ]
        if len(valid_examples) >= 1:
            score += 15
        else:
            missing.append("usage_examples: no examples with meaningful descriptions")

        install = howto.get("install_steps", [])
        if _has_actionable_evidence(install, require_command=True):
            score += 15
        else:
            missing.append("install_steps: no step with both a runnable command and verified evidence")

        unknowns = howto.get("unknowns", [])
        if isinstance(unknowns, list) and len(unknowns) > 0:
            penalty = min(len(unknowns) * 3, 15)
            score = max(0, score - penalty)
            deductions.append(f"-{penalty} for {len(unknowns)} unknown(s)")

        notes_parts = list(deductions)
        if not (Path(self.repo_dir) / "Dockerfile").exists():
            notes_parts.append("No Dockerfile found")
        if unknowns:
            notes_parts.append(f"{len(unknowns)} unknown(s) reported")

        breakdown = {
            "score": score,
            "max": 100,
            "missing": missing,
            "deductions": deductions,
            "notes": "; ".join(notes_parts) if notes_parts else None
        }
        return breakdown

    async def extract_howto(self, packs: Dict[str, str]) -> Dict[str, Any]:
        replit_context = ""
        if self.mode == "replit" and self.replit_profile:
            replit_context = f"""
IMPORTANT: This is a Replit workspace. You MUST include a "replit_execution_profile" key in your JSON output.

The Replit profiler detected the following (use this as evidence):
{json.dumps(self.replit_profile, indent=2, default=str)}

The "replit_execution_profile" must contain:
- "run_command": string (from .replit file, cite .replit:<line>)
- "language": string
- "port_binding": object with port, binds_all_interfaces, uses_env_port, evidence array
- "required_secrets": array of {{"name": "VAR_NAME", "referenced_in": ["file:line"]}}
- "external_apis": array of {{"api": "name", "evidence_files": ["file"]}}
- "deployment_assumptions": array of strings
- "observability": object with logging, health_endpoint, evidence array
- "limitations": array of strings (things that could not be determined)

Every field must cite evidence. If no evidence exists, set value to null and add to "unknowns".
Do NOT invent information. If a field cannot be determined, mark it unknown.
Cap confidence at 0.20 for any claim without direct file:line evidence.
"""

        prompt = f"""You are an expert system operator. Analyze the provided evidence to extract a JSON 'Operator Manual' for the target system.

Output this exact JSON schema:
{{
    "prereqs": ["list of tools/runtimes needed"],
    "install_steps": [{{"step": "description", "command": "command or null", "evidence": "file:line or null"}}],
    "config": [{{"name": "env var or config file", "purpose": "what it does", "evidence": "file:line reference"}}],
    "run_dev": [{{"step": "description", "command": "command", "evidence": "file:line reference"}}],
    "run_prod": [{{"step": "description", "command": "command or unknown", "evidence": "file:line reference or null"}}],
    "usage_examples": [{{"description": "what it does", "command": "example command or API call"}}],
    "verification_steps": [{{"step": "description", "command": "command", "evidence": "file:line reference"}}],
    "common_failures": [{{"symptom": "what happens", "cause": "why", "fix": "how to fix"}}],
    "unknowns": [{{"what_is_missing": "description", "why_it_matters": "impact", "what_evidence_needed": "specific evidence"}}],
    "missing_evidence_requests": ["list of things that could not be verified"]
}}
{replit_context}

RULES:
- Every claim MUST cite evidence as file:line.
- If you cannot cite evidence, mark as unknown and add to "unknowns" AND "missing_evidence_requests".
- Do NOT invent instructions or steps that are not supported by the provided evidence.
- If a how-to step has no evidence, set confidence to 0.20 or lower.
"""

        user_content = (
            f"DOCS:\n{str(packs.get('docs', ''))[:40000]}\n\n"
            f"CONFIG:\n{str(packs.get('config', ''))[:40000]}\n\n"
            f"OPS:\n{str(packs.get('ops', ''))[:20000]}"
        )

        if "replit" in packs:
            user_content += f"\n\nREPLIT PROFILE:\n{str(packs['replit'])[:20000]}"

        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content}
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=8192,
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            self.console.print(f"[red]Error extracting howto:[/red] {e}")
            return {
                "error": str(e),
                "unknowns": [{"what_is_missing": "Full how-to extraction failed", "why_it_matters": "No operator manual available", "what_evidence_needed": "Retry or check API key"}],
            }

    async def generate_dossier(self, packs: Dict[str, str], howto: Dict[str, Any]) -> tuple[str, Dict[str, Any]]:
        replit_section = ""
        if self.mode == "replit" and self.replit_profile:
            replit_section = """
10. **Replit Execution Profile**
    Include ALL of the following subsections with evidence citations (file:line):
    - Run command (from .replit)
    - Language/runtime
    - Port binding (port number, 0.0.0.0 binding, env PORT usage)
    - Required secrets (names only, NEVER values, cite file:line where each is referenced)
    - External APIs referenced (with evidence files)
    - Nix packages required (from replit.nix)
    - Deployment assumptions
    - Observability/logging (present or absent, cite evidence)
    - Limitations (what could NOT be determined)
"""

        prompt = f"""You are the 'Program Totality Analyzer'. Write a Markdown DOSSIER about this target system based on static artifacts only.

SCOPE LIMITATION: This dossier is derived from static source artifacts (code, config, lockfiles). It does NOT observe runtime behavior, prove correctness, or certify security. Every claim must be labeled with its epistemic status.

MANDATORY SECTIONS:
1. **Identity of Target System** (What is it? What is it NOT?)
2. **Purpose & Jobs-to-be-done**
3. **Capability Map**
4. **Architecture Snapshot**
5. **How to Use the Target System** (Operator manual - refine the provided howto JSON into readable, actionable steps with evidence citations)
6. **Integration Surface** (APIs, webhooks, SDKs, data formats)
7. **Data & Security Posture** (Storage, encryption, auth, secret handling)
8. **Operational Reality** (What it takes to keep running)
9. **Maintainability & Change Risk**
{replit_section}
11. **Unknowns / Missing Evidence** (What could NOT be determined - be specific)
12. **Receipts** (Evidence index: list every file:line citation used above)

RULES:
- Every claim MUST cite evidence as (file:line) inline, pointing to actual source files in the target project.
- If no evidence exists for a claim, say "UNKNOWN — evidence needed: <describe>" and add to Unknowns section.
- Label each claim: VERIFIED (hash-anchored to source), INFERRED (derived from context but not hash-verified), or UNKNOWN.
- Do NOT hallucinate file paths or line numbers. Do NOT use vague adjectives. Be specific and operational.
- Do NOT cite PTA-generated output (dossier text, claims.json, evidence_pack) as evidence for claims. Evidence must reference the target system's own artifacts.
- The "How to Use" section must read like an actual operator manual with concrete commands.
- For Replit projects: the Replit Execution Profile section is MANDATORY.
- All secrets must be referenced by NAME only, never expose values.
"""

        howto_str = json.dumps(howto, indent=2, default=str)
        replit_str = ""
        if self.replit_profile:
            replit_str = f"\n\nREPLIT PROFILE (detected by static analysis):\n{json.dumps(self.replit_profile, indent=2, default=str)}"

        user_content = (
            f"HOWTO JSON:\n{howto_str}\n\n"
            f"DOCS:\n{packs.get('docs', '')[:30000]}\n\n"
            f"CONFIG:\n{packs.get('config', '')[:30000]}\n\n"
            f"CODE SNAPSHOT:\n{packs.get('code', '')[:40000]}"
            f"{replit_str}"
        )

        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content}
                ],
                max_completion_tokens=8192,
            )
            dossier = response.choices[0].message.content

            claims = await self._extract_claims(dossier, packs)

            return dossier, claims
        except Exception as e:
            self.console.print(f"[red]Error generating dossier:[/red] {e}")
            return f"# Analysis Error\n\nFailed to generate dossier: {e}", {"error": str(e)}

    def _repair_truncated_json(self, raw: str) -> Optional[dict]:
        raw = raw.strip()
        if not raw.startswith("{"):
            return None
        for attempt in range(5):
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
            raw = re.sub(r',\s*$', '', raw.rstrip())
            open_braces = raw.count("{") - raw.count("}")
            open_brackets = raw.count("[") - raw.count("]")
            in_string = False
            escape = False
            for ch in raw:
                if escape:
                    escape = False
                    continue
                if ch == '\\':
                    escape = True
                    continue
                if ch == '"':
                    in_string = not in_string
            if in_string:
                raw += '"'
            raw += "]" * max(0, open_brackets)
            raw += "}" * max(0, open_braces)
        return None

    async def _extract_claims(self, dossier: str, packs: Dict[str, str]) -> Dict[str, Any]:
        claims_prompt = """You are a claims extractor. Given a technical dossier and source evidence packs, extract the TOP 30 most important factual claims made in the dossier. Focus on architecture, runtime, dependencies, and security claims.

For each claim output:
{
  "claims": [
    {
      "id": "claim_NNN",
      "section": "section name from dossier",
      "statement": "the exact claim",
      "confidence": 0.0-1.0,
      "evidence": [
        {"path": "file.ext", "line_start": N, "line_end": N, "display": "file.ext:N"}
      ],
      "status": "evidenced | inferred | unknown"
    }
  ]
}

RULES:
- Limit to 30 claims maximum, prioritizing the most important ones
- confidence >= 0.80 only if evidence array is non-empty with valid file:line references
- confidence capped at 0.20 for claims with empty evidence or status "unknown"
- Do NOT fabricate snippet_hash values; the server computes them
- Every claim must have at least one evidence entry
- status "evidenced" = direct file:line proof; "inferred" = reasonable but indirect; "unknown" = no evidence"""

        user_content = (
            f"DOSSIER:\n{dossier[:30000]}\n\n"
            f"CONFIG EVIDENCE:\n{packs.get('config', '')[:15000]}\n\n"
            f"CODE EVIDENCE:\n{packs.get('code', '')[:15000]}"
        )

        try:
            response = self.client.chat.completions.create(
                model="gpt-4.1",
                messages=[
                    {"role": "system", "content": claims_prompt},
                    {"role": "user", "content": user_content}
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=16384,
            )
            raw = response.choices[0].message.content
            try:
                claims_data = json.loads(raw)
            except json.JSONDecodeError:
                self.console.print("[yellow]Claims JSON truncated, attempting repair...[/yellow]")
                claims_data = self._repair_truncated_json(raw)
                if not claims_data:
                    claims_data = {"claims": [], "parse_error": "JSON truncated and repair failed"}

            claims_data["mode"] = self.mode
            claims_data["run_id"] = self.acquire_result.run_id if self.acquire_result else None
            claims_data["is_replit"] = self.replit_profile is not None and self.replit_profile.get("is_replit", False)
            return claims_data
        except Exception as e:
            self.console.print(f"[red]Error extracting claims:[/red] {e}")
            return {
                "claims": [],
                "error": str(e),
                "mode": self.mode,
                "run_id": self.acquire_result.run_id if self.acquire_result else None,
                "is_replit": self.replit_profile is not None and self.replit_profile.get("is_replit", False),
            }

    def _build_deterministic_claims(self, howto: dict, file_index: List[str]) -> dict:
        claims = []
        claim_id = 0

        def _add(section: str, statement: str, confidence: float, evidence_list: list, status: str = "evidenced"):
            nonlocal claim_id
            claim_id += 1
            cid = f"claim_{claim_id:03d}"
            verified_ev = []
            for ev in evidence_list:
                if not isinstance(ev, dict):
                    continue
                if ev.get("kind") == "file_exists":
                    v = dict(ev)
                    v["verified"] = (Path(self.repo_dir) / ev.get("path", "")).exists()
                    if not v["verified"]:
                        confidence = min(confidence, 0.20)
                        status = "unverified"
                    verified_ev.append(v)
                elif ev.get("snippet_hash"):
                    v = dict(ev)
                    v["snippet_hash_verified"] = self._verify_single_evidence(ev)
                    if not v["snippet_hash_verified"]:
                        confidence = min(confidence, 0.20)
                        status = "unverified"
                    verified_ev.append(v)
            if not verified_ev:
                confidence = min(confidence, 0.20)
                if status == "evidenced":
                    status = "inferred"
            claims.append({
                "id": cid,
                "section": section,
                "statement": statement,
                "confidence": round(confidence, 2),
                "evidence": verified_ev,
                "status": status,
            })

        pkg_json = self.repo_dir / "package.json"
        if pkg_json.exists():
            try:
                pkg_lines = pkg_json.read_text(errors="ignore").splitlines()
                pkg = json.loads("\n".join(pkg_lines))
                name = pkg.get("name", "")
                if name:
                    ln = self._find_line(pkg_json, '"name"')
                    ev = make_evidence_from_line("package.json", ln, pkg_lines[ln - 1].strip()) if ln else None
                    _add("What the Target System Is", f"The project is named \"{name}\" (from package.json)", 0.60, [ev] if ev else [])
                desc = pkg.get("description", "")
                if desc:
                    ln = self._find_line(pkg_json, '"description"')
                    ev = make_evidence_from_line("package.json", ln, pkg_lines[ln - 1].strip()) if ln else None
                    _add("What the Target System Is", f"Project description: \"{desc}\"", 0.50, [ev] if ev else [])
                scripts = pkg.get("scripts", {})
                if scripts:
                    for sname in ["dev", "build", "start", "test"]:
                        if sname in scripts:
                            ln = self._find_line(pkg_json, f'"{sname}"')
                            ev = make_evidence_from_line("package.json", ln, pkg_lines[ln - 1].strip()) if ln else None
                            _add("How to Use the Target System", f"npm script \"{sname}\" runs: {scripts[sname]}", 0.60, [ev] if ev else [])
                deps = pkg.get("dependencies", {})
                key_deps = [d for d in deps if d in ("express", "fastify", "next", "react", "vue", "angular", "drizzle-orm", "prisma", "sequelize", "mongoose", "openai")]
                if key_deps:
                    ln = self._find_line(pkg_json, '"dependencies"')
                    ev = make_evidence_from_line("package.json", ln, pkg_lines[ln - 1].strip()) if ln else None
                    _add("Integration Surface", f"Key dependencies: {', '.join(key_deps)}", 0.50, [ev] if ev else [])
            except (json.JSONDecodeError, Exception):
                pass

        pyproject = self.repo_dir / "pyproject.toml"
        if pyproject.exists():
            try:
                lines = pyproject.read_text(errors="ignore").splitlines()
                for i, line in enumerate(lines):
                    if "name" in line and "=" in line and i < 20:
                        ev = make_evidence_from_line("pyproject.toml", i + 1, line.strip())
                        name_val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        _add("What the Target System Is", f"Python project named \"{name_val}\" (from pyproject.toml)", 0.50, [ev])
                        break
            except Exception:
                pass

        if self.replit_profile:
            rp = self.replit_profile
            pb = rp.get("port_binding", {})
            if isinstance(pb, dict) and pb.get("evidence"):
                ev_list = pb["evidence"] if isinstance(pb["evidence"], list) else []
                if pb.get("binds_all_interfaces"):
                    _add("How to Use the Target System", "Server binds to 0.0.0.0 (all interfaces)", 0.55, ev_list)
                if pb.get("uses_env_port"):
                    _add("How to Use the Target System", "Server port is configured via environment variable", 0.55, ev_list)

            secrets = rp.get("required_secrets", [])
            if secrets:
                secret_names = [s["name"] for s in secrets]
                first_ev = []
                for s in secrets:
                    refs = s.get("referenced_in", [])
                    if refs:
                        first_ev.append(refs[0])
                _add("Data & Security Posture", f"System requires {len(secrets)} secret(s): {', '.join(secret_names)}", 0.55, first_ev)
                for s in secrets:
                    refs = s.get("referenced_in", [])
                    name = s["name"]
                    _add("Data & Security Posture", f"Secret \"{name}\" is referenced in {len(refs)} file(s)", 0.50, refs[:2])

            apis = rp.get("external_apis", [])
            for api in apis:
                api_name = api.get("api", "unknown")
                api_ev = api.get("evidence_files", [])[:2]
                _add("Integration Surface", f"External API dependency: {api_name}", 0.45, api_ev)

            if rp.get("run_command"):
                replit_ev = rp.get("replit_file_parsed", {}).get("evidence", [])
                _add("How to Use the Target System", f"Replit run command: {rp['run_command']}", 0.55, replit_ev if isinstance(replit_ev, list) else [])

        ts_count = sum(1 for f in file_index if f.endswith((".ts", ".tsx")))
        js_count = sum(1 for f in file_index if f.endswith((".js", ".jsx")))
        py_count = sum(1 for f in file_index if f.endswith(".py"))
        langs = []
        if ts_count > 0:
            langs.append(f"TypeScript ({ts_count} files)")
        if js_count > 0:
            langs.append(f"JavaScript ({js_count} files)")
        if py_count > 0:
            langs.append(f"Python ({py_count} files)")
        if langs:
            _add("What the Target System Is", f"Primary languages: {', '.join(langs)}", 0.40, [], "inferred")

        has_server_dir = any(f.startswith("server/") or f.startswith("server\\") for f in file_index)
        has_client_dir = any(f.startswith("client/") or f.startswith("client\\") for f in file_index)
        if has_server_dir and has_client_dir:
            _add("What the Target System Is", "Project has both client/ and server/ directories (full-stack structure)", 0.40, [], "inferred")

        db_files = [f for f in file_index if any(kw in f.lower() for kw in ["schema", "migration", "drizzle", "prisma", "db."])]
        if db_files:
            db_ev = []
            for df in db_files[:2]:
                ln = 1
                try:
                    first_line = (self.repo_dir / df).read_text(errors="ignore").splitlines()[0].strip()
                    db_ev.append(make_evidence_from_line(df, 1, first_line))
                except Exception:
                    pass
            _add("Integration Surface", f"Database schema/migration files detected: {', '.join(db_files[:3])}", 0.40, db_ev)

        claims = claims[:30]

        return {
            "claims": claims,
            "mode": self.mode,
            "run_id": self.acquire_result.run_id if self.acquire_result else None,
            "is_replit": self.replit_profile is not None and self.replit_profile.get("is_replit", False),
        }

    def _build_deterministic_howto(self) -> dict:
        if not hasattr(self, "repo_dir") or self.repo_dir is None:
            self.repo_dir = Path(self.root).resolve() if getattr(self, "root", None) else Path.cwd().resolve()
        # --- Compute candidate snippet evidence for each section ---
        # --- Compute candidate snippet evidence for each section ---
        # Initialize howto with all required keys for schema compliance
        howto = {
            "prereqs": [],
            "install_steps": [],
            "config": [],
            "run_dev": [],
            "run_prod": [],
            "verification_steps": [],
            "usage_examples": [],
        }
        try:
            # --- Compute candidate snippet evidence for each section ---
            ev_install = (
                make_evidence_from_first_match(self.repo_dir, ".github/workflows/ci-tests.yml", r"setup-python|python-version")
                or make_evidence_from_first_match(self.repo_dir, ".replit", r"python-3\.(11|12)")
                or make_evidence_from_first_match(self.repo_dir, ".replit", r"^\s*run\s*=")
                or make_evidence_from_first_match(self.repo_dir, "pyproject.toml", r"^\[project\]|\[tool\.")
            )
            ev_run = (
                make_evidence_from_first_match(self.repo_dir, ".replit", r"^\s*run\s*=")
                or make_evidence_from_first_match(self.repo_dir, "server/analyzer/analyzer_cli.py", r"def\s+main\(|__name__\s*==\s*['\"]__main__['\"]")
            )
            ev_config_key = make_evidence_from_first_match(self.repo_dir, "server/analyzer/src/analyzer.py", r"AI_INTEGRATIONS_OPENAI_API_KEY")
            ev_config_limits = make_evidence_from_first_match(self.repo_dir, "server/analyzer/src/analyzer.py", r"MAX_REPO_BYTES|MAX_FILE_COUNT|MAX_SINGLE_FILE_BYTES")
            ev_port = (
                make_evidence_from_first_match(self.repo_dir, "Dockerfile", r"EXPOSE\s+5000|HEALTHCHECK.*5000")
            )
            ev_verify_ci = make_evidence_from_first_match(self.repo_dir, ".github/workflows/ci-tests.yml", r"preflight\.sh|pytest")
            ev_verify_preflight = make_evidence_from_first_match(self.repo_dir, "scripts/preflight.sh", r"compileall|pytest\s+-q")
            ev_examples_runs = make_evidence_from_first_match(self.repo_dir, "server/analyzer/src/analyzer.py", r"/runs/|run_id|manifest\.json")
            ev_examples_nollm = make_evidence_from_first_match(self.repo_dir, "server/analyzer/src/analyzer.py", r"no_llm|AI_INTEGRATIONS_OPENAI_API_KEY|falling back")
        except Exception as e:
            print(f"WARNING: Exception in _build_deterministic_howto (evidence assignment): {e}", flush=True)
            ev_install = ev_run = ev_config_key = ev_config_limits = ev_port = ev_verify_ci = ev_verify_preflight = ev_examples_runs = ev_examples_nollm = None

        # --- Apply snippet evidence to each section robustly ---
        try:
            for key, ev in [
                ("install_steps", ev_install),
                ("run_dev", ev_run),
                ("port", ev_port),
            ]:
                if key in howto:
                    _apply_ev_to_section(howto[key], ev)
            # Config: attach both key and limits if present
            if "config" in howto:
                _apply_ev_to_section(howto["config"], ev_config_key)
                _apply_ev_to_section(howto["config"], ev_config_limits)
            # Verification: attach both CI and preflight if present
            if "verification_steps" in howto:
                _apply_ev_to_section(howto["verification_steps"], ev_verify_ci)
                _apply_ev_to_section(howto["verification_steps"], ev_verify_preflight)
            # Usage examples: attach both run_dir and nollm fallback if present
            if "usage_examples" in howto:
                _apply_ev_to_section(howto["usage_examples"], ev_examples_runs)
                _apply_ev_to_section(howto["usage_examples"], ev_examples_nollm)
        except Exception as e:
            print(f"WARNING: Exception in _build_deterministic_howto (evidence attach): {e}", flush=True)
        return howto
        # After computing completeness, always write breakdown to run_dir
        breakdown = self._compute_completeness(...)
        _write_completeness_breakdown(self.run_dir, breakdown)
        # ...existing code...
        howto: Dict[str, Any] = {
            "prereqs": [],
            "install_steps": [],
            "config": [],
            "run_dev": [],
            "run_prod": [],
            "usage_examples": [],
            "verification_steps": [],
            "common_failures": [],
            "unknowns": [],
            "missing_evidence_requests": [],
        }

        pkg_json = self.repo_dir / "package.json"
        if pkg_json.exists():
            howto["prereqs"].append("Node.js")
            try:
                pkg_lines = pkg_json.read_text(errors="ignore").splitlines()
                pkg = json.loads("\n".join(pkg_lines))
                scripts = pkg.get("scripts", {})
                if "dev" in scripts:
                    line_num = self._find_line(pkg_json, '"dev"')
                    actual_line = pkg_lines[line_num - 1].strip() if line_num and line_num <= len(pkg_lines) else ""
                    ev = make_evidence_from_line("package.json", line_num, actual_line) if line_num else None
                    howto["run_dev"].append({"step": "Start dev server", "command": "npm run dev", "evidence": ev})
                if "build" in scripts:
                    line_num = self._find_line(pkg_json, '"build"')
                    actual_line = pkg_lines[line_num - 1].strip() if line_num and line_num <= len(pkg_lines) else ""
                    ev = make_evidence_from_line("package.json", line_num, actual_line) if line_num else None
                    howto["run_prod"].append({"step": "Build for production", "command": "npm run build", "evidence": ev})
                if "start" in scripts:
                    line_num = self._find_line(pkg_json, '"start"')
                    actual_line = pkg_lines[line_num - 1].strip() if line_num and line_num <= len(pkg_lines) else ""
                    ev = make_evidence_from_line("package.json", line_num, actual_line) if line_num else None
                    howto["run_prod"].append({"step": "Start production", "command": "npm start", "evidence": ev})

            except json.JSONDecodeError:
                pass

            if (self.repo_dir / "package-lock.json").exists():
                howto["install_steps"].append({
                    "step": "Install Node dependencies",
                    "command": "npm ci",
                    "evidence": make_file_exists_evidence("package-lock.json"),
                })
            elif (self.repo_dir / "pnpm-lock.yaml").exists():
                howto["install_steps"].append({
                    "step": "Install Node dependencies",
                    "command": "pnpm i",
                    "evidence": make_file_exists_evidence("pnpm-lock.yaml"),
                })
            elif (self.repo_dir / "yarn.lock").exists():
                howto["install_steps"].append({
                    "step": "Install Node dependencies",
                    "command": "yarn install",
                    "evidence": make_file_exists_evidence("yarn.lock"),
                })

        pyproject = self.repo_dir / "pyproject.toml"
        if pyproject.exists():
            howto["prereqs"].append("Python")
            if (self.repo_dir / "poetry.lock").exists():
                howto["install_steps"].append({
                    "step": "Install Python dependencies",
                    "command": "poetry install",
                    "evidence": make_file_exists_evidence("poetry.lock"),
                })
            else:
                howto["install_steps"].append({
                    "step": "Install Python dependencies",
                    "command": "pip install .",
                    "evidence": make_file_exists_evidence("pyproject.toml"),
                })

        requirements = self.repo_dir / "requirements.txt"
        if requirements.exists() and not pyproject.exists():
            howto["prereqs"].append("Python")
            howto["install_steps"].append({
                "step": "Install Python dependencies",
                "command": "pip install -r requirements.txt",
                "evidence": make_file_exists_evidence("requirements.txt"),
            })

        if self.replit_profile:
            rp = self.replit_profile
            howto["replit_execution_profile"] = {
                "run_command": rp.get("run_command"),
                "language": rp.get("language"),
                "port_binding": rp.get("port_binding"),
                "required_secrets": rp.get("required_secrets", []),
                "external_apis": rp.get("external_apis", []),
                "deployment_assumptions": rp.get("deployment_assumptions", []),
                "observability": rp.get("observability"),
                "limitations": ["Deterministic mode (--no-llm): no semantic analysis performed"],
            }
            for s in rp.get("required_secrets", []):
                howto["config"].append({
                    "name": s["name"],
                    "purpose": f"Secret referenced in code (see evidence)",
                    "evidence": s["referenced_in"][0] if s.get("referenced_in") else None,
                })

        howto["unknowns"].append({
            "what_is_missing": "Semantic analysis of code purpose and architecture",
            "why_it_matters": "Cannot determine system intent, integration patterns, or risk factors without LLM analysis",
            "what_evidence_needed": "Re-run without --no-llm flag for full analysis",
        })

        return howto

    def _find_line(self, filepath: Path, needle: str) -> Optional[int]:
        try:
            for i, line in enumerate(filepath.read_text(errors="ignore").splitlines(), 1):
                if needle in line:
                    return i
        except Exception:
            pass
        return None

    def _build_deterministic_dossier(self, howto: dict) -> str:
        lines = ["# Program Totality Analyzer — Deterministic Dossier", ""]
        lines.append("**Mode:** `--no-llm` (deterministic extraction only, no LLM calls)")
        lines.append("")

        lines.append("## 1. File Index Summary")
        lines.append(f"- Files scanned: see index.json")
        lines.append(f"- Self-skip: {self._skipped_count} analyzer files excluded")
        lines.append("")

        if self.replit_profile:
            rp = self.replit_profile
            lines.append("## 2. Replit Execution Profile")
            lines.append(f"- **Is Replit:** {rp.get('is_replit')}")
            lines.append(f"- **Run command:** `{rp.get('run_command', 'unknown')}`")
            lines.append(f"- **Language:** {rp.get('language', 'unknown')}")
            pb = rp.get("port_binding", {})
            if pb:
                port_val = pb.get('port')
                if port_val:
                    lines.append(f"- **Port:** {port_val}, binds_all={pb.get('binds_all_interfaces')}, env_port={pb.get('uses_env_port')}")
                else:
                    lines.append(f"- **Port:** Uses PORT env var; actual port determined at runtime. In Replit, PORT is injected.")
            secrets = rp.get("required_secrets", [])
            if secrets:
                lines.append(f"- **Secrets ({len(secrets)}):** {', '.join(s['name'] for s in secrets)}")
            apis = rp.get("external_apis", [])
            if apis:
                lines.append(f"- **External APIs:** {', '.join(a['api'] for a in apis)}")
            lines.append("")

        lines.append("## 3. Operator Manual (Deterministic)")
        howto_str = json.dumps(howto, indent=2, default=str)
        lines.append(f"```json\n{howto_str}\n```")
        lines.append("")

        lines.append("## 4. Limitations")
        lines.append("- This dossier was generated in `--no-llm` mode")
        lines.append("- No semantic analysis, claims extraction, or architecture inference was performed")
        lines.append("- For full analysis, re-run without `--no-llm`")

        return "\n".join(lines)

    def save_json(self, filename: str, data: Any):
        """Save JSON atomically using tmp file + rename."""
        import tempfile
        
        final_path = self.output_dir / filename
        # Create parent directory if needed
        final_path.parent.mkdir(parents=True, exist_ok=True)
        
        tmp_fd, tmp_path = tempfile.mkstemp(
            suffix='.tmp',
            prefix=f'.{filename}.',
            dir=str(final_path.parent)
        )
        
        try:
            with os.fdopen(tmp_fd, 'w') as f:
                json.dump(data, f, indent=2, default=str)
                f.flush()
                os.fsync(f.fileno())
            # Atomic rename (requires same filesystem)
            os.replace(tmp_path, final_path)
        except Exception as write_error:
            # Clean up tmp file on error
            try:
                os.unlink(tmp_path)
            except Exception as cleanup_error:
                # Log cleanup failure for operational visibility
                import sys
                print(f"Warning: Failed to cleanup tmp file {tmp_path}: {cleanup_error}", file=sys.stderr)
            raise write_error

    def save_json_with_validation(self, filename: str, data: Any, validator_func):
        """
        Save JSON with schema validation and atomic write.
        
        Validates first, then writes atomically using tmp file + rename.
        Raises error if validation fails - no file is written.
        """
        errors = validator_func(data)
        if errors:
            self.console.print(f"[red bold]FATAL: {filename} failed schema validation:[/red bold]")
            for error in errors[:10]:
                self.console.print(f"  [red]- {error}[/red]")
            raise ValueError(f"{filename} failed schema validation with {len(errors)} error(s)")
        
        # Validation passed - now save atomically
        self.save_json(filename, data)
        self.console.print(f"  [green]✓ {filename} validated against schema[/green]")

    def _add_howto_metadata(self, howto: Dict[str, Any]) -> Dict[str, Any]:
        """Add required metadata fields to target_howto.json for schema compliance."""
        # Create a new dict with metadata first
        result = {
            "schema_version": TARGET_HOWTO_SCHEMA_VERSION,
            "tool_version": PTA_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "target": {
                "mode": self.mode,
                "identifier": self.source,
                "run_id": self.acquire_result.run_id if self.acquire_result else "unknown"
            }
        }
        # Add all howto fields
        result.update(howto)
        return result
