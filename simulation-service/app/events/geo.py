"""Distance, and what an event does with it.

An event does not reach every object at once and does not spread in a pattern
anyone can write down per site. What it does do is start somewhere and take time
to arrive, weakening as it goes — and all three of those follow from one number,
the distance from an epicentre.

    selection     beyond the radius, nothing happens
    attenuation   intensity falls off with distance
    propagation   the window opens later the further out you are

That third one is what "not instantly, everywhere" actually means, and it needs
no agent, no movement and no simulation of anything travelling: a front rolling
across a map is `delay = distance / speed`, computed once per facility.

The alternative — simulating people moving between places — is an agent-based
epidemic model. That is a different product, and the boundary of this one is the
health network: the outside world arrives as a demand curve, not as a crowd.
"""

from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, Field

# How much of the effect survives to a given distance.
#
#   none    full strength everywhere inside the radius
#   linear  fades evenly, reaching nothing exactly at the edge
#   steep   loses most of its strength close to the source, then trails off
#
# `steep` was first written as an inverse square, 1/(1+s^2). Normalised against
# a radius that is a *gentler* curve than linear at every distance, and it still
# holds half its strength at the edge — so combining it with a radius produced a
# 50% cliff at the boundary. The name promised a fast drop and the maths
# delivered the opposite.
Falloff = Literal["none", "linear", "steep"]

EARTH_RADIUS_KM = 6371.0088


def distance_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (latitude, longitude) pairs.

    Haversine rather than a flat approximation: a health region can span several
    degrees of latitude, and the flat error there is the difference between a
    site being inside a radius and outside it.
    """
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


class Spatial(BaseModel):
    """Where an event starts, how far it carries, and how fast.

    Every field is optional and each one does a distinct job, so an author can
    take only the part they mean: a radius without a speed is a blast area that
    lands everywhere at once; a speed without a radius is a front with no edge.
    """

    epicentre: tuple[float, float] = Field(
        description="Latitude and longitude the event starts from.",
    )
    # Beyond this, the effect does not apply at all. None means no edge — useful
    # with a falloff, where distance already does the limiting.
    radius_km: float | None = None
    falloff: Falloff = "none"
    # Kilometres per step. None means the whole area is reached at once, which
    # is right for a power cut and wrong for a flood.
    speed_km_per_step: float | None = None

    def delay_steps(self, distance: float) -> int:
        """How many steps before this distance is reached.

        Rounded down: a site 9 km out with a front moving 8 km a step is reached
        during step 1, not held back until step 2. Rounding up would push the
        whole map one step later and quietly shorten every event by one.
        """
        if not self.speed_km_per_step or self.speed_km_per_step <= 0:
            return 0
        return int(distance // self.speed_km_per_step)

    def attenuation(self, distance: float) -> float:
        """What fraction of the effect's strength survives to this distance."""
        if self.falloff == "none":
            return 1.0
        if self.radius_km and self.radius_km > 0:
            share = min(1.0, distance / self.radius_km)
        else:
            # With no radius there is no natural scale, so one kilometre is the
            # unit. Stated rather than hidden: an author who wants a gentler
            # curve sets a radius and gets one.
            share = distance
        remaining = max(0.0, 1.0 - share)
        # Both reach nothing at the edge, so neither leaves a cliff there. The
        # difference is where the strength goes: linear spends it evenly, steep
        # spends most of it in the first fraction of the radius.
        return remaining if self.falloff == "linear" else remaining * remaining

    def reaches(self, distance: float) -> bool:
        return self.radius_km is None or distance <= self.radius_km
