# Secure Capsules v0 boundary checks

Run `node --test tests/*.test.js`.

Automated core tests use real Node Web Crypto, independent VM contexts for tabs,
and the production worker key authority with simulated extension storage. They
cover simultaneous first use, worker restart, Unicode round trips, key reset,
alternate installation, storage failures, corrupt key retention, IV/ciphertext/tag
mutation, canonical encoding, and exact matched-substring replacement.

The worker is the sole key writer. Content scripts request key material through
an internal extension message and encrypt locally. Draft/secret text is not sent
to the worker. The key remains raw profile-local extension state, not hardware
bound. Opening a capsule never creates a key. Read failures and malformed existing
keys do not cause replacement. There is no new automatic decryption UI.

UI tests use a small simulated DOM to check absence of Protect for signal-only
warnings and textarea selection insertion. These are not live browser evidence.

Still required before release:
- Load this branch in Chrome and repeat first use in two tabs, then reload both.
- Verify textarea and actual contenteditable insertion, including selection,
  surrounding multiline text, caret position and content after a rerender.
- Verify blocked-paste, Enter and send-button behavior on supported sites.
- Verify no new catch on submitting capsule output and unchanged dismiss/allow-once.

Known scope limits:
- Capsule eligibility now uses a separate conservative span planner. Supported
  assignments: password/passwd/pwd, generic secret/API/token labels, AWS secret
  access keys, Azure OpenAI keys and AccountKey. Supported standalone tokens:
  OpenAI, GitHub and AWS access-key IDs. Labels, quotes and whitespace are retained.
- Other detector formats remain warnings with no Protect action until an exact
  parser is added. Any unresolved hard warning suppresses the whole action;
  large-paste aggregate metadata is the sole exception.
- Real-detector tests cover exact payload spans, JSON/quoted/unquoted assignments,
  repeated values, incomplete quotes, extended tokens, mixed clue/key inputs and
  a full crypto round trip. Crypto isolation tests intentionally use a stub span
  planner; capsule-matches.test.js exercises the production planner.
- Markers such as private-key headers or recovery-phrase mentions do not establish
  complete secret detection. Do not claim all sensitive content was protected.
- The existing UI snapshot can become stale while the overlay remains open.
- Typed plaintext already present in the page is outside a never-exposed guarantee.

Live extension validation could not be performed in the cloud browser: its URL policy blocks chrome://extensions/. No live ChatGPT editor pass is claimed.
