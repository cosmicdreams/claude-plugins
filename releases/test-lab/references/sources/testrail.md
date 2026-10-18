# Source adapter: TestRail

Read-only. This adapter never writes to TestRail — no cases created or edited,
no run results posted, no passwords changed.

## Access

Two independent things go wrong here, and each masks the other.

**Project membership.** An individual account may authenticate perfectly and
still not see the project. On the Velir instance a personal account returns 36
projects with the target absent, while the shared account returns 138 including
it. If `get_projects` succeeds but the project is missing, the credential is
fine and the membership is not — do not go looking for a better key.

Confirm before assuming:

```bash
curl -s -u "$USER:$KEY" "https://<host>/index.php?/api/v2/get_projects" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get('projects',d); \
print(len(p)); [print(' ',x['id'],x['name']) for x in p]"
```

**Credential shape.** Read the whole item once, not field by field — each `op`
invocation is a separate biometric prompt, and calling it per command is what
makes this feel painful.

```bash
CRED=$(op item get <item-id> --format=json --reveal | python3 -c "
import sys,json
f={x.get('id'):x.get('value') for x in json.load(sys.stdin).get('fields',[])}
print('%s:%s' % (f.get('username'), f.get('password')))")
```

Key on the field **`id`**, not `label`. A 1Password login item commonly labels
its username field `name`, so keying on label silently yields `None:<password>`
and the request fails as an authentication error rather than a lookup error.

## Pulling

`get_cases` returns complete case objects. **Pull the full payload the first
time.** Titles and sections tell you a case exists but not what it asserts,
which is useless for authoring and wastes an authorization.

Fields that carry the content worth having:

| Field | Typical fill rate |
|---|---|
| `custom_steps` | high |
| `custom_expected` | high |
| `custom_preconds` | low, but load-bearing where present |
| `custom_automation_type` | often `0` (None) on every case — see below |

Also pull `get_case_fields`, `get_priorities` and `get_case_types` in the same
run; the case objects reference them by id and are undecodable without them.

Pagination is `limit`/`offset`, 250 maximum. Loop until a page returns fewer
than the limit.

## Traps

**`custom_automation_type` looks like a prioritisation signal and usually is
not.** It defaulted to `None` on all 555 cases in the corpus this was written
against — nobody had ever set it. Check the distribution before believing it.
Priority is the axis that carries real information.

**The text fields mix plain text and HTML.** Convert tags to text, then unescape
entities — **in that order.** Reversing it destroys tag names the case author
escaped deliberately, and accessibility cases are full of them: `<address>`,
`<img>`, `<a>` appear as prose in expected results.

**Suite names collide when slugged.** Two suites differing only by a suffix
produce the same filename and one silently overwrites the other. Put the suite
id in the filename and assert both filename uniqueness and total case count
after generating.

## Rendering for authoring

Split a large suite by its top-level sections; write small suites whole.
Splitting a flat-sectioned suite by section produces dozens of files holding one
case each, which is worse than one file.

Store the raw payload in the repository next to the tests. It is the thing that
makes authoring possible without a seat in the tool, and it is what lets a
future source adapter be diffed against this one.
