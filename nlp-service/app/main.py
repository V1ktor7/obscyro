from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.context import extract_contexts
from app.embeddings import encode_texts, get_encoder, search_span
from app.ner import extract_spans
from app.pg_index import pg_embedding_count
from app.populate import progress as populate_progress, start_auto_populate
from app.schemas import (
    ConceptInput,
    ConceptOut,
    ConceptsRequest,
    ConceptsResponse,
    ContextsRequest,
    ContextsResponse,
    Decision,
    Destination,
    ExtractRequest,
    ExtractResponse,
    ExtractResultOut,
)

_model_loaded = False


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # Preload the embedding model before uvicorn accepts requests: the first
    # SentenceTransformer load takes tens of seconds (plus a HuggingFace
    # download on a cold cache), which would otherwise blow the backend's
    # proxy timeout and burn a channel-job retry. With the preload here, the
    # container healthcheck only turns healthy once extraction actually works.
    global _model_loaded
    get_encoder()
    encode_texts(["warm-up"])
    _model_loaded = True
    # Self-heal: if SNOMED embeddings are missing (fresh prod DB), embed them
    # in a background thread using this container's model + DATABASE_URL.
    start_auto_populate()
    yield


app = FastAPI(
    title="Obscyro NLP — Clinical extraction",
    description="Concept extraction (NER + embeddings) and context extraction (ConText rules). No generative LLM.",
    version="0.1.0",
    lifespan=_lifespan,
)

_EMBEDDING_COUNT_TTL_S = 60.0
_embedding_count_cache: tuple[float, int | None] = (0.0, None)


def _cached_embedding_count() -> int | None:
    """SNOMED embedding row count, cached ~60s. None when the DB is unreachable."""
    global _embedding_count_cache
    ts, value = _embedding_count_cache
    now = time.monotonic()
    if now - ts < _EMBEDDING_COUNT_TTL_S:
        return value
    try:
        value = pg_embedding_count()
    except Exception:
        value = None
    _embedding_count_cache = (now, value)
    return value


@app.get("/health")
def health() -> dict:
    """Readiness probe: the model is loaded (lifespan ran) and SNOMED vectors exist."""
    return {
        "status": "ok" if _model_loaded else "loading",
        "model_loaded": _model_loaded,
        "snomed_embedding_rows": _cached_embedding_count(),
        "populate": dict(populate_progress),
    }


def _extract_concepts_body(text: str, language: str) -> list[ConceptOut]:
    spans = extract_spans(text, language)  # type: ignore[arg-type]
    concepts: list[ConceptOut] = []
    if not spans:
        return concepts
    for span in spans:
        candidates, cosine, margin, status, code = search_span(span)
        concepts.append(
            ConceptOut(
                span=span,
                candidates=candidates,
                code=code,
                cosine=cosine,
                margin=margin,
                concept_confidence=cosine,
                status=status,
            )
        )
    return concepts


@app.post("/extract/concepts", response_model=ConceptsResponse)
def extract_concepts(req: ConceptsRequest) -> ConceptsResponse:
    return ConceptsResponse(concepts=_extract_concepts_body(req.text, req.language))


@app.post("/extract/contexts", response_model=ContextsResponse)
def extract_contexts_route(req: ContextsRequest) -> ContextsResponse:
    return ContextsResponse(
        contexts=extract_contexts(req.text, req.concepts, req.language),
    )


def _decide(
    status: str,
    destination: Destination,
    context_confidence: float,
    assertion_value: str | None,
    certainty_value: str | None,
) -> Decision:
    if status in ("flag", "unresolved"):
        return "escalate"
    if destination == "problem_list":
        if assertion_value == "negated":
            return "accept"
        if assertion_value == "uncertain" or certainty_value == "differential":
            return "escalate"
        if context_confidence < 0.85:
            return "flag"
    if status == "resolved" and context_confidence >= 0.85:
        return "accept"
    if assertion_value == "uncertain" or certainty_value == "differential":
        return "escalate"
    return "flag"


@app.post("/extract", response_model=ExtractResponse)
def extract_combined(req: ExtractRequest) -> ExtractResponse:
    concepts = _extract_concepts_body(req.text, req.language)
    ctx_req = ContextsRequest(
        text=req.text,
        language=req.language,
        concepts=[ConceptInput(span=c.span, code=c.code) for c in concepts],
    )
    contexts = extract_contexts(ctx_req.text, ctx_req.concepts, ctx_req.language)
    ctx_by_span = {c.span: c for c in contexts}

    results: list[ExtractResultOut] = []
    for concept in concepts:
        ctx = ctx_by_span.get(concept.span)
        if not ctx:
            continue
        assertion = ctx.context.assertion.value if ctx.context.assertion else None
        certainty = ctx.context.certainty.value if ctx.context.certainty else None
        decision = _decide(
            concept.status,
            req.destination,
            ctx.context_confidence,
            assertion,
            certainty,
        )
        results.append(
            ExtractResultOut(
                span=concept.span,
                candidates=concept.candidates,
                code=concept.code,
                cosine=concept.cosine,
                margin=concept.margin,
                concept_confidence=concept.concept_confidence,
                status=concept.status,
                context=ctx.context,
                context_confidence=ctx.context_confidence,
                readable_note=ctx.readable_note,
                decision=decision,
            )
        )

    return ExtractResponse(destination=req.destination, results=results)
