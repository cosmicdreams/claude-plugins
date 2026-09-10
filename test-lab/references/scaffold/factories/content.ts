import {drush, phpString, RUN_MARKER} from './drush';

/**
 * A typed handle, not a bare id.
 *
 * A bare id makes the caller remember what it identifies and how to dispose of
 * it. A handle carries its own disposal, which is what lets a spec clean up in
 * a `finally` without knowing what kind of thing it holds.
 */
export interface NodeHandle {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  cleanup(): Promise<void>;
}

async function createNode(type: string, title: string, extra: string = ''): Promise<NodeHandle> {
  // Marked so the teardown sweep can find it if this test dies mid-flight.
  const markedTitle = `[${RUN_MARKER}] ${title}`;

  const id = await drush([
    'php:eval',
    `$n = \\Drupal\\node\\Entity\\Node::create([
       'type' => ${phpString(type)},
       'title' => ${phpString(markedTitle)},
       'status' => 1,
       ${extra}
     ]);
     $n->save();
     echo $n->id();`,
  ]);

  if (!/^\d+$/.test(id)) {
    throw new Error(`node creation returned "${id}" rather than an id — the eval probably failed`);
  }

  const path = await drush(['php:eval', `echo \\Drupal::service('path_alias.manager')
    ->getAliasByPath('/node/${id}');`]);

  return {
    id,
    title: markedTitle,
    path: path || `/node/${id}`,
    async cleanup() {
      await drush(['entity:delete', 'node', id]);
    },
  };
}

export const LandingPageFactory = {
  create: (title: string) => createNode('landing_page', title),
};

export const BlogFactory = {
  create: (title: string) => createNode('blog', title),
};
