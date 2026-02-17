# WIF Agent Algorithm

Technical specification for the agent logic that answers "Was this fixed yet?" (WIF) questions about SDK releases.

## Design Principles

- **Lazy loading.** Only fetch data the agent actually needs for the current decision. Never bulk-load "just in case."
- **Early exit.** Stop as soon as the agent is confident in a result. Do not process remaining candidates.
- **Token efficiency.** Minimize the amount of text held in context at any given time. Prefer compact summaries over raw content. Slice large files rather than loading them whole.
- **Repository-first.** Resolve which GitHub repository to query before fetching any release data.
- **Show your work.** Output reasoning alongside the answer so the support engineer can verify.

---

## 1. Extraction

**Trigger:** An SDK support engineer posts a customer issue, typically a regression or missing behavior observed since a specific SDK version.

The agent must extract:

| Field       | Description                                    |
|-------------|------------------------------------------------|
| `sdk`       | Which SDK (platform/repo) is affected.         |
| `version`   | The version where the issue was first noticed.  |
| `problem`   | A concise summary of the reported behavior.    |
| `links`     | Any GitHub issue/PR URLs included in the request (optional). |

If `sdk` or `version` cannot be determined, ask the support engineer before proceeding.

`links` are treated as **hints, not answers**. The agent uses them as a starting shortcut (see step 5) but always verifies independently.

