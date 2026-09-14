import {APIRequestContext} from '@playwright/test';

/**
 * Test data factories.
 *
 * "Factory" here means what it means in factory_bot: a thing that manufactures
 * the CONTENT a spec acts on. It does not generate tests. The distinction is
 * worth stating because this scaffold lives in a plugin whose job is generating
 * tests, and the two senses of the word sit one directory apart.
 *
 * Why a factory at all: a spec that depends on a page someone authored by hand
 * breaks when that person edits the page, and the failure looks like a
 * regression. A factory makes the spec own its own preconditions.
 *
 * Why through Playwright's request context rather than the browser: creating
 * content by driving the authoring interface means every content-dependent spec
 * fails whenever that interface breaks, for reasons unrelated to what the spec
 * asserts. It is also about an order of magnitude slower.
 *
 * Why through Playwright's request context rather than a shell-out:
 *
 *   - It is portable. Any system under test with an HTTP interface works; the
 *     only thing that changes is the path and the payload shape.
 *   - It runs in-process and appears in the Playwright trace, so a setup
 *     failure shows up in the run report rather than in a swallowed stderr.
 *   - It sends structured data instead of generating source code, which means
 *     there is no string interpolated into another language and therefore no
 *     escaping to get wrong. A title containing an apostrophe is just a title.
 *
 * That last point retires an entire class of defect. See factories/drush.ts for
 * the escape hatch and the reason it needs an escaping helper.
 */

/**
 * A typed handle, not a bare id.
 *
 * A bare id makes the caller remember what it identifies and how to dispose of
 * it. A handle carries its own disposal, which is what lets a spec clean up in
 * a `finally` without knowing what kind of thing it holds.
 */
export interface ContentHandle {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  cleanup(): Promise<void>;
}

/**
 * Marks everything a factory creates, so `global-teardown.ts` can sweep content
 * whose test died before its own cleanup ran. Stable within a run, unique
 * across runs, so two suites in parallel do not delete each other's fixtures.
 */
export const RUN_MARKER = process.env.E2E_RUN_MARKER ?? `e2e-${process.pid}`;

/**
 * Drupal's JSON:API is the worked example. Replace the three lines that know
 * about it — the path, the resource type and the attribute names — and the rest
 * of this file is unchanged on any other stack.
 */
export function contentFactory(request: APIRequestContext) {
  async function create(bundle: string, title: string): Promise<ContentHandle> {
    const markedTitle = `[${RUN_MARKER}] ${title}`;

    const response = await request.post(`/jsonapi/node/${bundle}`, {
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
      data: {
        data: {
          type: `node--${bundle}`,
          // No escaping, because nothing is being interpolated into source.
          // The apostrophe in "Alvaro's landing page" is just a character.
          attributes: {title: markedTitle, status: true},
        },
      },
    });

    if (!response.ok()) {
      throw new Error(
        `could not create ${bundle} "${title}": ${response.status()} ${response.statusText()}\n` +
        `${await response.text()}`,
      );
    }

    const {data} = await response.json();
    const id: string = data.id;

    return {
      id,
      title: markedTitle,
      path: data.attributes?.path?.alias ?? `/node/${data.attributes?.drupal_internal__nid}`,
      async cleanup() {
        const deleted = await request.delete(`/jsonapi/node/${bundle}/${id}`);
        if (!deleted.ok() && deleted.status() !== 404) {
          // Do not throw from cleanup — it would mask the real failure. The
          // teardown sweep is the backstop for exactly this.
          console.warn(`cleanup failed for ${bundle} ${id}: ${deleted.status()}`);
        }
      },
    };
  }

  return {
    landingPage: (title: string) => create('landing_page', title),
    blog: (title: string) => create('blog', title),
  };
}

export type ContentFactory = ReturnType<typeof contentFactory>;
