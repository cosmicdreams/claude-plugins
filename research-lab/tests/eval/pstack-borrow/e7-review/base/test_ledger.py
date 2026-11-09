import unittest
import ledger


class LedgerTests(unittest.TestCase):
    def test_page_count_exact(self):
        self.assertEqual(ledger.page_count(20, 10), 2)

    def test_discount_rounds_down(self):
        self.assertEqual(ledger.discount_cents(999, 15), 149)  # 149.85 -> 149 by finance rule


if __name__ == '__main__':
    unittest.main()
