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
    {"value": "other", "label": "Other"},
]
