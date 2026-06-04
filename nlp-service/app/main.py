from __future__ import annotations

from fastapi import FastAPI

from app.context import extract_contexts
from app.embeddings import search_span
from app.ner import extract_spans
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

app = FastAPI(
    title="Obscyro NLP — Clinical extraction",
    description="Concept extraction (NER + embeddings) and context extraction (ConText rules). No generative LLM.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    from app.config import SNOMED_SOURCE
    from app.pg_index import pg_embedding_count, pg_health_ok

    body: dict = {"status": "ok", "snomed_source": SNOMED_SOURCE}
    try:
        count = pg_embedding_count()
        body["snomed_embedding_rows"] = count
        if count == 0:
            body["status"] = "degraded"
            body["warning"] = "snomed.description_embeddings is empty; run populate_embeddings.py"
        elif not pg_health_ok():
            body["status"] = "degraded"
    except Exception as exc:
        body["status"] = "degraded"
        body["warning"] = str(exc)
    return body


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
