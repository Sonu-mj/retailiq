"""Central model configuration for RetailIQ Phase 4."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    contamination: float = 0.08
    random_state: int = 42
    n_estimators: int = 240
    min_observations_per_outlet: int = 21
    min_total_observations: int = 30
    rolling_window_days: int = 7
    model_version: str = "isolation-forest-daily-v1"


CONFIG = ModelConfig()
