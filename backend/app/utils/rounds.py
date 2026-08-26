"""How an interview's round is named wherever a human reads it.

One helper, because the fallback was previously open-coded as
`interview.title or f"Round {interview.round_number}"` in six places — and
round_number is not a safe thing to show a person:

  * an HR screening call booked from a slot is round 0, which read as "Round 0";
  * a *manually* scheduled screening call is round 1, same as TR1, so two
    different rounds both render "Round 1".

round_type is the round's real identity. round_number is only an ordering hint
and is used here as a last resort, for legacy rows that have neither a title
nor a round_type.
"""

from app.constants.stages import ROUND_LABELS


def round_display_label(interview) -> str:
    """Human-facing name for an interview's round — emails, calendars, UI."""
    title = getattr(interview, "title", None)
    if title:
        return title
    label = ROUND_LABELS.get(getattr(interview, "round_type", None))
    if label:
        return label
    number = getattr(interview, "round_number", None)
    # Round 0 is never a thing a person should read; anything that lands here
    # without a title or round_type is an untyped legacy row.
    if number:
        return f"Round {number}"
    return "Interview"
