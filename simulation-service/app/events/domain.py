"""The baseline world: facilities, resources, populations, and the network.

The engine must never know what a bed is. A government models its own system,
names its own resource types, and the executive treats them all through one
interface — otherwise "add ICU support" becomes a code change and the platform
stops being a platform.

That rule has a concrete test in `tests/test_extensibility.py`: adding a
resource type must require only data.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Iterable, Literal

from pydantic import BaseModel, Field, NonNegativeFloat, model_validator

# The 4 S's, shipped as the default categorisation and nothing more. They are
# plain strings, not an enum, because a customer who wants "Sang" or "Transport"
# as a fifth category must not need a release to get one.
SPACE = "space"
STAFF = "staff"
STUFF = "stuff"
SYSTEMS = "systems"
DEFAULT_CATEGORIES = (SPACE, STAFF, STUFF, SYSTEMS)

EdgeKind = Literal["transfer", "supply", "information"]


class Replenishment(BaseModel):
    """How a resource comes back after it is spent or damaged.

    `per_tick` is the natural rate; `lead_time` delays the first return, which is
    what separates "call in agency nurses" (days) from "reorder oxygen" (hours).
    """

    per_tick: NonNegativeFloat = 0.0
    lead_time: int = 0


class Resource(BaseModel):
    """A quantity that constrains care, whatever the institution calls it."""

    id: str
    category: str = STAFF
    quantity: NonNegativeFloat
    capacity: NonNegativeFloat
    replenishment: Replenishment = Field(default_factory=Replenishment)
    # How much of this the *run itself* has drawn — patients admitted, not beds
    # the ontology already called occupied. Tracked explicitly because the two
    # are otherwise indistinguishable from `capacity - quantity`, and conflating
    # them makes a bed the ontology frees stay locked for the whole run: an
    # event that reopens a wing then does nothing at all.
    reserved: NonNegativeFloat = 0.0
    # Which care activities this resource makes possible. Demand is matched
    # against activities, never against resource ids, so two facilities can name
    # the same capability differently and still be comparable.
    enables: frozenset[str] = frozenset()

    @model_validator(mode="after")
    def _within_capacity(self) -> "Resource":
        if self.quantity > self.capacity:
            raise ValueError(f"resource {self.id}: quantity {self.quantity} above capacity {self.capacity}")
        return self

    @property
    def available(self) -> float:
        return self.quantity


class Facility(BaseModel):
    id: str
    name: str = ""
    location: tuple[float, float] | None = None
    resources: dict[str, Resource] = Field(default_factory=dict)

    def by_category(self, category: str) -> list[Resource]:
        return [r for r in self.resources.values() if r.category == category]

    def enabling(self, activity: str) -> list[Resource]:
        return [r for r in self.resources.values() if activity in r.enables]


class Population(BaseModel):
    """A group that generates demand, and the facilities that serve it."""

    id: str
    size: NonNegativeFloat
    # Free-form because scenarios stratify differently: age bands for a
    # pandemic, flood zones for an evacuation.
    strata: dict[str, float] = Field(default_factory=dict)
    served_by: list[str] = Field(default_factory=list)


class Edge(BaseModel):
    """A typed connection. Capacity and latency are what make it a constraint
    rather than a drawing: a transfer route that cannot move 200 patients in one
    tick has to say so, or the model will move them."""

    source: str
    target: str
    kind: EdgeKind = "transfer"
    capacity: NonNegativeFloat = float("inf")
    latency: int = 0
    enabled: bool = True
    # Multiplier applied to capacity, so a ConnectivityPerturbation can degrade
    # a route without deleting it — a flooded road at half throughput.
    weight: float = 1.0

    @property
    def throughput(self) -> float:
        return 0.0 if not self.enabled else self.capacity * max(0.0, self.weight)


class CareRequirement(BaseModel):
    """What one patient of a given acuity consumes, per tick of care.

    Expressed against *categories and activities*, never resource ids, so the
    same care model applies to a hospital that calls its beds `lits` and one
    that calls them `beds`.
    """

    acuity: str
    # activity -> units consumed per patient per tick
    consumes: dict[str, float] = Field(default_factory=dict)
    # Deaths per unmet patient per tick. The government sets this; it is the
    # single most contestable number in the model and it belongs in data where
    # it can be argued with.
    mortality_per_unmet: float = 0.0
    # How long one patient occupies what they consume.
    stay_ticks: int = 1


class NetworkBackend(ABC):
    """Graph access behind an interface.

    networkx is right for an in-memory MVP and wrong for a national graph. The
    swap should be one class, not a search through the executive.
    """

    @abstractmethod
    def add_node(self, node_id: str) -> None: ...

    @abstractmethod
    def add_edge(self, edge: Edge) -> None: ...

    @abstractmethod
    def edges_from(self, node_id: str, kind: EdgeKind | None = None) -> list[Edge]: ...

    @abstractmethod
    def edges_into(self, node_id: str, kind: EdgeKind | None = None) -> list[Edge]: ...

    @abstractmethod
    def edge(self, source: str, target: str, kind: EdgeKind) -> Edge | None: ...

    @abstractmethod
    def all_edges(self) -> list[Edge]: ...


class NetworkxBackend(NetworkBackend):
    def __init__(self) -> None:
        import networkx as nx

        self._g = nx.MultiDiGraph()

    def add_node(self, node_id: str) -> None:
        self._g.add_node(node_id)

    def add_edge(self, edge: Edge) -> None:
        self._g.add_edge(edge.source, edge.target, key=edge.kind, edge=edge)

    def _iter(self, data: Iterable, kind: EdgeKind | None) -> list[Edge]:
        out = [d["edge"] for *_ , d in data]
        return [e for e in out if kind is None or e.kind == kind]

    def edges_from(self, node_id: str, kind: EdgeKind | None = None) -> list[Edge]:
        if node_id not in self._g:
            return []
        return self._iter(self._g.out_edges(node_id, keys=True, data=True), kind)

    def edges_into(self, node_id: str, kind: EdgeKind | None = None) -> list[Edge]:
        if node_id not in self._g:
            return []
        return self._iter(self._g.in_edges(node_id, keys=True, data=True), kind)

    def edge(self, source: str, target: str, kind: EdgeKind) -> Edge | None:
        if not self._g.has_edge(source, target, key=kind):
            return None
        return self._g.edges[source, target, kind]["edge"]

    def all_edges(self) -> list[Edge]:
        return self._iter(self._g.edges(keys=True, data=True), None)


class SystemState(BaseModel):
    """The whole mutable world at one tick.

    Deliberately a plain object the executive mutates, rather than a stream of
    immutable snapshots: the trajectory log keeps the copies, and one mutable
    state keeps the tick loop readable.
    """

    model_config = {"arbitrary_types_allowed": True}

    tick: int = 0
    facilities: dict[str, Facility] = Field(default_factory=dict)
    populations: dict[str, Population] = Field(default_factory=dict)
    care_model: dict[str, CareRequirement] = Field(default_factory=dict)
    network: NetworkBackend = Field(default_factory=NetworkxBackend)

    # Patients currently held, by facility and acuity. Occupancy is a
    # consequence of these, never a stored number that can drift from them.
    census: dict[str, dict[str, float]] = Field(default_factory=dict)
    # Demand that arrived and could not be served, by acuity. Carried forward so
    # a surge is not silently forgotten between ticks.
    backlog: dict[str, dict[str, float]] = Field(default_factory=dict)
    # Effects queued by an action with latency: tick -> callables' payloads.
    pending: dict[int, list[dict]] = Field(default_factory=dict)

    # The instances the ontology holds, by id, and the rule for reading
    # availability off their properties. `Facility.resources` is derived from
    # these — an effect that edits a property is what changes a capacity, so
    # both have to be reachable from one place.
    #
    # Typed loosely to keep this module free of an import cycle: `objects.py`
    # imports Facility and Resource from here.
    objects: dict[str, object] = Field(default_factory=dict)
    object_rules: object | None = None
    # What the institution declared its types carry: unit, bounds, and — the
    # part the engine cannot do without — whether each value rebuilds from a
    # baseline every step or accumulates. Same loose typing, same reason.
    property_schema: object | None = None

    def facility(self, fid: str) -> Facility:
        f = self.facilities.get(fid)
        if f is None:
            raise KeyError(f"unknown facility {fid!r}")
        return f

    def resource(self, fid: str, rid: str) -> Resource:
        r = self.facility(fid).resources.get(rid)
        if r is None:
            raise KeyError(f"facility {fid!r} has no resource {rid!r}")
        return r

    def available_for(self, fid: str, activity: str) -> float:
        """How much of `activity` this facility can still provide."""
        return sum(r.available for r in self.facility(fid).enabling(activity))

    def consume(self, fid: str, activity: str, amount: float) -> float:
        """Draw down whatever enables `activity`. Returns what was actually taken.

        Spread across the enabling resources in id order so a run is
        reproducible; a run that consumed in dict order would change its answer
        when the scenario file was reordered.
        """
        remaining = amount
        for r in sorted(self.facility(fid).enabling(activity), key=lambda x: x.id):
            if remaining <= 0:
                break
            take = min(r.quantity, remaining)
            r.quantity -= take
            r.reserved += take
            remaining -= take
        return amount - remaining

    def release(self, fid: str, activity: str, amount: float) -> None:
        """Give back capacity when a patient leaves, never above capacity."""
        remaining = amount
        for r in sorted(self.facility(fid).enabling(activity), key=lambda x: x.id):
            if remaining <= 0:
                break
            room = r.capacity - r.quantity
            give = min(room, remaining, r.reserved)
            r.quantity += give
            r.reserved -= give
            remaining -= give

    def occupancy_ratio(
        self, fid: str, category: str = SPACE, activity: str | None = None
    ) -> float:
        """Used over total — for one activity when named, else a whole category.

        The activity form is the one that usually matters, and leaving it out is
        a trap the example policies fell into on the first run. Aggregating the
        `space` category mixes ten ICU beds with sixty ward beds: the ICU can be
        at 100% with forty critical patients unserved while the facility reports
        44%. A rule keyed on the category would never see the shortage, and the
        number it read would look perfectly reasonable.

        Returns 0.0 when there is no capacity at all. That is a real ambiguity —
        a destroyed facility and an empty one read the same — so a policy that
        cares about destruction should test `capacity`, not occupancy.
        """
        rs = (
            self.facility(fid).enabling(activity)
            if activity is not None
            else self.facility(fid).by_category(category)
        )
        cap = sum(r.capacity for r in rs)
        if cap <= 0:
            return 0.0
        used = sum(r.capacity - r.quantity for r in rs)
        return used / cap

    def capacity_of(self, fid: str, category: str | None = None, activity: str | None = None) -> float:
        """Total capacity, so a rule can tell "destroyed" from "empty"."""
        f = self.facility(fid)
        rs = f.enabling(activity) if activity is not None else (
            f.by_category(category) if category is not None else list(f.resources.values())
        )
        return sum(r.capacity for r in rs)

    def total(self, category: str, facility_ids: Iterable[str] | None = None) -> float:
        ids = list(facility_ids) if facility_ids is not None else list(self.facilities)
        return sum(r.quantity for fid in ids for r in self.facility(fid).by_category(category))
