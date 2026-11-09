"""Small invoicing helpers."""


def page_count(total, per_page):
    """Number of pages needed to show `total` items, `per_page` at a time."""
    raise NotImplementedError


def discount_cents(amount_cents, percent):
    """Discount in whole cents. Finance rule: always round DOWN (never give away a partial cent)."""
    raise NotImplementedError
