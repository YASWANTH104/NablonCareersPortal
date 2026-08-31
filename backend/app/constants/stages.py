"""Single source of truth for the applications pipeline: valid stage
transitions and notification labels. Imported by app/services/application_service.py —
do not duplicate this dict anywhere else in the backend."""

VALID_TRANSITIONS = {
    "applied":        ["screening", "rejected"],
    "screening":      ["assessment", "tr1", "rejected"],
    "assessment":     ["tr1", "rejected", "interview_drop"],
    "tr1":            ["tr2", "hr", "offer", "rejected", "interview_drop"],
    "tr2":            ["hr", "offer", "rejected", "interview_drop"],
    "hr":             ["offer", "rejected", "interview_drop"],
    "offer":          ["hired", "rejected", "offer_drop"],
    "hired":          [],
    "rejected":       [],
    "withdrawn":      [],
    "interview_drop": [],
    "offer_drop":     [],
}

STAGE_LABELS = {
    "applied": "Applied",
    "screening": "Screening",
    "assessment": "Assessment",
    "tr1": "Technical Round 1",
    "tr2": "Technical Round 2",
    "hr": "HR Interview",
    "offer": "Offer Extended",
    "hired": "Hired",
    "rejected": "Application Closed",
    "withdrawn": "Withdrawn",
    "interview_drop": "Interview Drop",
    "offer_drop": "Offer Drop",
}

# Stages an application never comes back from. Nothing may be scheduled for a
# candidate sitting in one of these — the frontends already grey them out, but
# the rule belongs here so every booking path gets it.
TERMINAL_STAGES = {"rejected", "withdrawn", "interview_drop", "offer_drop", "hired"}

# Stages that require a reason (category + optional free-text note) on transition.
REASON_REQUIRED_STAGES = {"rejected", "interview_drop", "offer_drop"}

# HR can reassign a candidate's application to a different job req while it's
# still this early — once real interview rounds have started, the interviews
# already scheduled are tied to the original role, so a move stops being a
# clean "wrong req, same candidate" fix.
MOVE_JOB_ALLOWED_STAGES = {"applied", "screening"}

DROP_REASON_CATEGORIES = [
    {"value": "got_another_offer", "label": "Got another offer"},
    {"value": "not_aligned_with_expectations", "label": "Not aligned with expectations"},
    {"value": "assessment_too_long", "label": "Assessment takes too long"},
    {"value": "compensation_mismatch", "label": "Compensation mismatch"},
    {"value": "communication_gap", "label": "Communication gap"},
    {"value": "profile_mismatch", "label": "Profile mismatch"},
    {"value": "other", "label": "Other"},
]

# Candidate-facing feedback (AI-summarized interview feedback, and the raw
# free-text rejection note as a fallback) is only ever sent for a rejection
# from an actual interview round. Rejections from applied/screening/assessment
# get a generic email with no feedback content, regardless of category.
FEEDBACK_ELIGIBLE_STAGES = {"tr1", "tr2", "hr"}

# Rounds/stages a single Interview row can be attributed to that must NEVER
# contribute feedback to a candidate-facing rejection summary, even when the
# rejection itself is from tr1/tr2/hr. Screening is here on purpose: HR
# screening-call notes are internal. They DO feed forward to whoever runs the
# next round (interview_service._get_previous_rounds) — a rejected candidate
# just never sees them, only the real rounds they actually sat.
#
# Attribution now prefers interviews.round_type; the ApplicationStageHistory
# inference in tasks/email_tasks.py is only the fallback for rows without one.
# Deliberately a denylist rather than an allowlist of {"tr1","tr2","hr"}: some
# ApplicationStageHistory rows predate the interview_1/interview_2/interview_3/
# final_interview -> tr1/tr2/hr rename and still carry the old names, which a
# tr1/tr2/hr allowlist would misclassify as non-interview and wrongly strip.
FEEDBACK_EXCLUDED_INTERVIEW_STAGES = {"applied", "screening", "assessment"}

# Panelists are never chased for feedback on a candidate who has dropped out.
# The round still auto-completes on its end time (auto_complete_past_interviews
# doesn't know or care that the candidate walked), so without this the
# interviewer gets a "submit your feedback" mail — and then a reminder every
# 24h — for a conversation that either never happened or no longer matters.
# interview_drop is the only stage that reaches here in practice: offer_drop
# only happens past the last round (feedback is already in by then) and
# withdrawn has no inbound transition from an interview stage.
FEEDBACK_REQUEST_SUPPRESSED_STAGES = {"interview_drop"}


# ── Interview slot rounds ────────────────────────────────────────────────────
# A published InterviewSlot carries a round_type from this tuple. It is a
# strict subset of the pipeline stage vocabulary above (same strings, so a
# slot's round and the stage it belongs to never drift apart) — "screening"
# here is the HR screening call, booked while the application sits at the
# "screening" stage.
SLOT_ROUND_TYPES = ("screening", "tr1", "tr2", "hr")

# Which application stage a candidate must be sitting at to be booked into a
# slot of a given round. Deliberately strict 1:1 rather than "this stage or
# anything that legally transitions into it": publishing a screening-call slot
# and having a tr2 candidate booked into it is exactly the confusion this map
# exists to stop. HR advances the stage first, then the round becomes bookable.
ROUND_ELIGIBLE_STAGE = {
    "screening": "screening",
    "tr1": "tr1",
    "tr2": "tr2",
    "hr": "hr",
}

# Where each round sits in the pipeline. This — not Interview.round_number — is
# what orders rounds relative to each other, because round_number is unreliable:
# it defaults to 1 on every manually scheduled interview, so a manually booked
# HR screening call and a TR1 both land on 1. Feeding previous-round context
# forward (screening notes -> TR1 -> TR2 -> HR) has to use this map.
ROUND_ORDER = {
    "screening": 0,
    "tr1": 1,
    "tr2": 2,
    "hr": 3,
}

# Round labels as an agency sees them in their portal. Same wording as
# STAGE_LABELS for tr1/tr2, but "HR Screening Call" vs "HR Interview" is the
# distinction agencies kept collapsing — both are "HR", only one is the first
# conversation, so they are never labelled the same string.
ROUND_LABELS = {
    "screening": "HR Screening Call",
    "tr1": "Technical Round 1",
    "tr2": "Technical Round 2",
    "hr": "HR Interview",
}
