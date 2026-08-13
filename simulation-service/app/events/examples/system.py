"""A small network to run the examples against.

Deliberately not a realistic health system: small enough that a person can do
the arithmetic by hand and check the engine. Every resource name here is data —
`icu_beds`, `nurses`, `ehr` appear nowhere in the engine.
"""

from __future__ import annotations

from app.events.domain import (
    SPACE,
    STAFF,
    STUFF,
    SYSTEMS,
    CareRequirement,
    Edge,
    Facility,
    NetworkxBackend,
    Population,
    Replenishment,
    Resource,
    SystemState,
)


def _hospital(fid: str, name: str, icu: int, ward: int, nurses: int, vents: int) -> Facility:
    return Facility(
        id=fid,
        name=name,
        resources={
            "icu_beds": Resource(
                id="icu_beds", category=SPACE, quantity=icu, capacity=icu,
                enables=frozenset({"icu_bed"}),
            ),
            "ward_beds": Resource(
                id="ward_beds", category=SPACE, quantity=ward, capacity=ward,
                enables=frozenset({"ward_bed"}),
            ),
            "nurses": Resource(
                id="nurses", category=STAFF, quantity=nurses, capacity=nurses,
                enables=frozenset({"nurse"}),
                # Staff come back slowly and not immediately: agency cover takes
                # days to arrange, which is the whole reason a staff shock hurts.
                replenishment=Replenishment(per_tick=1.0, lead_time=3),
            ),
            "ventilators": Resource(
                id="ventilators", category=STUFF, quantity=vents, capacity=vents,
                enables=frozenset({"ventilator"}),
            ),
            "ehr": Resource(
                id="ehr", category=SYSTEMS, quantity=1, capacity=1,
                enables=frozenset({"records"}),
            ),
        },
    )


def toy_system() -> SystemState:
    net = NetworkxBackend()
    facilities = {
        "north": _hospital("north", "North General", icu=10, ward=60, nurses=40, vents=10),
        "south": _hospital("south", "South General", icu=6, ward=40, nurses=25, vents=6),
        "clinic": _hospital("clinic", "Riverside Clinic", icu=0, ward=15, nurses=8, vents=0),
    }
    for fid in facilities:
        net.add_node(fid)

    # Transfer routes are capped: an evacuation that moves everyone in one tick
    # is the easiest way to make a policy look miraculous.
    net.add_edge(Edge(source="clinic", target="north", kind="transfer", capacity=8))
    net.add_edge(Edge(source="north", target="south", kind="transfer", capacity=6))
    net.add_edge(Edge(source="south", target="north", kind="transfer", capacity=6))
    net.add_edge(Edge(source="north", target="clinic", kind="supply", capacity=10))
    net.add_edge(Edge(source="north", target="south", kind="supply", capacity=10))
    net.add_edge(Edge(source="north", target="clinic", kind="information", capacity=1))

    populations = {
        "city": Population(id="city", size=250_000, served_by=["north", "south"]),
        "riverside": Population(id="riverside", size=40_000, served_by=["clinic"]),
    }

    care = {
        "critical": CareRequirement(
            acuity="critical",
            consumes={"icu_bed": 1.0, "nurse": 0.5, "ventilator": 1.0},
            mortality_per_unmet=0.15,
            stay_ticks=5,
        ),
        "routine": CareRequirement(
            acuity="routine",
            consumes={"ward_bed": 1.0, "nurse": 0.15},
            mortality_per_unmet=0.004,
            stay_ticks=3,
        ),
    }

    return SystemState(
        facilities=facilities, populations=populations, care_model=care, network=net
    )
