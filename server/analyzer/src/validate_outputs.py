#!/usr/bin/env python3
"""
Output validator for PTA smoke tests.

Validates that analyzer outputs conform to schemas and contain required metadata.
"""
import sys
import json
from pathlib import Path
from typing import List

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from server.analyzer.src.schema_validator import (
    validate_operate_json,
    validate_target_howto_json
)


def _resolve_run_artifacts_dir(output_path: Path) -> Path:
    """
    Analyzer writes under output_dir/runs/<run-id>/. If the caller passes the base
    output dir, use the latest run subfolder that contains target_howto.json.
    """
    if (output_path / "target_howto.json").exists():
        return output_path
    runs = output_path / "runs"
    if runs.is_dir():
        candidates = sorted(
            [p for p in runs.iterdir() if p.is_dir()],
            key=lambda p: p.name,
            reverse=True,
        )
        for p in candidates:
            if (p / "target_howto.json").exists():
                return p
    return output_path


def validate_outputs(output_dir: str) -> int:
    """
    Validate analyzer outputs in the given directory.
    
    Returns:
        0 on success, 1 on failure
    """
    output_path = Path(output_dir)
    artifact_root = _resolve_run_artifacts_dir(output_path)
    errors: List[str] = []
    
    # Check that required files exist
    operate_file = artifact_root / "operate.json"
    howto_file = artifact_root / "target_howto.json"
    
    if not operate_file.exists():
        errors.append(f"operate.json not found in {artifact_root}")
    
    if not howto_file.exists():
        errors.append(f"target_howto.json not found under {output_path} (checked {artifact_root})")
    
    if errors:
        print("❌ Required output files missing:")
        for err in errors:
            print(f"  - {err}")
        return 1
    
    # Load and validate operate.json
    try:
        with open(operate_file) as f:
            operate = json.load(f)
    except Exception as e:
        print(f"❌ Failed to load operate.json: {e}")
        return 1
    
    validation_errors = validate_operate_json(operate)
    if validation_errors:
        print("❌ operate.json validation failed:")
        for err in validation_errors:
            print(f"  - {err}")
        errors.extend(validation_errors)
    else:
        print("✓ operate.json validates against schema")
    
    # Load and validate target_howto.json
    try:
        with open(howto_file) as f:
            howto = json.load(f)
    except Exception as e:
        print(f"❌ Failed to load target_howto.json: {e}")
        return 1
    
    validation_errors = validate_target_howto_json(howto)
    if validation_errors:
        print("❌ target_howto.json validation failed:")
        for err in validation_errors:
            print(f"  - {err}")
        errors.extend(validation_errors)
    else:
        print("✓ target_howto.json validates against schema")
    
    # Check required metadata fields in both files
    required_fields = ['schema_version', 'tool_version', 'generated_at']
    
    for field in required_fields:
        if field not in operate:
            errors.append(f"operate.json missing required field: {field}")
        if field not in howto:
            errors.append(f"target_howto.json missing required field: {field}")
    
    if all(field in operate for field in required_fields) and all(field in howto for field in required_fields):
        print("✓ All required metadata fields present")
    
    # Check target_howto.json has target field with mode and identifier
    if 'target' not in howto:
        errors.append("target_howto.json missing target field")
    elif not isinstance(howto['target'], dict):
        errors.append("target_howto.json target must be an object")
    else:
        if 'mode' not in howto['target']:
            errors.append("target_howto.json target missing 'mode' field")
        if 'identifier' not in howto['target']:
            errors.append("target_howto.json target missing 'identifier' field")
    
    if 'target' in howto and isinstance(howto['target'], dict):
        if 'mode' in howto['target'] and 'identifier' in howto['target']:
            print("✓ target_howto.json has proper target structure")
    
    if errors:
        print()
        print(f"❌ Validation failed with {len(errors)} error(s)")
        return 1
    
    print()
    print("✅ All validations passed!")
    return 0


def main():
    """CLI entrypoint."""
    if len(sys.argv) < 2:
        print("Usage: python -m server.analyzer.src.validate_outputs <output_dir>")
        return 1
    
    output_dir = sys.argv[1]
    return validate_outputs(output_dir)


if __name__ == "__main__":
    sys.exit(main())
