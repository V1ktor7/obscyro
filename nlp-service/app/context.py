from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

from app.config import (
    CONTEXT_DEFAULT_CONF,
    CONTEXT_TRIGGER_CONF,
    CONTEXT_WINDOW_CHARS,
    LEXICON_DIR,
)
from app.schemas import (
    AxisOut,
    ConceptInput,
    ContextAxesOut,
    ContextOut,
    Language,
)
from app.pg_index import get_concept_display


def _display_for_code(code: str | None, fallback: str) -> str:
    if code:
        name = get_concept_display(code)
        if name:
            return name
    return fallback


@lru_cache(maxsize=1)
def _lexicons() -> dict:
    out = {}
    for name in ("fr_context.yaml", "en_context.yaml"):
        with open(LEXICON_DIR / name, encoding="utf-8") as f:
            out[name[:2]] = yaml.safe_load(f)
    return out


def _window(text: str, span: str) -> str:
    idx = text.lower().find(span.lower())
    if idx < 0:
        return text[:CONTEXT_WINDOW_CHARS * 2]
    start = max(0, idx - CONTEXT_WINDOW_CHARS)
    end = min(len(text), idx + len(span) + CONTEXT_WINDOW_CHARS)
    return text[start:end]


def _find_trigger(window: str, triggers: list[str]) -> tuple[str | None, int]:
    lower = window.lower()
    best: tuple[str | None, int] = (None, -1)
    for t in sorted(triggers, key=len, reverse=True):
        tl = t.lower()
        pos = lower.find(tl)
        if pos >= 0 and (best[1] < 0 or pos < best[1]):
            best = (t, pos)
    return best


def _axis(
    window: str,
    triggers: list[str],
    default_value: str,
    matched_value: str,
) -> AxisOut:
    trigger, _ = _find_trigger(window, triggers)
    if trigger:
        return AxisOut(value=matched_value, confidence=CONTEXT_TRIGGER_CONF, trigger=trigger)
    return AxisOut(value=default_value, confidence=CONTEXT_DEFAULT_CONF, trigger=None)


def extract_context_for_concept(
    text: str,
    concept: ConceptInput,
    language: Language = "auto",
) -> ContextOut:
    lang_key = "fr" if language == "fr" or (
        language == "auto" and any(
            m in text.lower() for m in ("nie", "père", "consulte", "écarter")
        )
    ) else "en"
    if language == "en":
        lang_key = "en"

    lex = _lexicons()[lang_key]
    window = _window(text, concept.span)
    span_lower = concept.span.lower()

    negation_triggers = lex.get("negation", [])
    family_triggers = lex.get("family", [])
    hedge_triggers = lex.get("hedge", [])
    past_triggers = lex.get("temporal_past", [])
    chronic_triggers = lex.get("temporal_chronic", [])
    rfe_triggers = lex.get("reason_for_encounter", [])
    history_triggers = lex.get("history", [])

    neg_hit = _find_trigger(window, negation_triggers)
    hedge_hit_early = _find_trigger(window, hedge_triggers)
    if neg_hit[0]:
        assertion = AxisOut(value="negated", confidence=CONTEXT_TRIGGER_CONF, trigger=neg_hit[0])
    elif hedge_hit_early[0] and (
        "écarter" in span_lower or "rule out" in window.lower() or "écarter" in window.lower()
    ):
        assertion = AxisOut(value="uncertain", confidence=CONTEXT_TRIGGER_CONF, trigger=hedge_hit_early[0])
    else:
        assertion = AxisOut(value="affirmed", confidence=CONTEXT_DEFAULT_CONF, trigger=None)

    subject = _axis(window, family_triggers, "patient", "family")
    if _find_trigger(window, family_triggers)[0]:
        subject = AxisOut(
            value="family",
            confidence=CONTEXT_TRIGGER_CONF,
            trigger=_find_trigger(window, family_triggers)[0],
        )
    else:
        subject = AxisOut(value="patient", confidence=CONTEXT_DEFAULT_CONF, trigger=None)

    temporality = AxisOut(value="current", confidence=CONTEXT_DEFAULT_CONF, trigger=None)
    if _find_trigger(window, chronic_triggers)[0]:
        temporality = AxisOut(
            value="chronic",
            confidence=CONTEXT_TRIGGER_CONF,
            trigger=_find_trigger(window, chronic_triggers)[0],
        )
    elif _find_trigger(window, past_triggers)[0]:
        temporality = AxisOut(
            value="past",
            confidence=CONTEXT_TRIGGER_CONF,
            trigger=_find_trigger(window, past_triggers)[0],
        )

    certainty = AxisOut(value="confirmed", confidence=CONTEXT_DEFAULT_CONF, trigger=None)
    hedge_hit = _find_trigger(window, hedge_triggers)
    if hedge_hit[0] and ("écarter" in hedge_hit[0].lower() or "rule out" in hedge_hit[0].lower()):
        certainty = AxisOut(value="differential", confidence=CONTEXT_TRIGGER_CONF, trigger=hedge_hit[0])
    elif hedge_hit[0]:
        certainty = AxisOut(value="suspected", confidence=CONTEXT_TRIGGER_CONF, trigger=hedge_hit[0])

    role = AxisOut(value="finding", confidence=CONTEXT_DEFAULT_CONF, trigger=None)
    rfe_hit = _find_trigger(window, rfe_triggers)
    hist_hit = _find_trigger(window, history_triggers)
    if rfe_hit[0] and span_lower in ("douleur thoracique", "chest pain"):
        role = AxisOut(value="reason_for_encounter", confidence=CONTEXT_TRIGGER_CONF, trigger=rfe_hit[0])
    elif hist_hit[0] and subject.value == "family":
        role = AxisOut(value="history", confidence=CONTEXT_TRIGGER_CONF, trigger=hist_hit[0])

    axes = ContextAxesOut(
        assertion=assertion,
        subject=subject,
        temporality=temporality,
        certainty=certainty,
        role=role,
    )

    confs = [a.confidence for a in [assertion, subject, temporality, certainty, role] if a]
    context_confidence = round(min(confs), 4) if confs else CONTEXT_DEFAULT_CONF

    display = _display_for_code(concept.code, concept.span)
    readable = _readable_note(display, axes, lang_key)

    return ContextOut(
        code=concept.code,
        span=concept.span,
        context=axes,
        context_confidence=context_confidence,
        readable_note=readable,
    )


def _readable_note(display: str, axes: ContextAxesOut, lang: str) -> str:
    parts: list[str] = [display]
    if axes.assertion:
        if axes.assertion.value == "negated":
            parts.append("NIÉE" if lang == "fr" else "NEGATED")
        elif axes.assertion.value == "uncertain":
            parts.append("INCERTAIN" if lang == "fr" else "UNCERTAIN")
    if axes.subject and axes.subject.value == "family":
        parts.append("chez le PÈRE / famille" if lang == "fr" else "FAMILY subject")
    if axes.temporality and axes.temporality.value == "past":
        parts.append("passé" if lang == "fr" else "past")
    if axes.temporality and axes.temporality.value == "chronic":
        parts.append("chronique" if lang == "fr" else "chronic")
    if axes.certainty and axes.certainty.value == "differential":
        parts.append("À ÉCARTER (différentiel)" if lang == "fr" else "DIFFERENTIAL")
    return " — ".join(parts)


def extract_contexts(
    text: str,
    concepts: list[ConceptInput],
    language: Language = "auto",
) -> list[ContextOut]:
    return [extract_context_for_concept(text, c, language) for c in concepts]
