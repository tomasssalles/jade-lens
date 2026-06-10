"""Config dataclass for an installed jade-lens skill."""

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True, frozen=True)
class Config:
    assistant_name: str
    data_repo_path: Path
    user_full_name: str
    user_short_name: str

    def __post_init__(self) -> None:
        if not self.assistant_name:
            raise ValueError("assistant_name must not be empty")
        if not self.data_repo_path.is_absolute():
            raise ValueError(
                f"data_repo_path must be absolute: {self.data_repo_path}"
            )
        if not self.user_full_name:
            raise ValueError("user_full_name must not be empty")
        if not self.user_short_name:
            raise ValueError("user_short_name must not be empty")
