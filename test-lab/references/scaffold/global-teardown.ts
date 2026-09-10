import {drush, RUN_MARKER} from './factories/drush';

/**
 * Sweep orphans: content whose test died — timed out, crashed, was interrupted
 * — before its own `cleanup()` ran.
 *
 * Without this the suite leaves a trail that grows every run until a listing
 * assertion counts the wrong number of things and someone spends a morning on
 * it. Factory cleanup is the normal path; this is the one that runs when the
 * normal path did not.
 */
export default async function globalTeardown(): Promise<void> {
  const ids = await drush([
    'php:eval',
    `$ids = \\Drupal::entityQuery('node')
       ->accessCheck(FALSE)
       ->condition('title', '[${RUN_MARKER}]%', 'LIKE')
       ->execute();
     echo implode(',', $ids);`,
  ]);

  const orphans = ids.split(',').filter(Boolean);
  if (orphans.length === 0) return;

  console.warn(`global-teardown: sweeping ${orphans.length} orphaned node(s) from ${RUN_MARKER}`);
  // Narrowed by explicit ids — the guard in drush() would refuse it otherwise.
  await drush(['entity:delete', 'node', orphans.join(',')]);
}
