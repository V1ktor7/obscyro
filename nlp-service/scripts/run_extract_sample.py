#!/usr/bin/env python3
"""Run /extract pipeline on stdin or argv text. Requires DATABASE_URL + populated embeddings."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.context import extract_contexts as do_ctx
from app.main import _decide, _extract_concepts_body
from app.schemas import ConceptInput, ContextsRequest, ExtractRequest


def main() -> None:
    text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    req = ExtractRequest(text=text, language="fr", destination="problem_list")
    concepts = _extract_concepts_body(req.text, req.language)
    ctx_req = ContextsRequest(
        text=req.text,
        language=req.language,
        concepts=[ConceptInput(span=c.span, code=c.code) for c in concepts],
    )
    contexts = do_ctx(ctx_req.text, ctx_req.concepts, ctx_req.language)
    ctx_by = {c.span: c for c in contexts}
    results = []
    for c in concepts:
        ctx = ctx_by.get(c.span)
        if not ctx:
            continue
        assertion = ctx.context.assertion.value if ctx.context.assertion else None
        certainty = ctx.context.certainty.value if ctx.context.certainty else None
        results.append(
            {
                "span": c.span,
                "code": c.code,
                "status": c.status,
                "cosine": c.cosine,
                "margin": c.margin,
                "context_confidence": ctx.context_confidence,
                "readable_note": ctx.readable_note,
                "decision": _decide(
                    c.status, req.destination, ctx.context_confidence, assertion, certainty
                ),
            }
        )
    print(json.dumps({"destination": req.destination, "results": results}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
