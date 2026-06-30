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

## Pro entitlement (Stripe)

The extension never talks to Stripe directly. The `shieldvault.site` server owns
all payment and entitlement logic; the extension only opens checkout and
validates a license key.

- **Checkout** opens `GET /api/checkout/quick?plan=<monthly|lifetime>` in a tab.
  The server redirects to Stripe Checkout and, on success, issues the buyer a
  license key (shown on the success page and emailed).
  - When the buyer's email is known (learned from a prior activation and stored
    locally), the extension appends `&email=<addr>` so the server links the
    purchase to the existing Stripe customer. This is what makes a
    monthly→lifetime upgrade cancel the old subscription and upgrade the same
    license in place instead of creating an unlinked second customer.
- **Activation / re-validation** — `POST /api/license/activate { key }` must
  respond:
  ```json
  { "valid": true, "tier": "plus", "plan": "monthly|lifetime", "expiresAt": <ms epoch|null> }
  ```
  - `expiresAt: null` (or omitted) means **never expires** — used for lifetime.
  - For monthly, `expiresAt` is the current period end; the extension re-checks
    on each popup open, so the server extends it on renewal and returns
    `{ "valid": false }` once the subscription lapses.
- The extension treats `expiresAt` as the source of truth. It must **not**
  invent a local expiry window. A `null` expiry is lifetime; a positive expiry
  in the past is lapsed; both the popup and the content-script tier gate honour
  this.

License keys are the entitlement (portable across reinstalls/machines) — we do
not use session/deep-link tokens, which don't survive a reinstall.

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
