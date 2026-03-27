"""
Tests for schema validation of operate.json and target_howto.json outputs.

Ensures that:
- Fixture samples validate against their schemas
- Schema validation catches contract violations
"""
import json
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from server.analyzer.src.schema_validator import (
    validate_operate_json,
    validate_target_howto_json,
    load_schema
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


class TestSchemaValidation(unittest.TestCase):

    def test_operate_schema_loads(self):
        """Test that operate schema can be loaded."""
        schema = load_schema("operate.schema.json")
        self.assertIn("$schema", schema)
        self.assertIn("properties", schema)
        self.assertIn("schema_version", schema["required"])

    def test_target_howto_schema_loads(self):
        """Test that target_howto schema can be loaded."""
        schema = load_schema("target_howto.schema.json")
        self.assertIn("$schema", schema)
        self.assertIn("properties", schema)
        self.assertIn("schema_version", schema["required"])

    def test_operate_fixture_validates(self):
        """Test that operate.sample.json validates against its schema."""
        fixture_path = FIXTURES_DIR / "operate.sample.json"
        self.assertTrue(fixture_path.exists(), f"Fixture not found: {fixture_path}")
        
        with open(fixture_path, "r") as f:
            data = json.load(f)
        
        errors = validate_operate_json(data)
        if errors:
            self.fail(f"operate.sample.json validation failed:\n" + "\n".join(errors))

    def test_target_howto_fixture_validates(self):
        """Test that target_howto.sample.json validates against its schema."""
        fixture_path = FIXTURES_DIR / "target_howto.sample.json"
        self.assertTrue(fixture_path.exists(), f"Fixture not found: {fixture_path}")
        
        with open(fixture_path, "r") as f:
            data = json.load(f)
        
        errors = validate_target_howto_json(data)
        if errors:
            self.fail(f"target_howto.sample.json validation failed:\n" + "\n".join(errors))

    def test_operate_missing_required_field(self):
        """Test that missing required fields are caught."""
        data = {
            "tool_version": "pta-0.1.0",
            "generated_at": "2026-01-01T00:00:00Z",
            # Missing schema_version, mode, and other required fields
        }
        errors = validate_operate_json(data)
        self.assertTrue(len(errors) > 0, "Should have validation errors for missing fields")
        self.assertTrue(any("schema_version" in e for e in errors))

    def test_target_howto_missing_required_field(self):
        """Test that missing required fields are caught."""
        data = {
            "tool_version": "pta-0.1.0",
            "generated_at": "2026-01-01T00:00:00Z",
            # Missing schema_version, target, and other required fields
        }
        errors = validate_target_howto_json(data)
        self.assertTrue(len(errors) > 0, "Should have validation errors for missing fields")
        self.assertTrue(any("schema_version" in e or "target" in e for e in errors))

    def test_target_howto_unknown_object_with_confidence_validates(self):
        """Model-emitted confidence on unknown entries is allowed by schema."""
        with open(FIXTURES_DIR / "target_howto.sample.json", "r") as f:
            data = json.load(f)
        data["unknowns"] = [
            {
                "what_is_missing": "Test gap",
                "why_it_matters": "Coverage",
                "confidence": 0.25,
            }
        ]
        errors = validate_target_howto_json(data)
        if errors:
            self.fail("unknowns with confidence should validate:\n" + "\n".join(errors))

    def test_operate_invalid_schema_version(self):
        """Test that invalid schema_version format is caught."""
        with open(FIXTURES_DIR / "operate.sample.json", "r") as f:
            data = json.load(f)
        
        data["schema_version"] = "invalid"
        errors = validate_operate_json(data)
        self.assertTrue(len(errors) > 0, "Should have validation errors for invalid schema_version")

    def test_operate_readiness_score_out_of_range(self):
        """Test that readiness scores outside 0-100 range are caught."""
        with open(FIXTURES_DIR / "operate.sample.json", "r") as f:
            data = json.load(f)
        
        data["readiness"]["boot"]["score"] = 150
        errors = validate_operate_json(data)
        self.assertTrue(len(errors) > 0, "Should have validation errors for score > 100")
        self.assertTrue(any("150" in e or "maximum" in e.lower() for e in errors))


if __name__ == "__main__":
    unittest.main()
