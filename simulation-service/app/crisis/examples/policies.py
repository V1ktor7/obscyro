"""Responses, as data.

Each is a bundle of prioritised rules an optimiser could later mutate. Note what
is *not* here: no crisis names. A policy that says "when the ICU is over 90%,
transfer to the neighbour" is as valid under a flood as under a pandemic, which
is the test of whether the primitives were chosen well.
"""

from __future__ import annotations

from app.crisis.domain import STAFF
from app.crisis.policy import (
    Action,
    Comparison,
    Condition,
    Friction,
    Metric,
    Policy,
    Rule,
    Trigger,
    null_policy,
)


def _over(facility: str, threshold: float, activity: str = "icu_bed") -> Condition:
    """Occupancy of one activity, not of a whole category.

    The first version of this file asked for `category="space"` and never fired:
    ten full ICU beds among sixty ward beds read as 44% while forty critical
    patients went unserved. The engine was right and the rule was blind.
    """
    return Condition(
        compare=Comparison(
            left=Metric(fn="occupancy_ratio", facility=facility, activity=activity),
            op=">",
            right=threshold,
        )
    )


def _waiting(facility: str, threshold: float) -> Condition:
    """People queuing, which is the signal occupancy cannot give you.

    A destroyed facility reports 0% occupancy — there is no capacity to be a
    fraction of — so a flood is invisible to an occupancy rule and obvious to
    this one.
    """
    return Condition(
        compare=Comparison(
            left=Metric(fn="backlog", facility=facility), op=">", right=threshold
        )
    )


def load_balancing() -> Policy:
    """Move waiting patients to whoever has room. Cheap, fast, and limited by
    the routes — which is exactly why it fails in the flood scenario."""
    return Policy(
        id="load-balance",
        name="Transfer when full",
        rules=[
            Rule(
                id="north-overflow",
                condition=_over("north", 0.9),
                action=Action(
                    kind="transfer", source="north", target="south", amount=6,
                    friction=Friction(delay=0, cost=500, effectiveness=0.9),
                ),
                priority=10,
            ),
            Rule(
                id="south-overflow",
                condition=_over("south", 0.9),
                action=Action(
                    kind="transfer", source="south", target="north", amount=6,
                    friction=Friction(delay=0, cost=500, effectiveness=0.9),
                ),
                priority=10,
            ),
            Rule(
                id="clinic-evacuate",
                # Keyed on the queue, not on occupancy: when the clinic is under
                # water its capacity is zero, so its occupancy is zero, and an
                # occupancy rule would watch a hundred stranded patients and see
                # a quiet building.
                condition=_waiting("clinic", 5),
                action=Action(
                    kind="transfer", source="clinic", target="north", amount=8,
                    friction=Friction(delay=0, cost=300, effectiveness=0.9),
                ),
                priority=5,
            ),
        ],
    )


def surge_and_balance() -> Policy:
    """Buy capacity as well as moving load.

    Surging costs money and arrives late — three ticks — so it should beat
    load-balancing on deaths and lose on cost. If it wins on both, the friction
    is not being applied and the model is flattering the policy.
    """
    p = load_balancing()
    return Policy(
        id="surge-and-balance",
        name="Surge staff, then transfer",
        rules=p.rules
        + [
            Rule(
                id="surge-nurses-north",
                trigger=Trigger(when="every_tick"),
                condition=Condition(
                    all_of=[
                        _over("north", 0.8),
                        Condition(
                            compare=Comparison(
                                left=Metric(fn="available", facility="north", activity="nurse"),
                                op="<",
                                right=8,
                            )
                        ),
                    ]
                ),
                action=Action(
                    kind="surge_resource", target="north", resource="nurses", amount=5,
                    friction=Friction(delay=3, cost=25_000, effectiveness=0.8),
                ),
                priority=20,
            ),
            Rule(
                id="dampen-demand",
                trigger=Trigger(when="from_tick", start=5),
                condition=_over("north", 0.95),
                action=Action(
                    kind="modify_demand", population="city", factor=0.9,
                    friction=Friction(delay=2, cost=100_000, effectiveness=1.0),
                ),
                priority=30,
            ),
        ],
    )


ALL = {
    "null": null_policy,
    "load-balance": load_balancing,
    "surge-and-balance": surge_and_balance,
}
