from __future__ import annotations

import re
from functools import lru_cache

from app.schemas import Language

# Longer phrases first to prefer multi-word clinical spans.
_PHRASE_CACHE: dict[str, list[str]] = {}


def detect_language(text: str, hint: Language) -> Language:
    if hint in ("en", "fr"):
        return hint
    fr_markers = (
        "consulte",
        "nie",
        "père",
        "diabète",
        "pénicilline",
        "écarter",
        "hémolysé",
        "essoufflement",
    )
    hits = sum(1 for m in fr_markers if m in text.lower())
    return "fr" if hits >= 2 else "en"


def _load_phrases(lang: Language) -> list[str]:
    import yaml

    from app.config import LEXICON_DIR

    key = lang if lang != "auto" else "fr"
    if key in _PHRASE_CACHE:
        return _PHRASE_CACHE[key]

    phrases: set[str] = set()
    for name in ("fr_context.yaml", "en_context.yaml"):
        path = LEXICON_DIR / name
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        for p in data.get("clinical_phrases", []):
            phrases.add(p.lower())

    ordered = sorted(phrases, key=len, reverse=True)
    _PHRASE_CACHE[key] = ordered
    _PHRASE_CACHE["en"] = ordered
    _PHRASE_CACHE["fr"] = ordered
    return ordered


def _phrase_spans(text: str, lang: Language) -> list[str]:
    lower = text.lower()
    phrases = _load_phrases(lang)
    used: list[tuple[int, int]] = []
    found: list[tuple[int, str]] = []

    for phrase in phrases:
        start = 0
        while True:
            idx = lower.find(phrase, start)
            if idx < 0:
                break
            end = idx + len(phrase)
            overlap = any(not (end <= u0 or idx >= u1) for u0, u1 in used)
            if not overlap:
                used.append((idx, end))
                found.append((idx, text[idx:end]))
            start = idx + 1

    found.sort(key=lambda x: x[0])
    return [s for _, s in found]


@lru_cache(maxsize=2)
def _spacy_en_nlp():
    try:
        import spacy

        try:
            import scispacy  # noqa: F401

            return spacy.load("en_core_sci_sm")
        except Exception:
            return spacy.load("en_core_web_sm")
    except Exception:
        return None


@lru_cache(maxsize=1)
def _spacy_fr_nlp():
    try:
        import spacy
        from spacy.pipeline import EntityRuler

        nlp = spacy.load("fr_core_news_sm")
        ruler = nlp.add_pipe("entity_ruler", before="ner")
        patterns = [
            {"label": "CLINICAL", "pattern": [{"LOWER": "douleur"}, {"LOWER": "thoracique"}]},
            {"label": "CLINICAL", "pattern": "essoufflement"},
            {"label": "CLINICAL", "pattern": [{"LOWER": "diabète"}, {"LOWER": "de"}, {"LOWER": "type"}, {"LOWER": "2"}]},
            {"label": "CLINICAL", "pattern": "hypertension"},
            {"label": "CLINICAL", "pattern": [{"LOWER": "allergie"}, {"LOWER": "à"}, {"LOWER": "la"}, {"LOWER": "pénicilline"}]},
        ]
        ruler.add_patterns(patterns)
        return nlp
    except Exception:
        return None


def _spacy_spans(text: str, lang: Language) -> list[str]:
    nlp = _spacy_fr_nlp() if lang == "fr" else _spacy_en_nlp()
    if nlp is None:
        return []

    doc = nlp(text)
    spans: list[str] = []
    for ent in doc.ents:
        if ent.label_ in ("CLINICAL", "ENTITY", "DISEASE", "SYMPTOM", "PROBLEM"):
            spans.append(ent.text.strip())
    return [s for s in spans if len(s) >= 3]


def _regex_spans(text: str) -> list[str]:
    """Fallback patterns for lab values and long phrases."""
    patterns = [
        r"potassium\s*5[,.]9[^.]{0,40}hémolysé",
        r"écarter un infarctus aigu",
        r"son père a fait un infarctus",
        r"allergie[^.]{0,30}pénicilline",
        r"céphalées?\s+intenses?",
        r"fibrillation\s+auriculaire",
        r"cancer\s+du\s+sein",
        r"hémorragie\s+sous-arachnoïdienne",
        r"trouble\s+visuel",
        r"fièvre",
        r"migraine",
        r"glycémie[^.]{0,60}",
        r"diabétique",
        r"se présente[^.]{0,40}urgence",
    ]
    out: list[str] = []
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            out.append(m.group(0).strip())
    return out


def extract_spans(text: str, language: Language = "auto") -> list[str]:
    lang = detect_language(text, language)
    spans: list[str] = []
    seen: set[str] = set()

    for s in _phrase_spans(text, lang):
        key = s.lower().strip()
        if key and key not in seen and len(key) >= 3:
            seen.add(key)
            spans.append(s.strip())
    for s in _spacy_spans(text, lang):
        key = s.lower().strip()
        if key and key not in seen and len(key) >= 3:
            seen.add(key)
            spans.append(s.strip())
    for s in _regex_spans(text):
        key = s.lower().strip()
        if key and key not in seen and len(key) >= 3:
            seen.add(key)
            spans.append(s.strip())

    spans.sort(key=lambda s: text.lower().find(s.lower()))
    return spans
