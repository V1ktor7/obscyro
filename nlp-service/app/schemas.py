from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["en", "fr", "auto"]
ConceptStatus = Literal["resolved", "flag", "unresolved"]
Destination = Literal["research", "problem_list"]
Decision = Literal["accept", "flag", "escalate"]

AssertionValue = Literal["affirmed", "negated", "uncertain"]
SubjectValue = Literal["patient", "family", "other"]
TemporalityValue = Literal["current", "past", "chronic"]
CertaintyValue = Literal["confirmed", "differential", "suspected"]
RoleValue = Literal["finding", "reason_for_encounter", "history"]


class ConceptsRequest(BaseModel):
    text: str = Field(min_length=1)
    language: Language = "auto"


class CandidateOut(BaseModel):
    code: str
    display: str
    cosine: float


class ConceptOut(BaseModel):
    span: str
    candidates: list[CandidateOut]
    code: str | None
    cosine: float
    margin: float
    concept_confidence: float
    status: ConceptStatus


class ConceptsResponse(BaseModel):
    concepts: list[ConceptOut]


class ConceptInput(BaseModel):
    span: str
    code: str | None = None


class ContextsRequest(BaseModel):
    text: str = Field(min_length=1)
    language: Language = "auto"
    concepts: list[ConceptInput] = Field(min_length=1)


class AxisOut(BaseModel):
    value: str
    confidence: float
    trigger: str | None = None


class ContextAxesOut(BaseModel):
    assertion: AxisOut | None = None
    subject: AxisOut | None = None
    temporality: AxisOut | None = None
    certainty: AxisOut | None = None
    role: AxisOut | None = None


class ContextOut(BaseModel):
    code: str | None
    span: str
    context: ContextAxesOut
    context_confidence: float
    readable_note: str


class ContextsResponse(BaseModel):
    contexts: list[ContextOut]


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)
    language: Language = "auto"
    destination: Destination = "research"


class ExtractResultOut(BaseModel):
    span: str
    candidates: list[CandidateOut]
    code: str | None
    cosine: float
    margin: float
    concept_confidence: float
    status: ConceptStatus
    context: ContextAxesOut
    context_confidence: float
    readable_note: str
    decision: Decision


class ExtractResponse(BaseModel):
    destination: Destination
    results: list[ExtractResultOut]
