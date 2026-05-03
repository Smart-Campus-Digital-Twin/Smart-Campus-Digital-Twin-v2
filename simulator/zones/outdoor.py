"""
Outdoor zone occupancy model (e.g., Lagaan ground).

Key patterns:
  - Normally 0-1.5% (random small groups passing through)
  - Event-driven: EventCalendar provides active_venue_fill
  - Lunch break: slightly higher foot traffic
  - Weather affects occupancy (not modeled here, could add)
  - Exam periods: quieter (students focused)
"""

import random

from .base_zone import BaseZone, ZoneContext


def _outdoor_background_ratio(hour: float) -> float:
    """Background outdoor occupancy - small random groups."""
    if hour < 7.0 or hour >= 21.0:
        return 0.0

    # Random small groups passing through
    if random.random() < 0.35:
        return random.uniform(0, 0.015)

    return 0.0


class OutdoorZone(BaseZone):
    """
    Outdoor zones with event-driven or background foot traffic.
    """

    def _target_ratio(self, ctx: ZoneContext) -> float:
        hour = ctx.hour

        # Check for event override first
        if self.building_id in ctx.active_venue_fill:
            return ctx.active_venue_fill[self.building_id]

        # Night time: empty
        if hour < 6.0 or hour >= 22.0:
            return 0.0

        # Holidays: minimal
        if ctx.is_holiday:
            return random.uniform(0, 0.02)

        # Weekends: slightly more (people walking around)
        base = _outdoor_background_ratio(hour)
        if ctx.is_weekend:
            base *= 1.5

        # Exam periods: quieter
        if ctx.is_exam_period:
            base *= 0.30

        # During breaks: people walk around more
        if ctx.academic_day.is_low_attendance:
            base *= 2.0

        # Scale by congestion (but outdoor has minimum threshold)
        return max(0.005, base * max(0.20, ctx.congestion_fraction))
