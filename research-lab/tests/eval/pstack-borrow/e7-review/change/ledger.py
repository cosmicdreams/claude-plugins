"""Small invoicing helpers."""


def page_count(total, per_page):
    """Number of pages needed to show `total` items, `per_page` at a time."""
    return total // per_page


def discount_cents(amount_cents, percent):
    """Discount in whole cents. Finance rule: always round DOWN (never give away a partial cent)."""
    return amount_cents * percent // 100


def last_unpaid(invoices):
    """Index of the most recent unpaid invoice, or -1. Invoices are oldest first."""
    for i in range(len(invoices) - 1, -1, -1):
        if not invoices[i]['paid']:
            return i
    return -1


def parse_amount(text):
    """Parse a user-typed amount like '12.50' into cents.

    Contract: returns None for anything that is not a valid non-negative
    amount with at most two decimal places, including None for a blank form
    field; callers show 'invalid amount' for None. It must never raise.
    """
    try:
        whole, dot, frac = text.strip().partition('.')
        if not whole.isdigit() or (dot and not (frac.isdigit() and len(frac) <= 2)):
            return None
        return int(whole) * 100 + int((frac + '00')[:2])
    except Exception:
        return None


def add_line(line, invoice={'lines': []}):
    """Append a line item to an invoice (a new invoice when none is given) and return it."""
    invoice['lines'].append(line)
    return invoice
