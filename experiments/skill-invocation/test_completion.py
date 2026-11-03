import unittest

from completion import complete


class CompletionTests(unittest.TestCase):
    def test_all_required_tasks_must_be_accepted(self):
        cases = [
            ([], False),
            (["accepted"], True),
            (["accepted", "accepted"], True),
            (["accepted", "runnable"], False),
            (["accepted", "human-dependent"], False),
            (["accepted", "failed"], False),
            (["runnable"], False),
        ]
        for statuses, expected in cases:
            with self.subTest(statuses=statuses):
                self.assertEqual(complete(statuses), expected)


if __name__ == "__main__":
    unittest.main()
