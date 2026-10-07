"""Select retained Python cases for the driver/count/index/receipt/compare TS slice.

No template, runner, workflow, extraction, verify or font-planning tests are counted
as ported. KEEP selection comes from the reviewed prune report. Node aggregates
several cases and adds write-on-change/protocol/Sharp checks; counts are not 1:1.
"""
import importlib, re, sys, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
report=Path(sys.argv[1]).read_text()
modules=('figma_build.ts','figma_receipts.ts','index_rows.ts','library_counts.ts','figma_compare.ts')
extra={
 'test_pncb_run_fixes.py': {
  'TokenAndColourTests.test_expand_hex_accepts_rgb_functions',
  'CollectionTests.test_media_query_modes_fold_into_brand_breakpoint_modes',
  'CollectionTests.test_media_applies',
  'CollectionTests.test_unused_mode_collapses_into_core',
  'ReviewFollowUpTests.test_cascade_last_match_wins_across_px_breakpoints',
  'ReviewFollowUpTests.test_media_query_syntax',
  'ReviewFollowUpTests.test_site_studio_breakpoints_fold_through_their_cascade',
  'ReviewFollowUpTests.test_other_axis_keeps_its_own_branded_collection_with_readable_modes',
  'ReviewFollowUpTests.test_query_only_token_never_writes_null',
  'ReviewFollowUpTests.test_wipe_names_only_collections_this_run_emitted',
  'ReviewFollowUpTests.test_width_and_another_axis_in_one_collection_split_by_variable',
  'ReviewFollowUpTests.test_a_variable_varying_on_both_axes_keeps_the_collection_whole',
  'ReviewFollowUpTests.test_percentage_rgb',
 },
 'test_review_objectives.py': {
  'ReviewObjectives.test_subset_keeps_unrelated_component_and_rebuilds_parent',
  'ReviewObjectives.test_large_token_inventory_consolidates_and_preserves_aliases',
  'ReviewObjectives.test_independent_core_modes_survive_consolidation',
 },
}
names=[]
for line in report.splitlines():
 parts=[p.strip() for p in line.split('|')]
 if len(parts)<6 or parts[3]!='KEEP' or not parts[1].endswith('.py'): continue
 file,case,reason=parts[1],parts[2],parts[4]
 if any(module in reason for module in modules) or case in extra.get(file,set()): names.append((file,case))
suite=unittest.TestSuite()
for file,case in sorted(set(names)):
 module=importlib.import_module(file[:-3]);cls,method=case.split('.')
 suite.addTest(getattr(module,cls)(method))
started=time.perf_counter(); result=unittest.TextTestRunner(verbosity=2).run(suite)
print('scope wall_ms=%.3f selected=%d'%(1000*(time.perf_counter()-started),suite.countTestCases()))
raise SystemExit(0 if result.wasSuccessful() else 1)
