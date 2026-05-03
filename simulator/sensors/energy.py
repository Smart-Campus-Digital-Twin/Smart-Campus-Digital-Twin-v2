import math
import random
from typing import Dict, Any

from .base import BaseSensor


class EnergySensor(BaseSensor):
    """
    Active power draw for a room (Watts).

    Model:
      - Base load: lighting + standby A/C + idle equipment (~100 W at full occupancy)
      - Occupancy load: people generate heat → A/C works harder (+up to 200 W at full)
      - Equipment load: projectors, PCs active during lecture hours (~150 W peak)
      - Night setback: standby only (~20 W) when no one is present
      - Server rooms: constant high draw independent of occupancy

    Typical range: 20 W (empty night) → 500 W (full lecture room with projector on)
    """

    # Per room-type base loads (W)
    _BASE: Dict[str, float] = {
        "classroom":   80.0,
        "lab":        120.0,   # extra equipment
        "office":      60.0,
        "canteen":    100.0,   # kitchen/refrigeration draw
        "auditorium": 200.0,   # stage lighting, AV systems
        "hostel":      50.0,
        "library":     80.0,
        "server_room": 350.0,  # constant — servers, UPS, cooling
        "outdoor":      0.0,
        "default":     80.0,
    }

    # Additional load at full occupancy for non-server rooms (W)
    _OCC_GAIN  = 200.0
    # Additional load during active lecture/event hours (projector etc.) (W)
    _EQUIP_GAIN = 150.0
    # Standby load when room empty and outside hours (W)
    _STANDBY = 20.0

    _LECTURE_START = 8 + 15/60   # 08:15
    _LECTURE_END   = 17 + 15/60  # 17:15

    def _sample(self, context: Dict[str, Any]) -> float:
        hour: float = context.get("hour", 12.0)
        occ:  float = context.get("occupancy_ratio", 0.0)

        if self.sensor_type == "energy" and self.room_type == "server_room":
            # Servers run 24/7; minor load fluctuation from cooling
            base = self._BASE["server_room"]
            noise = random.gauss(0, 15.0)
            return self._clamp(base + noise, 200.0, 500.0)

        base = self._BASE.get(self.room_type, self._BASE["default"])

        # Occupancy load scales with how many people are present
        occ_load = self._OCC_GAIN * occ

        # Equipment load: proportional to occupancy during active hours
        # (projectors/PCs switched on only when room is in use)
        in_active_hours = self._LECTURE_START <= hour <= self._LECTURE_END
        equip_load = self._EQUIP_GAIN * occ if in_active_hours else 0.0

        # Night-time / empty rooms: drop to standby only
        is_night = hour < 6.5 or hour >= 22.0
        if is_night and occ < 0.02:
            noise = random.gauss(0, 2.0)
            return self._clamp(self._STANDBY + noise, 0.0, 500.0)

        noise = random.gauss(0, 8.0)
        total = base + occ_load + equip_load + noise
        return self._clamp(total, self._STANDBY, 500.0)
