"""Python runner for the cross-client STASH conformance scope.

Each fixture in ``conformance/stash-cases/*.json`` carries the inputs to a stash
entry (``operations``, ``timestamp``, ``base_content``) and the expected built
``entry`` plus its exact ``serialized`` bytes. This runner builds the entry via
``jadelens.stash`` and asserts both — the JS runner (``run-stash.mjs``) asserts
the *same* fixtures against the web pipeline, so a green pair proves both clients
write byte-identical stash entries (docs/…/implementation-plan.md Phase 6).

Run with: ``uv run pytest conformance/runners/python``
"""

import json
from pathlib import Path

import pytest

from jadelens.stash import build_stash_entry, serialize_stash_entry

CONFORMANCE_ROOT = Path(__file__).resolve().parents[2]
CASES_DIR = CONFORMANCE_ROOT / "stash-cases"


def _load_cases():
    paths = sorted(CASES_DIR.glob("*.json"))
    return [pytest.param(json.loads(p.read_text()), id=p.stem) for p in paths]


@pytest.mark.parametrize("case", _load_cases())
def test_stash_conformance(case):
    entry = build_stash_entry(
        case["operations"], case["timestamp"], case["base_content"]
    )
    assert entry == case["expect"]["entry"], "built entry differs from the fixture"
    assert serialize_stash_entry(entry) == case["expect"]["serialized"], (
        "serialized bytes differ from the fixture"
    )
