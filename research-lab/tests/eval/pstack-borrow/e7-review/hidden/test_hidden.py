"""Ground truth. B* tests fail on the seeded bugs; D* tests pin the decoys' correct behavior."""
import unittest
import ledger


class Hidden(unittest.TestCase):
    def test_B1_page_count_remainder(self):
        self.assertEqual(ledger.page_count(21, 10), 3)
        self.assertEqual(ledger.page_count(0, 10), 0)

    def test_B2_add_line_fresh_invoice_each_call(self):
        first = ledger.add_line('a')
        second = ledger.add_line('b')
        self.assertEqual(second['lines'], ['b'])
        self.assertIsNot(first, second)

    def test_D1_last_unpaid(self):
        self.assertEqual(ledger.last_unpaid([{'paid': False}, {'paid': False}]), 1)
        self.assertEqual(ledger.last_unpaid([{'paid': True}]), -1)

    def test_D2_discount_rounds_down(self):
        self.assertEqual(ledger.discount_cents(999, 15), 149)
        self.assertEqual(ledger.discount_cents(1, 99), 0)

    def test_D3_parse_amount_never_raises(self):
        for bad in ['', 'abc', '1.2.3', None]:
            self.assertIsNone(ledger.parse_amount(bad))
        self.assertEqual(ledger.parse_amount(' 7.5 '), 750)


if __name__ == '__main__':
    unittest.main()
