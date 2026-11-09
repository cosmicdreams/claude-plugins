import unittest
import ledger


class LedgerTests(unittest.TestCase):
    def test_page_count_exact(self):
        self.assertEqual(ledger.page_count(20, 10), 2)

    def test_discount_rounds_down(self):
        self.assertEqual(ledger.discount_cents(999, 15), 149)  # 149.85 -> 149 by finance rule

    def test_last_unpaid(self):
        inv = [{'paid': True}, {'paid': False}, {'paid': True}]
        self.assertEqual(ledger.last_unpaid(inv), 1)
        self.assertEqual(ledger.last_unpaid([{'paid': False}]), 0)
        self.assertEqual(ledger.last_unpaid([]), -1)

    def test_parse_amount(self):
        self.assertEqual(ledger.parse_amount('12.50'), 1250)
        self.assertIsNone(ledger.parse_amount('twelve'))

    def test_add_line(self):
        self.assertEqual(ledger.add_line('a')['lines'], ['a'])


if __name__ == '__main__':
    unittest.main()
