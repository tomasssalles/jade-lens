"""Config dataclass for an installed jade-lens skill, and helpers to build it
from an extracted placeholder-mapping for any known template version.

Config holds **user-preference state** — things the user chose at install time
and that should persist across updates (``skill_name``, ``data_repo_path``).
Ambient values that the install/update flow re-derives every time (notably
``code_repo_path``) are NOT in Config; they are passed separately to the
render step. ``config_from_mapping`` ignores ambient keys if present in the
mapping.

Fields here are the union across all template versions. Older template
versions may not include all fields; ``config_from_mapping`` is responsible
for filling in version-specific defaults so a Config can always be
constructed from any supported template version's extracted mapping.
"""

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class Config:
    skill_name: str
    data_repo_path: Path

    def __post_init__(self) -> None:
        if not self.skill_name:
            raise ValueError("skill_name must not be empty")
        if not self.data_repo_path.is_absolute():
            raise ValueError(
                f"data_repo_path must be absolute: {self.data_repo_path}"
            )


class ConfigBuildError(Exception):
    """Base for errors building a Config from an extracted mapping."""


class UnknownVersion(ConfigBuildError):
    """The template version is not recognized by this code version."""


class MissingField(ConfigBuildError):
    """The mapping is missing a field required by the template version."""


def config_from_mapping(mapping: dict[str, str], version: str) -> Config:
    """Build a Config from a placeholder-value mapping and a template version.

    The version determines which placeholders the mapping is expected to
    contain. Fields added in template versions later than ``version`` are
    populated with defaults defined here, so older installs remain buildable
    after the schema evolves. Ambient placeholders (e.g. ``CODE_REPO_PATH``)
    are ignored if present — they are not user-preference state.

    Raises:
        UnknownVersion: ``version`` is not a template version this code
            recognises.
        MissingField: the mapping is missing a field required by ``version``.
        ValueError: the resulting Config fails post-init validation
            (e.g. a path is not absolute).
    """
    if version == "v0.1.0":
        return _from_mapping_v0_1_0(mapping)
    raise UnknownVersion(f"Unknown template version: {version!r}")


def _from_mapping_v0_1_0(mapping: dict[str, str]) -> Config:
    try:
        return Config(
            skill_name=mapping["SKILL_NAME"],
            data_repo_path=Path(mapping["DATA_REPO_PATH"]),
        )
    except KeyError as e:
        raise MissingField(
            f"Mapping for template version v0.1.0 is missing required "
            f"field: {e.args[0]!r}"
        ) from e