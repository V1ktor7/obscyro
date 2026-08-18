"""The care model, read from the ontology instead of shipped with the engine.

`templates.care_model_for` invents one. It picks three severities nobody named,
gives them stays of six, three and one step, has every patient consume exactly
one bed and some fraction of a nurse, and sets mortality at 0.15 with the other
two bands derived by dividing it by ten and two hundred. Every one of those
numbers is a preset, and the divisors are not even arguments.

That was defensible while nothing in the twin could hold them. It is not
defensible as a platform: those are one hospital's clinical assumptions, and a
transit authority opening the same product is handed them too.

So an institution declares a type — under whatever name it likes — whose
instances *are* the care model, and binds its properties to mechanics:

    serves_severity     which band this row describes
    occupies_for        how long one unit of demand holds what it consumes
    dies_without        deaths per unserved unit per step
    consumes_activity   what it draws on
    consumes_amount     how much of it, per unit per step

One instance is one (severity, activity) pair. Several instances sharing a
severity merge their consumption, which is how "a critical case needs a bed and
half a nurse" is written without the engine knowing either word.

Nothing here knows what a bed, a nurse or a patient is. It reads mechanics.
"""

from __future__ import annotations

from app.events.domain import CareRequirement
from app.events.objects import PropertySchema, SimObject

# Mirrors MECHANICS in `backend/src/services/property-schema.ts`. Kept as a
# literal rather than negotiated at runtime: the two sides are versioned
# separately, and a mechanic added on one and not the other has to be visibly
# absent here rather than silently ignored.
SERVES_SEVERITY = "serves_severity"
OCCUPIES_FOR = "occupies_for"
DIES_WITHOUT = "dies_without"
CONSUMES_ACTIVITY = "consumes_activity"
CONSUMES_AMOUNT = "consumes_amount"


class ContradictoryCareModel(ValueError):
    """Two rows describe one severity and disagree about it.

    Raised rather than resolved. Picking the first, the last or the larger would
    each give a run that completes and answers a question nobody asked, and the
    author would never learn which of their two numbers was used.
    """


def _bound(schema: PropertySchema, type_name: str) -> dict[str, str]:
    """mechanic -> property key, for one type.

    The schema is the only place property names are read. Everything downstream
    speaks mechanics, so a hospital that calls its stay `duree_sejour` and one
    that calls it `los` produce identical engine input.
    """
    out: dict[str, str] = {}
    for t in schema.types:
        if t.name != type_name:
            continue
        for p in t.properties:
            if p.mechanic and p.mechanic not in out:
                out[p.mechanic] = p.key
    return out


def binds_care_model(schema: PropertySchema | None) -> bool:
    """Whether anything at all is bound. Cheap enough to ask before loading."""
    if schema is None:
        return False
    return any(p.mechanic for t in schema.types for p in t.properties)


def care_model_from(
    objects: list[SimObject], schema: PropertySchema | None
) -> dict[str, CareRequirement]:
    """Build the care model out of declared instances.

    Returns an empty dict when nothing is bound, which the caller reads as "this
    institution has not described its care" rather than as an error — the twin
    is still perfectly runnable for events that do not involve demand.
    """
    if schema is None:
        return {}

    # severity -> the values seen for it, with the instance that supplied each
    # so a contradiction can name both sides.
    stays: dict[str, tuple[float, str]] = {}
    deaths: dict[str, tuple[float, str]] = {}
    consumes: dict[str, dict[str, float]] = {}

    for obj in objects:
        bound = _bound(schema, obj.type)
        if SERVES_SEVERITY not in bound:
            continue
        severity = obj.properties.get(bound[SERVES_SEVERITY])
        if not isinstance(severity, str) or not severity.strip():
            # An instance that names no severity describes nothing. Skipped
            # rather than raised: a half-filled row is a form in progress.
            continue
        severity = severity.strip()
        consumes.setdefault(severity, {})

        _record(stays, severity, obj, bound.get(OCCUPIES_FOR), OCCUPIES_FOR)
        _record(deaths, severity, obj, bound.get(DIES_WITHOUT), DIES_WITHOUT)

        activity_key = bound.get(CONSUMES_ACTIVITY)
        amount_key = bound.get(CONSUMES_AMOUNT)
        if activity_key and amount_key:
            activity = obj.properties.get(activity_key)
            amount = obj.properties.get(amount_key)
            if isinstance(activity, str) and activity.strip() and _is_number(amount):
                activity = activity.strip()
                existing = consumes[severity].get(activity)
                if existing is not None and existing != float(amount):
                    raise ContradictoryCareModel(
                        f"two rows say a {severity!r} case consumes a different amount of "
                        f"{activity!r} ({existing} and {float(amount)}). The engine reads one "
                        f"number; say which."
                    )
                consumes[severity][activity] = float(amount)

    model: dict[str, CareRequirement] = {}
    for severity, drawn in consumes.items():
        stay = stays.get(severity)
        model[severity] = CareRequirement(
            acuity=severity,
            consumes=drawn,
            # Unbound means zero, and zero is the honest reading: nobody said
            # anyone dies of this, so the model does not claim they do. A
            # default here would be the shipped 0.15 all over again.
            mortality_per_unmet=deaths[severity][0] if severity in deaths else 0.0,
            # One step is the shortest stay that means anything — a unit of
            # demand has to occupy what it consumes for at least the step it is
            # served in, or being served costs nothing and capacity never binds.
            stay_ticks=max(1, int(stay[0])) if stay else 1,
        )
    return model


def _record(
    into: dict[str, tuple[float, str]],
    severity: str,
    obj: SimObject,
    key: str | None,
    mechanic: str,
) -> None:
    if not key:
        return
    value = obj.properties.get(key)
    if not _is_number(value):
        return
    seen = into.get(severity)
    if seen is not None and seen[0] != float(value):
        raise ContradictoryCareModel(
            f"{obj.id!r} and {seen[1]!r} both describe {severity!r} but give different "
            f"values for {mechanic} ({float(value)} and {seen[0]}). The engine reads one "
            f"number; say which."
        )
    into[severity] = (float(value), obj.id)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
