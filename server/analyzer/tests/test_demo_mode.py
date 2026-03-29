import json
import hashlib
import re
import subprocess

_RUN_LINE = re.compile(r"(?m)^Run ID:\s*\S+\s*$")
_GEN_LINE = re.compile(r"(?m)^Generated:\s*.+$")
_HASH_LINE = re.compile(r"(?m)^Content hash:\s*`[^`]+`\s*$")

# Keys and string patterns that embed per-run timestamps / ids (still same analysis).
_VOLATILE_JSON_KEYS = frozenset({"run_id", "acquire_run_id", "generated_at"})


def hash_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _normalize_dossier_text(text: str) -> str:
    text = _RUN_LINE.sub("Run ID: <normalized>", text)
    text = _GEN_LINE.sub("Generated: <normalized>", text)
    text = _HASH_LINE.sub("Content hash: `<normalized>`", text)
    return text


def _scrub_volatile_json(obj):
    if isinstance(obj, dict):
        return {
            k: _scrub_volatile_json(v)
            for k, v in obj.items()
            if k not in _VOLATILE_JSON_KEYS
        }
    if isinstance(obj, list):
        return [_scrub_volatile_json(x) for x in obj]
    if isinstance(obj, str):
        if re.match(r"^\d{8}T\d{6}Z-[a-f0-9]{7,}$", obj):
            return "<compact-run-id>"
        if re.match(r"^[0-9a-f]{12}$", obj) and len(obj) == 12:
            return "<short-hex-id>"
    return obj


def _stable_json_payload(path) -> str:
    data = json.loads(path.read_text(encoding="utf-8"))
    return json.dumps(_scrub_volatile_json(data), indent=2, sort_keys=True)


def run_analyze(tmp_path, demo=False, out_name="out"):
    outdir = tmp_path / out_name
    outdir.mkdir(exist_ok=True)
    cmd = [
        "python3",
        "-m",
        "server.analyzer.src.analyzer_cli",
        "analyze",
        "./server/analyzer/tests/fixtures",
        "-o",
        str(outdir),
        "--no-llm",
    ]
    if demo:
        cmd.append("--demo")
    subprocess.run(cmd, check=True)
    return outdir


def _sole_run_dir(outdir):
    runs = sorted((outdir / "runs").iterdir())
    assert len(runs) == 1, f"expected exactly one run under {outdir / 'runs'}, got {len(runs)}"
    return runs[0]


def test_demo_outputs(tmp_path):
    outdir = run_analyze(tmp_path, demo=True)
    for art in ["DEMO_DOSSIER.md", "DEMO_SUMMARY.json"]:
        assert (outdir / "runs").exists()
        found = False
        for run in (outdir / "runs").iterdir():
            if (run / art).exists():
                found = True
        assert found, f"{art} not found in any run dir"


def test_normal_outputs_unchanged(tmp_path):
    outdir1 = run_analyze(tmp_path, demo=False, out_name="normal")
    outdir2 = run_analyze(tmp_path, demo=True, out_name="with_demo")
    for art in ["DOSSIER.md", "operate.json", "claims.json", "coverage.json"]:
        r1 = _sole_run_dir(outdir1)
        r2 = _sole_run_dir(outdir2)
        assert (r1 / art).exists(), f"missing {art} in normal run"
        assert (r2 / art).exists(), f"missing {art} in demo run"
        if art == "DOSSIER.md":
            t1 = _normalize_dossier_text((r1 / art).read_text(encoding="utf-8", errors="replace"))
            t2 = _normalize_dossier_text((r2 / art).read_text(encoding="utf-8", errors="replace"))
            assert t1 == t2, f"{art} changed between normal and demo run (after normalizing run id)"
        elif art.endswith(".json"):
            assert _stable_json_payload(r1 / art) == _stable_json_payload(r2 / art), (
                f"{art} changed between normal and demo run (after scrubbing volatile ids)"
            )
        else:
            assert hash_file(r1 / art) == hash_file(r2 / art), f"{art} changed between normal and demo run"


def test_demo_determinism(tmp_path):
    outdir1 = run_analyze(tmp_path, demo=True, out_name="demo_a")
    outdir2 = run_analyze(tmp_path, demo=True, out_name="demo_b")
    for art in ["DEMO_DOSSIER.md", "DEMO_SUMMARY.json"]:
        r1 = _sole_run_dir(outdir1)
        r2 = _sole_run_dir(outdir2)
        assert (r1 / art).exists()
        assert (r2 / art).exists()
        if art == "DEMO_DOSSIER.md":
            t1 = _normalize_dossier_text((r1 / art).read_text(encoding="utf-8", errors="replace"))
            t2 = _normalize_dossier_text((r2 / art).read_text(encoding="utf-8", errors="replace"))
            assert t1 == t2, f"{art} not deterministic across runs (after normalizing run id)"
        else:
            assert _stable_json_payload(r1 / art) == _stable_json_payload(r2 / art), (
                f"{art} not deterministic across runs (after scrubbing volatile ids)"
            )


def test_demo_summary_bullets(tmp_path):
    outdir = run_analyze(tmp_path, demo=True)
    for run in (outdir / "runs").iterdir():
        f = run / "DEMO_SUMMARY.json"
        if f.exists():
            data = json.load(open(f))
            bullets = data["sections"]["executive_summary"]
            assert len(bullets) <= 6
            for b in bullets:
                assert len(b["text"]) <= 120


def test_demo_evidence_snapshot(tmp_path):
    outdir = run_analyze(tmp_path, demo=True)
    for run in (outdir / "runs").iterdir():
        f = run / "DEMO_SUMMARY.json"
        if f.exists():
            data = json.load(open(f))
            snap = data["sections"]["evidence_snapshot"]
            types = set(x["status"] for x in snap)
            assert "VERIFIED" in types
            assert "INFERRED" in types
            assert "UNKNOWN" in types
