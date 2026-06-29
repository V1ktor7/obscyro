"""Contact-graph construction from a scenario-branch graph payload.

Pure-Python port of backend buildContactGraphFromCopy. Location/containment
links define which unit a node belongs to; contact links define adjacency.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.config import LOCATION_LINK_NAMES, UNIT_TYPE_NAMES
from app.schemas import GraphPayload, Intervention


@dataclass
class ContactNode:
    id: str
    type: str
    properties: dict
    unit_id: str | None


@dataclass
class ContactGraph:
    nodes: dict[str, ContactNode]
    adjacency: dict[str, list[str]]
    node_ids: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.node_ids:
            self.node_ids = list(self.nodes.keys())

    @property
    def size(self) -> int:
        return len(self.nodes)


def _is_unit_type(type_name: str) -> bool:
    return type_name.strip().lower() in UNIT_TYPE_NAMES


def build_contact_graph(payload: GraphPayload) -> ContactGraph:
    node_to_unit: dict[str, str] = {}
    for link in payload.links:
        if link.linkTypeName.strip().lower() in LOCATION_LINK_NAMES:
            node_to_unit[link.fromId] = link.toId

    nodes: dict[str, ContactNode] = {}
    for inst in payload.nodes:
        unit_id = inst.id if _is_unit_type(inst.type) else node_to_unit.get(inst.id)
        nodes[inst.id] = ContactNode(
            id=inst.id,
            type=inst.type,
            properties=dict(inst.properties or {}),
            unit_id=unit_id,
        )

    adjacency: dict[str, list[str]] = {nid: [] for nid in nodes}
    for link in payload.links:
        if link.linkTypeName.strip().lower() in LOCATION_LINK_NAMES:
            continue
        if link.fromId not in nodes or link.toId not in nodes:
            continue
        adjacency[link.fromId].append(link.toId)
        adjacency[link.toId].append(link.fromId)

    return ContactGraph(nodes=nodes, adjacency=adjacency)


def count_contact_edges(graph: ContactGraph) -> int:
    total = sum(len(neigh) for neigh in graph.adjacency.values())
    return total // 2


def apply_intervention(graph: ContactGraph, intervention: Intervention | None) -> tuple[ContactGraph, dict]:
    """Structural do-operator. Returns a NEW graph plus a description for provenance.

    - close_unit: remove all contact edges for nodes in the unit (cohorting).
    - add_isolation_beds: handled at sim time via isolationCapacity bump; here we
      only record it (returned in the meta dict).
    """
    meta: dict = {"kind": intervention.kind if intervention else "none"}
    if not intervention or intervention.kind == "none":
        return graph, meta

    if intervention.kind == "close_unit" and intervention.unitId:
        meta["unitId"] = intervention.unitId
        closed = {
            nid for nid, n in graph.nodes.items() if n.unit_id == intervention.unitId
        }
        new_adj: dict[str, list[str]] = {}
        for nid, neigh in graph.adjacency.items():
            if nid in closed:
                new_adj[nid] = []
            else:
                new_adj[nid] = [m for m in neigh if m not in closed]
        meta["isolatedNodes"] = len(closed)
        return ContactGraph(nodes=dict(graph.nodes), adjacency=new_adj), meta

    if intervention.kind == "add_isolation_beds":
        meta["beds"] = int(intervention.beds or 0)
        return graph, meta

    return graph, meta
