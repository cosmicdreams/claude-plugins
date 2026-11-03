"""A disposable fixture, not a production orchestration safeguard."""


def complete(statuses):
    """Complete only a nonempty batch whose every task is accepted."""
    return bool(statuses) and all(status == "accepted" for status in statuses)
