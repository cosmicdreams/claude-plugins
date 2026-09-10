import {request} from '@playwright/test';
import {RUN_MARKER} from './factories/content';

/**
 * Sweep orphans: content whose test died — timed out, crashed, was interrupted
 * — before its own `cleanup()` ran.
 *
 * Without this the suite leaves a trail that grows every run until a listing
 * assertion counts the wrong number of things and someone spends a morning on
 * it. Factory cleanup is the normal path; this is the one that runs when the
 * normal path did not.
 *
 * Built on Playwright's own request context, same as the factory, so the sweep
 * needs no separate credentials, no shell and no platform tooling on the
 * machine running the suite.
 */
export default async function globalTeardown(): Promise<void> {
  const baseURL = process.env.E2E_BASE_URL;
  if (!baseURL) return;

  const context = await request.newContext({baseURL, ignoreHTTPSErrors: true});

  try {
    const response = await context.get('/jsonapi/node/landing_page', {
      params: {
        'filter[title][operator]': 'CONTAINS',
        'filter[title][value]': `[${RUN_MARKER}]`,
      },
      headers: {Accept: 'application/vnd.api+json'},
    });

    if (!response.ok()) return;

    const {data} = await response.json();
    if (!Array.isArray(data) || data.length === 0) return;

    console.warn(`global-teardown: sweeping ${data.length} orphaned item(s) from ${RUN_MARKER}`);
    for (const item of data) {
      await context.delete(`/jsonapi/node/landing_page/${item.id}`);
    }
  } finally {
    await context.dispose();
  }
}
