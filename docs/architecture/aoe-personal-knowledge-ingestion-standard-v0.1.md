# AOE Personal Knowledge Ingestion Standard v0.1

Status: Draft preparation artifact
Scope: AOE / Osservatore / VITO knowledge preparation

## Goal

Provide a governed method for converting personal education, coaching experience, domain expertise and symbolic/spiritual frameworks into structured, traceable AOE knowledge without collapsing all material into undifferentiated RAG text.

## Core principle

Source material is not automatically canonical knowledge.

Every imported item must pass through:

Source -> Extracted Claim/Concept -> Epistemic Classification -> Domain Mapping -> Pattern/Question/Intervention Candidate -> Safety Constraints -> Provenance -> Human Review -> Canonical or Non-Canonical Status

## Epistemic classes

### EVIDENCE_BASED
Use for claims/models that are intended to align with established empirical or professional evidence.

Requirements:
- provenance required
- evidence basis must be externally verifiable before canonical health/science use
- confidence and review date required for high-impact domains

### PRACTICE_MODEL
Use for coaching, facilitation and reflective models that may be useful in practice without being treated as objective scientific truth.

Examples:
- resource activation
- belief exploration
- inner-child framing as a reflective model
- timeline work as a coaching/reflection tool
- rapport and structured questioning

Allowed use:
- hypothesis generation
- reflection prompts
- coaching dialogue
- perspective expansion

Not allowed:
- asserting causal medical truth solely from the model

### SYMBOLIC_SPIRITUAL_MODEL
Use for metaphysical, symbolic or spiritual frameworks.

Examples may include:
- karma
- soul plan
- chakras
- higher self
- previous lives
- energetic bindings
- symbolic ancestry work

Allowed use:
- optional perspective when context/user preference permits
- symbolic meaning-making
- reflective questions

Required framing:
- explicitly non-absolute
- not presented as established scientific fact
- not used as sole basis for medical, legal or financial action

### CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM
Use for health/medical explanations or intervention claims that are disputed, unvalidated or unsuitable for presentation as established medical fact.

Required handling:
- retain source provenance
- never silently promote to evidence-based status
- may be referenced as a claim/model from a source
- must not be used to diagnose, discourage appropriate medical care, or claim proven disease causation
- requires explicit health-safety review before any user-facing health output

### PERSONAL_EXPERIENCE
Use for lessons derived from lived/professional experience rather than formal evidence.

Allowed use:
- heuristic generation
- case-pattern hypotheses
- questions
- practical operating principles

Required handling:
- attributed to experience
- separate from verified fact

### CREATIVE_HYPOTHESIS
Use for new synthesized ideas created by AOE or the human operator.

Required handling:
- never treated as established fact
- can be tested, compared and promoted only after review

## Core knowledge object

Recommended v0.1 logical object:

- knowledgeObjectId
- sourceId
- sourceType
- sourceTitle
- sourceLocation/page/section
- extractedTextRef
- conceptName
- claimOrModel
- domainTags[]
- epistemicClass
- confidence
- riskClass
- intendedUse[]
- prohibitedUse[]
- patternCandidates[]
- questionCandidates[]
- interventionCandidates[]
- safetyConstraints[]
- provenance
- humanReviewStatus
- canonicalStatus
- version
- createdAt
- reviewedAt

## Domain tags — initial set

- psychology
- coaching
- communication
- perception
- somatic-awareness
- stress-regulation
- trauma-related-reflection
- relationships
- family-systems
- grief-loss
- behavior-patterns
- beliefs
- identity
- self-reflection
- spirituality
- symbolic-models
- health
- nutrition
- movement
- leadership
- sales
- recruiting
- entrepreneurship
- ai-systems
- hygiene

## Transformation targets

Source content should be transformed into one or more of:

### Concept
A named model, principle or construct.

### Pattern
A repeatable observation structure usable by Osservatore.

### Question
A context-sensitive inquiry prompt.

### InterventionCandidate
A possible next-step class, not an automatic prescription.

### Constraint
A safety, governance or domain boundary.

### EvidenceNote
A note about support, uncertainty or contested status.

## AOE / VITO boundary

AOE / Osservatore owns:
- interpretation
- epistemic classification
- pattern matching
- orientation hypotheses
- question selection
- intervention recommendation
- safety classification

VITO owns:
- task planning
- delegation
- execution
- monitoring
- human-gate handling
- reporting

VITO must not bypass AOE epistemic/safety metadata when acting on an OrientationResult.

## Human review states

- UNREVIEWED
- TRIAGED
- NEEDS_EVIDENCE_REVIEW
- NEEDS_SAFETY_REVIEW
- APPROVED_NON_CANONICAL
- APPROVED_CANONICAL
- REJECTED
- ARCHIVED

## Canonicalization rules

A source-derived item may become canonical only when:
- provenance is intact
- epistemic class is assigned
- intended/prohibited use is defined
- safety constraints are present where relevant
- human review is complete
- no contradictory governance rule blocks promotion

## Health-domain rule

Health-related source material must never be canonicalized merely because it appears in a course or was taught by an instructor. Claims about disease causation, treatment, medication reduction or diagnosis require a separate evidence/safety review.

## Ingestion workflow v0.1

1. Register source
2. Extract sections/topics
3. Create concept/claim candidates
4. Assign domain tags
5. Assign epistemic class
6. Assign risk class
7. Generate pattern/question/intervention candidates
8. Attach safety constraints
9. Preserve provenance
10. Human review
11. Canonicalize, retain as non-canonical reference, or reject

## Non-goals

- automatic truth determination from source text
- silent correction of source beliefs
- replacing expert medical review
- placing all personal education into one system prompt
- treating symbolic systems as universal facts
- using unvalidated health claims as clinical guidance

## First pilot source

The first pilot source for this standard is the 2024 Heiler-Ausbildung topic document supplied by Alessandro. It is to be treated as a source inventory and methodology map, not as automatically verified medical knowledge.
