# Test tags

Applied with Playwright's `{tag: [...]}` option:

```ts
test('C12345: the footer renders on every page', {tag: ['@smoke']}, async ({examplePage}) => {
```

Filter with `--grep` / `--grep-invert`.

| Tag | Meaning | Why it exists |
|---|---|---|
| `@smoke` | structural health expected on every environment | the set worth running first |
| `@regression` | guards a specific shipped fix, named in the title | lets a release run target what changed |
| `@slow` | depends on a slow or remote service | without it, these fail unpredictably with no clean way to exclude them |
| `@local` | needs a local environment | authentication, usually |
| `@fixture-page` | depends on specific authored content | visible until factories replace it |

## Unlock signals

State the condition under which each tag stops being needed. A tag with no
unlock signal becomes permanent by default.

- `@fixture-page` — retires when a factory can create its own content.
- `@slow` — narrows when a local equivalent of the service exists.
