import os
import sys
import time
from abc import ABC, abstractmethod
from typing import Dict, Any

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../.." ))
from shared.models import SensorReading, SENSOR_UNITS


class BaseSensor(ABC):
    """Abstract base for all simulated sensors."""

    def __init__(
        self,
        sensor_id: str,
        room_id: str,
        building_id: str,
        floor: int,
        sensor_type: str,
        room_type: str = "classroom",
    ) -> None:
        self.sensor_id = sensor_id
        self.room_id = room_id
        self.building_id = building_id
        self.floor = floor
        self.sensor_type = sensor_type
        self.room_type = room_type
        self.unit = SENSOR_UNITS[sensor_type]
        self._state: Dict[str, Any] = {}

    @abstractmethod
    def _sample(self, context: Dict[str, Any]) -> float:
        """Return the raw sensor value given environmental context."""

    def read(self, context: Dict[str, Any]) -> SensorReading:
        """Public API: generate a SensorReading with the current timestamp."""
        value = self._sample(context)
        return SensorReading(
            sensor_id=self.sensor_id,
            building_id=self.building_id,
            floor=self.floor,
            room_id=self.room_id,
            sensor_type=self.sensor_type,
            value=round(value, 4),
            unit=self.unit,
            timestamp_ms=int(time.time() * 1000),
            quality=self._quality(),
            metadata=self._metadata(),
        )

    def _quality(self) -> float:
        """Override to simulate sensor degradation / data-quality flags."""
        return 1.0

    def _metadata(self) -> Dict[str, Any]:
        return {}

    @staticmethod
    def _clamp(value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, value))
