"""Migration helpers for v1 → v2.

Called via ``jadelens run-migration-helper <data_repo> v1_v2/<name>``.
"""

import json
from pathlib import Path, PurePosixPath

from jadelens import sync, workflow
from jadelens.sidecar import is_promotable


def _find_promotable_pointers(data: object, prefix: str = "") -> list[tuple[str, str]]:
    """Return (rfc6901_pointer, string_value) for each promotable non-wikilink string."""
    results: list[tuple[str, str]] = []
    if isinstance(data, dict):
        for k, v in data.items():
            escaped = k.replace("~", "~0").replace("/", "~1")
            ptr = f"{prefix}/{escaped}"
            if isinstance(v, str) and not (v.startswith("[[") and v.endswith("]]")) and is_promotable(v):
                results.append((ptr, v))
            elif isinstance(v, (dict, list)):
                results.extend(_find_promotable_pointers(v, ptr))
    elif isinstance(data, list):
        for i, v in enumerate(data):
            ptr = f"{prefix}/{i}"
            if isinstance(v, str) and not (v.startswith("[[") and v.endswith("]]")) and is_promotable(v):
                results.append((ptr, v))
            elif isinstance(v, (dict, list)):
                results.extend(_find_promotable_pointers(v, ptr))
    return results


def promote_sidecars(data_repo: Path, stdin_data: dict | None) -> None:
    """Batch-promote all qualifying inline strings to sidecars across the data repo.

    Scans every .json file (excluding dot-dirs at root and sidecar dirs), builds
    json_patch replace ops for each promotable string, and calls workflow.run so
    the promotion pipeline creates the sidecar files and rewrites the wikilinks.
    Prints counts to stdout.
    """
    try:
        sync.pull(data_repo)
    except sync.SyncError:
        pass

    json_files: list[Path] = []
    for p in sorted(data_repo.rglob("*.json")):
        rel = p.relative_to(data_repo)
        parts = PurePosixPath(rel).parts
        if parts[0].startswith("."):
            continue
        if any(part.endswith(".sidecars") for part in parts):
            continue
        json_files.append(p)

    files_scanned = len(json_files)
    raw_ops: list[dict] = []

    for json_file in json_files:
        try:
            data = json.loads(json_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        promotable = _find_promotable_pointers(data)
        if not promotable:
            continue

        rel_path = str(PurePosixPath(json_file.relative_to(data_repo)))
        raw_ops.append({
            "op": "json_patch",
            "path": rel_path,
            "patch": [
                {"op": "replace", "path": ptr, "value": value}
                for ptr, value in promotable
            ],
        })

    if not raw_ops:
        print(f"Scanned {files_scanned} files, 0 values promoted, 0 sidecars created.")
        return

    result = workflow.run(
        data_repo,
        raw_ops,
        "migration: promote inline strings to sidecars",
        unsafe=True,
    )

    n = len(result.promoted_sidecars)
    print(f"Scanned {files_scanned} files, {n} values promoted, {n} sidecars created.")
