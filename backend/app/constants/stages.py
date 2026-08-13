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
    {"value": "communication_gap", "label": "Communication gap"},
    {"value": "profile_mismatch", "label": "Profile mismatch"},
    {"value": "other", "label": "Other"},
]

# Candidate-facing feedback (AI-summarized interview feedback, and the raw
# free-text rejection note as a fallback) is only ever sent for a rejection
# from an actual interview round. Rejections from applied/screening/assessment
# get a generic email with no feedback content, regardless of category.
FEEDBACK_ELIGIBLE_STAGES = {"tr1", "tr2", "hr"}

# Stages a single Interview row can be attributed to (via ApplicationStageHistory
# timestamps — Interview has no stage field of its own) that must NEVER contribute
# feedback to a rejection summary, even when the rejection itself is from tr1/tr2/hr.
# Deliberately a denylist rather than an allowlist of {"tr1","tr2","hr"}: some
# ApplicationStageHistory rows predate the interview_1/interview_2/interview_3/
# final_interview -> tr1/tr2/hr rename and still carry the old names, which a
# tr1/tr2/hr allowlist would misclassify as non-interview and wrongly strip.
FEEDBACK_EXCLUDED_INTERVIEW_STAGES = {"applied", "screening", "assessment"}
