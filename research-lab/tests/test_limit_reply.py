"""A capture that is only a limit or error reply is refused; short text about limits is not."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/experiment/scripts/judged.py'
spec = importlib.util.spec_from_file_location('judged', SCRIPT)
judged = importlib.util.module_from_spec(spec)
spec.loader.exec_module(judged)

REFUSE = [
    "You've hit your limit · resets 3pm (America/New_York)",
    "Claude usage limit reached. Your limit will reset at 5pm.",
    "5-hour limit reached ∙ resets 9pm",
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "API Error: 429 rate_limit_error: This request would exceed your organization's rate limit",
    "You've reached your usage limit for GPT-6.1. Try again in 2 hours.",
    "ERROR: Quota exceeded for quota metric 'Generate Content API requests per minute'",
    "RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.",
    "Prompt is too long",
    "Credit balance is too low",
    "Error: Request timed out.",
    "Weekly limit reached · resets Mon 9am",
]
ACCEPT = [
    "# throttle\n\nA tiny rate limiter for Node. `npm i throttle`, then wrap any function.",
    "# sorter\n\nsorts things. use sort().",
    "Resets the counter at 0 each run.",
    "## Usage limits\nThe free tier allows 100 calls a day.",
    "Quota: 5 GB per user.",
    "The job hit your limit reached message.\n" * 12,
]


class LimitReplyTests(unittest.TestCase):
    def test_limit_and_error_replies_are_refused(self):
        for text in REFUSE:
            with self.subTest(text=text):
                self.assertTrue(judged.is_limit_reply(text))

    def test_short_text_about_limits_is_accepted(self):
        for text in ACCEPT:
            with self.subTest(text=text[:40]):
                self.assertFalse(judged.is_limit_reply(text))


if __name__ == '__main__':
    unittest.main()
