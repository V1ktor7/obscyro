"""Three crises, defined only as data.

This file is the acceptance criterion made runnable. A pandemic, a flood and a
cyberattack look nothing alike to a health minister and identical to the engine:
each is a set of magnitudes over demand, capacity and connectivity. Nothing
below imports from `dynamics`, and adding a fourth crisis means adding a
function here and touching nothing else.
"""

from __future__ import annotations

from app.crisis.domain import SPACE, STAFF, STUFF, SYSTEMS
from app.crisis.events import (
    CapacityPerturbation,
    ConnectivityPerturbation,
    DemandPerturbation,
    Scenario,
    TemporalProfile,
)


def pandemic() -> Scenario:
    """Demand up over a wave, staff down as they fall ill, ventilators scarce.

    The staff shock lags the demand peak on purpose: healthcare workers get sick
    from the surge they are treating, which is what makes the second half of a
    wave worse than the first at the same case count.
    """
    return Scenario(
        id="pandemic",
        name="Respiratory pandemic wave",
        description="A 60-day wave: demand rises and falls, staff attrition trails it.",
        horizon=60,
        perturbations=[
            DemandPerturbation(
                id="wave",
                targets=["city", "riverside"],
                acuity_mix={"critical": 0.18, "routine": 0.82},
                volume=45,
                profile=TemporalProfile(start=0, end=60, shape="gaussian", peak=1.0, peak_tick=28),
            ),
            CapacityPerturbation(
                id="staff-sickness",
                facilities=["north", "south", "clinic"],
                category=STAFF,
                multiplier=0.65,
                profile=TemporalProfile(start=10, end=50, shape="ramp", peak=1.0),
            ),
            CapacityPerturbation(
                id="vent-shortage",
                facilities=["north", "south"],
                category=STUFF,
                multiplier=0.7,
                profile=TemporalProfile(start=15, end=45, shape="step", peak=1.0),
            ),
        ],
    )


def flood() -> Scenario:
    """One facility drowned, a casualty spike, and the roads out of it cut.

    The interesting part is not the water. It is that the surge arrives at the
    same moment the route that would relieve it disappears.
    """
    return Scenario(
        id="flood",
        name="River flood",
        description="Riverside clinic lost, trauma spike, transfer routes severed for a week.",
        horizon=30,
        perturbations=[
            CapacityPerturbation(
                id="clinic-flooded",
                facilities=["clinic"],
                absolute=0.0,
                profile=TemporalProfile(start=2, end=30, shape="step", peak=1.0),
            ),
            DemandPerturbation(
                id="trauma-spike",
                targets=["riverside", "city"],
                acuity_mix={"critical": 0.4, "routine": 0.6},
                volume=70,
                profile=TemporalProfile(start=2, end=6, shape="pulse", peak=1.0),
            ),
            ConnectivityPerturbation(
                id="roads-cut",
                edges=[("clinic", "north"), ("north", "south")],
                edge_kind="transfer",
                multiplier=0.0,
                profile=TemporalProfile(start=2, end=9, shape="step", peak=1.0),
            ),
        ],
    )


def cyberattack() -> Scenario:
    """Systems down, and everything else degraded through it.

    No demand perturbation and no direct capacity loss: the whole effect travels
    through the cascade rule, which is the point. If this scenario produces
    casualties, the connective tissue is being modelled properly.
    """
    return Scenario(
        id="cyberattack",
        name="Ransomware on the regional EHR",
        description="Systems at zero for a week at the hub; the rest degrades through it.",
        horizon=30,
        perturbations=[
            CapacityPerturbation(
                id="ehr-down",
                facilities=["north", "clinic"],
                category=SYSTEMS,
                absolute=0.0,
                profile=TemporalProfile(start=3, end=10, shape="step", peak=1.0),
            ),
            ConnectivityPerturbation(
                id="info-link-down",
                edges=[("north", "clinic")],
                edge_kind="information",
                multiplier=0.0,
                profile=TemporalProfile(start=3, end=10, shape="step", peak=1.0),
            ),
            # Ordinary demand keeps arriving. A crisis that pauses the day job is
            # not a crisis.
            DemandPerturbation(
                id="business-as-usual",
                targets=["city", "riverside"],
                acuity_mix={"critical": 0.1, "routine": 0.9},
                volume=25,
                profile=TemporalProfile(start=0, end=30, shape="step", peak=1.0),
            ),
        ],
    )


ALL = {"pandemic": pandemic, "flood": flood, "cyberattack": cyberattack}
