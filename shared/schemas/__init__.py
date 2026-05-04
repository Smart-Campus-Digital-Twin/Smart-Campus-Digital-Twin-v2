"""
shared.schemas — canonical data contracts for the Smart Campus pipeline.

Import from here in all services; never import the sub-modules directly.
This lets the internal layout change without breaking import paths.
"""

from .sensor import (
    SensorReading,
    SensorType,
    Unit,
    CANONICAL_UNIT,
    PHYSICAL_BOUNDS,
)
from .kafka import KafkaMessage
from .aggregation import AggregatedReading
from .anomaly import AnomalyEvent, AnomalyType, Severity

__all__ = [
    # sensor
    "SensorReading",
    "SensorType",
    "Unit",
    "CANONICAL_UNIT",
    "PHYSICAL_BOUNDS",
    # kafka
    "KafkaMessage",
    # aggregation
    "AggregatedReading",
    # anomaly
    "AnomalyEvent",
    "AnomalyType",
    "Severity",
]
