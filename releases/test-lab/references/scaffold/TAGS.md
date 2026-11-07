# Test tags

Applied with Playwright's `{tag: [...]}` option:

```ts
test('C12345: the footer renders on every page', {tag: ['@smoke']}, async ({examplePage}) => {
```

Filter with `--grep` / `--grep-invert`.

## In use

A tag enters this table when the first spec applies it, and not before.
`support/check-tags.mjs` fails the build on a tag defined here and applied to
nothing, and on a tag applied in a spec and missing here. Run it in the same
gate as lint.

| Tag | Meaning | Why it exists | Unlock signal |
|---|---|---|---|
| `@smoke` | structural health expected on every environment | the set worth running first | none — this one is permanent |
| `@local` | needs a local environment | authentication, usually | narrows when a shared environment can hold a disposable session |

## Add when the first spec needs one

Deliberately not in the table above, because nothing applies them yet. Move a
row up when you apply it — that is the whole discipline.

- `@regression` — guards a specific shipped fix, named in the title. Lets a
  release run target what changed. Retires when the fix is old enough that the
  behaviour is just expected.
- `@slow` — depends on a slow or remote service. Without it these fail
  unpredictably with no clean way to exclude them, which is precisely the
  failure this catalogue exists to prevent. Narrows when a local equivalent of
  the service exists.
- `@fixture-page` — depends on specific authored content existing. Retires when
  a factory can create its own content.

## Unlock signals

Every tag carries the condition under which it stops being needed. A tag with
no unlock signal becomes permanent by default, and a permanent tag nobody
revisits is how a suite accumulates exclusions until the excluded set is larger
than the running set.
