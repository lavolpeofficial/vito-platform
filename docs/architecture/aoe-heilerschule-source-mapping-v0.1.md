# AOE Heiler-Ausbildung Source Mapping v0.1

Status: Draft preparation artifact
Source: 2024 Heiler-Ausbildung topic outline supplied by Alessandro
Purpose: prepare structured ingestion for later joint review

## Source handling rule

This mapping preserves source terminology where useful but does not validate medical or metaphysical claims. It prepares classification and later extraction into AOE/Osservatore knowledge objects.

## Source-level classification

The source combines:
- coaching/communication methods
- psychology-adjacent material
- somatic/body-awareness concepts
- trance/meditation/breath practices
- relationship/family themes
- symbolic/spiritual/metaphysical models
- health and disease explanations
- Germanische Neue Medizin / biological-conflict claims
- healing/intervention claims

Therefore the source must be split by concept. The whole document must never receive one epistemic label.

## High-value Osservatore themes

### Perception and state observation
Candidate domains:
- perception
- communication
- somatic-awareness
- stress-regulation

Source topics:
- nonverbal communication
- emotions and feelings
- body reactions
- psychophysiological markers
- VAKOG
- rapport
- resource states
- consciousness/trance states
- sensitivity/intuitive observation

Candidate outputs:
- observation patterns
- state-change questions
- regulation prompts
- context markers

### Coaching and change work
Candidate domains:
- coaching
- behavior-patterns
- beliefs
- self-reflection
- trauma-related-reflection

Source topics:
- belief systems
- behavior patterns
- trigger/recurrence concepts
- inner-child work
- timeline work
- regression/progression techniques
- hypnosystemic work
- client guidance
- questioning/conversation
- meditation
- breathing exercises

Default epistemic target:
- PRACTICE_MODEL unless separately verified

### Relationships and family systems
Candidate domains:
- relationships
- family-systems
- identity
- grief-loss

Source topics:
- childhood and parents
- partnership
- family/children
- ancestry/family tree
- pregnancy/parenthood themes
- grief and loss
- secondary gain

Candidate outputs:
- relationship-system patterns
- intergenerational reflection questions
- loss/grief orientation prompts
- role/boundary questions

### Symbolic and spiritual models
Candidate domains:
- spirituality
- symbolic-models

Source topics:
- soul/incarnation
- soul plan/fate/karma
- subtle bodies
- chakras
- higher self/source
- karmic knots
- previous lives
- energetic bindings/foreign energies
- curses/hexes
- remote healing
- healing constructs/rings

Default epistemic target:
- SYMBOLIC_SPIRITUAL_MODEL

Required constraint:
- optional perspective only
- not established fact
- no medical causation or treatment authority

### Health-related contested material
Candidate domain:
- health

Source topics:
- Germanische Neue Medizin
- biological conflicts
- five biological natural laws
- disease phases
- disease causes according to GNM
- organ/system disease-cause mappings
- oncology explanations
- claims about reducing symptoms with less/no medication
- healing methods framed as treatment

Default epistemic target:
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM

Required constraints:
- never use as established medical diagnosis or causal explanation
- never discourage appropriate medical assessment/treatment
- never infer disease from psychological/spiritual pattern alone
- preserve as source claim/reference only until separate evidence review

## Block mapping

### Block 1
Source themes:
- soul creation/incarnation
- soul plan/fate/karma
- existence principles
- human gross/subtle structure
- thinking/acting/feeling
- body-psyche connection
- VAKOG
- trance states
- rapport/track/resource states
- sensitivity, meditation, breathing
- healing constructs

Initial split:
- PRACTICE_MODEL: VAKOG, rapport, resource-state work, meditation/breath practice candidates
- SYMBOLIC_SPIRITUAL_MODEL: soul/incarnation, karma, subtle structure, healing constructs
- NEEDS_EVIDENCE_REVIEW: claims about body/psyche mechanisms if expressed medically

### Block 2
Source themes:
- chakras/subtle bodies
- higher self/source
- karmic knots/talents/calling
- numerology/astrology basics
- GNM/germ layers
- biological conflicts/five laws
- disease causes/phases
- patterns/trauma/recurrence/trigger
- client guidance/psychophysiological markers
- protection/remote healing

Initial split:
- PRACTICE_MODEL: talent/calling reflection, pattern/trigger exploration, client-guidance structures
- SYMBOLIC_SPIRITUAL_MODEL: chakras, higher self, karma, numerology/astrology, protection/remote healing
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM: GNM/germ-layer disease interpretation, biological laws, disease-cause claims

### Block 3
Source themes:
- foreign energies/energetic bindings
- childhood/parents
- inner child/trauma/beliefs
- DHS/recurrence/trigger/symptom
- partnership/soulmate
- pregnancy/child health
- reproductive/hormonal system
- organ/system disease causes according to GNM
- regression with symptom
- ancestry/family tree

