"""Tests for the JS-faithful canonical JSON serialiser (dumps_js_canonical).

The cross-client byte-identity contract (conformance/README.md §3–§4) pins the
canonical serialisation of re-serialised .json data files to the JS form,
`JSON.stringify(obj, null, 2) + "\\n"`. These tests pin the two deltas from a
bare `json.dumps(indent=2)`: non-ASCII is emitted raw, and integer-valued
floats become ints.
"""

from jadelens.operations import _to_js_canonical, dumps_js_canonical


# ---------------------- integer-valued float normalisation ----------------------


def test_integer_valued_float_becomes_int():
    assert _to_js_canonical(1.0) == 1
    assert isinstance(_to_js_canonical(1.0), int)


def test_genuine_fraction_preserved():
    assert _to_js_canonical(1.5) == 1.5
    assert isinstance(_to_js_canonical(1.5), float)


def test_bool_is_not_coerced_to_int():
    # bool is a subclass of int — must survive as a bool, not become 1/0.
    assert _to_js_canonical(True) is True
    assert _to_js_canonical(False) is False


def test_negative_zero_float_becomes_zero_int():
    out = _to_js_canonical(-0.0)
    assert out == 0
    assert isinstance(out, int)


def test_large_integer_valued_float_stays_float():
    # JS prints 1e21 as "1e+21", which int() wouldn't reproduce — leave it.
    big = 1e21
    assert _to_js_canonical(big) == big
    assert isinstance(_to_js_canonical(big), float)


def test_nested_structures_normalised_recursively():
    obj = {"counts": [1.0, 2.0, 3.5], "meta": {"version": 2.0, "ratio": 0.25}}
    assert _to_js_canonical(obj) == {
        "counts": [1, 2, 3.5],
        "meta": {"version": 2, "ratio": 0.25},
    }


def test_plain_ints_and_strings_untouched():
    assert _to_js_canonical(7) == 7
    assert _to_js_canonical("1.0") == "1.0"
    assert _to_js_canonical(None) is None


# ---------------------- output formatting ----------------------


def test_non_ascii_emitted_raw_not_escaped():
    out = dumps_js_canonical({"name": "café ☕"})
    assert "café ☕" in out
    assert "\\u" not in out


def test_two_space_indent_and_trailing_newline():
    out = dumps_js_canonical({"a": 1})
    assert out == '{\n  "a": 1\n}\n'


def test_integer_valued_float_serialises_without_dot_zero():
    out = dumps_js_canonical({"version": 2.0})
    assert out == '{\n  "version": 2\n}\n'


def test_key_order_preserved_not_sorted():
    out = dumps_js_canonical({"b": 1, "a": 2})
    assert out == '{\n  "b": 1,\n  "a": 2\n}\n'


def test_empty_containers_match_js():
    assert dumps_js_canonical({}) == "{}\n"
    assert dumps_js_canonical([]) == "[]\n"
