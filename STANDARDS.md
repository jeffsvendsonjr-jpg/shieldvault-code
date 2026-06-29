# ShieldVault Engineering Standards

These are the bars we hold ourselves to. They exist so that quality decisions
are intentional and reviewable, not left to a tool's defaults or to chance.

## Detection

- **Validation over raw regex.** A detector must be specific enough that it does
  not redact ordinary content. Low-entropy or label-less shapes (bare UUIDs,
  40-character base64 strings, plain digit runs) are **context-bound** — they
  require a nearby label — or **checksum-validated** before they ever redact.
  - Payment cards are confirmed with the Luhn (mod-10) check.
  - IBANs are confirmed with the ISO 7064 mod-97-10 check.
- **No flagging public-by-design identifiers.** Publishable keys
  (`pk_live_`/`pk_test_`), OAuth client IDs, and account SIDs are meant to be
  public. Flagging them is a false positive and erodes trust; we do not detect
  them on purpose, and we say so in a comment at the detector site.
- **Surgical redaction.** When a secret is found, replace only the matched
  substring (`[secret removed]`) — never wipe the user's whole field.
- **Each guard is independent.** Turning off one category (secrets, PII,
  passwords, large paste) must not silently disable another. There is no master
  switch in `detectSecretMatches`.

## Privacy invariant

ShieldVault stores **metadata only** — domain, category, vector, detector names,
timestamp. The matched secret content is **never persisted, transmitted, or
logged**. Any change that would store or send field content is a breaking change
to this invariant and must be called out explicitly in review.

## Documentation

We document **contracts and non-obvious algorithms**, not trivia.

- **Do** write a docstring for: the background message API (every `type` and its
  request/response shape), the `Proof` shape, the detector entry shape, and any
  validator or algorithm whose correctness isn't obvious from the code
  (Luhn, IBAN mod-97).
- **Don't** add docstrings to self-explanatory helpers (`setText(id, value)`,
  one-line getters). A docstring that only restates the signature is noise.

The CodeRabbit docstring-coverage threshold in `.coderabbit.yaml` is set
deliberately to reflect this rule, not silenced. If you raise it, raise the bar
in reality first.

## Validation before commit

- `node --check` must pass on every `.js` file.
- New detectors and validators ship with a quick harness run (positive cases
  match, look-alikes do not) recorded in the PR description.
- Behavior that can soft-lock the user (cancelling a submit) must always offer a
  visible way through.