See [Appendix A](#appendix-a--example-requests) for example requests.

---

## 2. Repository Resolution

Map `sdk` to a GitHub repository **before** any data fetching.

| SDK identifier          | Repository                        |
|-------------------------|-----------------------------------|
| `sentry-cocoa` / iOS    | `getsentry/sentry-cocoa`          |
| `sentry-java` / Android | `getsentry/sentry-java`           |
| `sentry-python`         | `getsentry/sentry-python`         |
| ...                     | ...                               |

**Output:** `repo` — the `owner/repo` slug used for all subsequent API calls.

If the SDK cannot be mapped, ask the support engineer to clarify.

---

## 3. Release Range

Fetch the list of release tags from `repo`, filtered to the range **after** `version` up to and including the latest stable release.

This is a lightweight call — only tag names and dates, no release bodies.

**Edge cases:**

- **User is on the latest stable release.** No newer releases exist. Report this and defer to SDK maintainers.
- **`version` is not a valid tag.** Ask the support engineer to verify.

**Output:** Ordered list of release versions (oldest → newest), or early exit if range is empty.

---

## 4. Release Notes Scan

Fetch release notes for the range and identify changelog lines relevant to `problem`.

### Data Source

| Source                | When to use                                      | Token cost |
|-----------------------|--------------------------------------------------|------------|
| `CHANGELOG.md`       | Repo has a structured changelog (most Sentry SDKs). | 1 fetch, but **slice to the relevant version range** — do not load the full file. |
| GitHub Releases API   | No changelog file, or changelog is unstructured. | 1 fetch per release. |

**Slicing `CHANGELOG.md`:** Search the file for the `version` header to find the start offset. Read from that offset to the top of the file (newest entries). Discard everything below — older history is irrelevant.

### Changelog Format

Sentry SDK changelogs follow a structured format:

```
## <version>

### Fixes

- fix: Description here (#1234)

### Features

- feat: Description here (#5678)
```

When scanning for bug fixes, **prioritize "Fixes" sections**. "Features" and other sections are lower-priority unless the `problem` describes missing functionality that was added as a new feature.

### Processing

The agent reads the sliced changelog and applies judgment to identify relevant lines. This is an LLM evaluation step — the agent decides what's relevant based on semantic understanding of `problem`, not a mechanical keyword filter.

Produce a compact list of relevant entries:

```
(release_version, changelog_line, pr_reference)
```

Discard all non-matching lines. Only the compact list is carried forward.

**Output:** A short list of `(release, line, PR)` tuples, ordered oldest → newest.

---

## 5. PR Candidate Evaluation

### Shortcut: Check extracted links first

If the request included GitHub `links` (issue or PR URLs):

1. Check whether the linked issue/PR was resolved in a release **after** `version`.
2. If yes, treat it as a candidate and evaluate its confidence (see below).
3. If the linked issue's fix is in a release **at or before** `version`, discard it — the user already has that version and the problem persists, so this is not the fix.

This is a fast path that may resolve the question in one or two API calls. If it produces a high-confidence result, exit early. Otherwise, proceed with the changelog-based candidates.

### Evaluating changelog candidates

Process the filtered tuples from step 4, **oldest to newest**. Oldest-first means the first high-confidence match is the earliest fix — enabling a valid early exit.

Fetch PR descriptions in **small batches** (up to ~5 at a time) rather than strictly one-at-a-time. This balances token efficiency with API latency. Apply early exit between batches — if a high-confidence match is found, do not fetch the next batch.

For each PR, assign a confidence level:

| Confidence | Criteria |
|------------|----------|
| **High**   | PR title/description explicitly mentions fixing the reported symptom. The change is clearly in the same subsystem. |
| **Medium** | PR is in the right area (same feature/module) but doesn't directly mention the symptom. Could be a contributing fix. |
| **Low**    | PR touches related code but the connection is speculative. |

### Fix clusters

Some problems are resolved by **multiple PRs across releases** rather than a single fix. If the agent finds several medium-confidence PRs in the same area across consecutive releases, it should identify the **latest release in the cluster** as the answer — that's when the fix was complete.

Example: watchdog termination data was fixed incrementally across 8.50.0, 8.51.0, and 8.53.2. The answer is 8.53.2, not 8.50.0, because that's when the full set of fixes landed.

**Output:** Either an early-exit result, or a ranked list of candidates (possibly grouped as a fix cluster).

---

## 6. Resolution

### High confidence (single PR or fix cluster)

Report the fix version with supporting evidence:

```
This was fixed in v<version>. See <PR link(s)>.

Checked: releases <first>–<last> in <repo>.
Relevant PRs evaluated: <list>.
```

### Medium confidence

Report with a caveat and defer for confirmation:

```
v<version> includes changes that may address this (<PR link>),
but I'm not fully certain. Deferring to SDK maintainers to confirm.

Checked: releases <first>–<last> in <repo>.
Relevant PRs evaluated: <list>.
```

### No result

Defer entirely:

```
I wasn't able to identify a fix in the releases after v<version>.
Deferring to SDK maintainers for investigation.

Checked: releases <first>–<last> in <repo>.
Changelog lines reviewed: <count>.
```

In all cases, include the reasoning trace (which releases were checked, which PRs were evaluated, and why the conclusion was reached). This allows the support engineer to validate the answer.

---

## Appendix A — Example Requests

### Example A — Missing feature after upgrade

**Request:**

> "Since release v8.45.1 we started sending logs. In 8.46 it seems like 80% of the error events are missing logs."
>
> ExpectedBehavior: "App startup state" log should be on the Issue.
> EXC_BREAKPOINT with no Logs section.

**Extraction:**

| Field     | Value                                                     |
|-----------|-----------------------------------------------------------|
| `sdk`     | `sentry-cocoa` (iOS)                                      |
| `version` | `8.45.1`                                                  |
| `problem` | Error events are missing the Logs section since v8.45.1.  |
| `links`   | *(none)*                                                  |

### Example B — Tags showing (empty) in WatchdogTermination issues

**Request:**

> Many of the tags (for example OS) in WatchdogTermination issues show (empty).
> I found a GitHub issue which sounds like it could be the root cause.
> The fix for this issue is in 8.43.0 and they've been using 8.48.0 for quite some time already.
> Discover query also shows no improvement.

**Extraction:**

| Field     | Value                                                         |
|-----------|---------------------------------------------------------------|
| `sdk`     | `sentry-cocoa` (iOS)                                          |
| `version` | `8.48.0`                                                      |
| `problem` | WatchdogTermination issues have empty tags (e.g., OS).        |
| `links`   | `https://github.com/getsentry/sentry-cocoa/issues/5397`      |

**Expected answer:** "Most of the watchdog related data points were fixed with 8.53.2 including tags."

**Why the link was not the answer:** The linked issue's fix was in 8.43.0, but the user is on 8.48.0 and still sees the problem. The fix in 8.43.0 was a partial implementation. The agent must continue searching and finds the complete fix in 8.53.2 — a fix cluster that landed across multiple releases.
