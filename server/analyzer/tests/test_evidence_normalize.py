"""Tests for LLM evidence string normalization (L-prefix, comma-separated)."""

import tempfile
import unittest
from pathlib import Path

from server.analyzer.src.analyzer import Analyzer


class TestEvidenceNormalize(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "server").mkdir(parents=True)
        lines_ts = "\n".join(f"// line {i}" for i in range(1, 81))
        (self.root / "server" / "config.ts").write_text(lines_ts + "\n", encoding="utf-8")
        (self.root / ".env.example").write_text("FOO=1\nBAR=2\n", encoding="utf-8")
        self.out = self.root / "out"
        self.out.mkdir()
        self.an = Analyzer(
            str(self.root),
            str(self.out),
            mode="local",
            root=str(self.root),
            no_llm=True,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_parse_l_prefix_single_line(self):
        ev = self.an._parse_evidence_string(".env.example:L2")
        self.assertIsNotNone(ev)
        assert ev is not None
        self.assertEqual(ev.get("path"), ".env.example")
        self.assertEqual(ev.get("line_start"), 2)

    def test_parse_l_prefix_range(self):
        ev = self.an._parse_evidence_string("server/config.ts:L55-57")
        self.assertIsNotNone(ev)
        assert ev is not None
        self.assertEqual(ev.get("path"), "server/config.ts")
        self.assertEqual(ev.get("line_start"), 55)
        self.assertEqual(ev.get("line_end"), 57)

    def test_coerce_comma_separated_returns_list(self):
        coerced = self.an._coerce_string_evidence(
            ".env.example:L2, server/config.ts:L55-57"
        )
        self.assertIsInstance(coerced, list)
        assert isinstance(coerced, list)
        self.assertEqual(len(coerced), 2)
        self.assertEqual(coerced[0].get("path"), ".env.example")
        self.assertEqual(coerced[1].get("path"), "server/config.ts")

    def test_coerce_single_fragment_stays_dict(self):
        coerced = self.an._coerce_string_evidence("server/config.ts:L60")
        self.assertIsInstance(coerced, dict)
        assert isinstance(coerced, dict)
        self.assertEqual(coerced.get("line_start"), 60)

    def test_flatten_evidence_list_splits_comma_string(self):
        flat = self.an._flatten_evidence_list(
            ['.env.example:L1, server/config.ts:L5', "noop-invalid:x"]
        )
        self.assertEqual(len(flat), 3)
        self.assertIsInstance(flat[0], dict)
        self.assertIsInstance(flat[1], dict)
        self.assertEqual(flat[2], "noop-invalid:x")

    def test_normalize_howto_evidence_usage_examples(self):
        howto = {
            "install_steps": [],
            "config": [],
            "run_dev": [],
            "run_prod": [],
            "verification_steps": [],
            "common_failures": [],
            "usage_examples": [
                {
                    "description": "example",
                    "evidence": ".env.example:L2, server/config.ts:L55-56",
                }
            ],
        }
        out = self.an._normalize_howto_evidence(howto)
        ev = out["usage_examples"][0]["evidence"]
        self.assertIsInstance(ev, list)
        assert isinstance(ev, list)
        self.assertEqual(len(ev), 2)


if __name__ == "__main__":
    unittest.main()