Initial split:
- PRACTICE_MODEL: childhood, parents, inner-child, beliefs, relationship and family-tree reflection
- SYMBOLIC_SPIRITUAL_MODEL: foreign energies, energetic bindings, soulmate, ancestry-healing claims
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM: DHS/biological-conflict symptom causation, reproductive/hormonal disease-cause mapping, GNM organ mappings

### Block 4
Source themes:
- psyche/soul
- energetic cleansing/regeneration/activation
- mesoderm/ectoderm
- bones/spine/teeth
- joints/muscles/ligaments
- lymph, kidneys, skin/allergies, cardiovascular system
- animal healing

Initial split:
- SYMBOLIC_SPIRITUAL_MODEL: energetic cleansing/activation, animal healing if framed energetically
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM: germ-layer/system disease-cause mappings and healing claims
- POSSIBLE EVIDENCE_BASED SOURCE REQUIRED: basic anatomy/system references only after replacement/verification from authoritative sources

### Block 5
Source themes:
- death
- grief/loss
- previous lives
- nervous system/brain/sleep
- immune system/allergies
- digestion/excretion/respiration
- secondary disease gain
- pain work
- EMI trauma technique
- GNM disease causes/healing work

Initial split:
- PRACTICE_MODEL: grief/loss support, secondary-gain reflection, pain coping/reflection, trauma-work candidates subject to safety review
- SYMBOLIC_SPIRITUAL_MODEL: previous lives
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM: disease-cause/healing claims linked to organs/systems/GNM
- NEEDS_EVIDENCE_REVIEW: any EMI technique claims before user-facing therapeutic framing

### Block 6
Source themes:
- curses/hexes
- addictions causes/healing
- phobias/anxiety/panic
- oncology
- eyes/ears
- children
- harmonization/success
- organ/system disease causes according to GNM
- healer practice

Initial split:
- SYMBOLIC_SPIRITUAL_MODEL: curses/hexes, harmonization constructs if metaphysical
- PRACTICE_MODEL: success reflection, client-practice process candidates
- HIGH_RISK HEALTH REVIEW: addiction, phobia, panic, oncology, child-health and sensory-system claims/interventions
- CONTESTED_OR_UNVALIDATED_HEALTH_CLAIM: GNM-linked disease-cause/healing claims

## Pattern candidates for later extraction

These are candidates only, not yet canonical:

### RECURRING_TRIGGER_PATTERN
Observation:
- strong or repetitive reaction linked to recurring context
Questions:
- what happened immediately before the reaction?
- where else is this pattern familiar?
- what body sensations appear first?
- what interpretation follows?
- what changes if another interpretation is tested?
Epistemic target:
- PRACTICE_MODEL
Safety:
- no medical causation inference

### RESOURCE_STATE_DEFICIT
Observation:
- person remains problem-focused and cannot access stabilizing state/resources
Questions:
- when have you handled something similar better?
- what changes physically in a safer/calmer state?
- what environmental or social resource is available?
Intervention candidates:
- grounding
- breathing
- resource recall
- small behavioral step

### RELATIONSHIP_PATTERN_REENACTMENT
Observation:
- recurring interpersonal pattern across relationships
Questions:
- what role do you repeatedly take?
- what do you expect from the other person?
- which boundary is unclear?
- when did this interaction pattern first become familiar?
Safety:
- hypothesis only; no definitive childhood/ancestral causation

### SYMBOLIC_MEANING_REQUEST
Observation:
- user explicitly seeks spiritual/symbolic interpretation
Behavior:
- offer optional symbolic lens
- label it clearly as symbolic/spiritual
- do not replace evidence-based health/legal/financial guidance

## Knowledge objects to create later

For each accepted source theme, later create:
- concept object
- pattern candidate
- question candidates
- intervention class candidates
- safety constraints
- source provenance
- epistemic label
- review state

## Explicit exclusions from automatic canon

Do not automatically canonize:
- GNM disease causation
- five biological laws as medical fact
- organ-conflict disease mappings
- medication-reduction promises
- remote-healing efficacy claims
- energetic diagnosis
- curses/foreign energies as objective causal findings
- oncology/healing claims

These remain source claims or symbolic/contested models unless separately reviewed.

## Next human review

When Alessandro is back at the workstation, jointly review:
1. which concepts reflect his own learned/practiced methods
2. which concepts he wants retained only as historical/source knowledge
3. which concepts should become Osservatore practice models
4. which symbolic lenses should be opt-in
5. which health claims should be quarantined or excluded from user-facing operation
6. which topics require authoritative external evidence replacement
