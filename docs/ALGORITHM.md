# WIF Agent Algorithm

Technical specification for the agent logic that answers "Was this fixed yet?" (WIF) questions about SDK releases.

**Key words:** The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

---

## Architecture: Analyze Workflow

The agent implements an **analyze workflow** composed of **subtasks** that call **tools**. Code MUST follow this structure:

- **Workflow:** Top-level entry point that receives the issue description and orchestrates subtasks.
- **Subtasks:** Discrete analysis steps (extract request, resolve repository, check extracted links, fetch release range, scan and evaluate release notes, resolve answer). Each subtask MAY use one or more tools.
- **Tools:** Reusable primitives for external I/O (Slack, GitHub API, LLM). Tools MUST NOT contain workflow logic; they MUST only perform data access or generation.

The workflow MUST execute subtasks in the order defined below. Subtasks MAY exit early when the agent is confident in a result.

Implementations MAY combine Subtask 1 and Subtask 2 into a single LLM call when the repository mapping is unambiguous.

---

## Tools

Pseudo-code signatures for tools used by subtasks. Implementations MAY vary.

| Tool                           | Signature                                                                                            | Description                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extract_request`              | `extract_request(message: string) -> { sdk, version, problem, links? }`                              | LLM: extract sdk, version, problem, and optional links from support engineer message.                                                                                                                          |
| `lookup_sdk_repository`        | `lookup_sdk_repository(sdk: string) -> string or null`                                               | Map SDK identifier to `owner/repo` slug. Returns null if unknown.                                                                                                                                              |
| `resolve_repository_ambiguous` | `resolve_repository_ambiguous(context: string) -> string`                                            | LLM: resolve repository when lookup is ambiguous.                                                                                                                                                              |
| `get_issue_resolution`         | `get_issue_resolution(issue_url: string) -> { fixed_in_version?, pr_number? }`                       | GitHub API: check if linked issue/PR was fixed and in which release.                                                                                                                                           |
| `get_releases_from_version`    | `get_releases_from_version(repo: string, from_version: string) -> Release[]`                         | GitHub API: list stable releases strictly after `from_version` (oldest → newest). MUST exclude pre-release versions. SHOULD use server-side filtering where the API supports it; otherwise filter client-side. |
| `filter_relevant_entries`      | `filter_relevant_entries(release_notes: string, problem: string) -> (release, line, pr_reference)[]` | LLM: identify release note lines relevant to `problem`.                                                                                                                                                        |
| `get_pr_details`               | `get_pr_details(repo: string, pr_number: int) -> PRDetails`                                          | GitHub API: fetch PR title and description.                                                                                                                                                                    |
| `score_pr_confidence`          | `score_pr_confidence(pr: PRDetails, problem: string) -> Confidence`                                  | LLM: assign high/medium/low confidence that PR fixes `problem`.                                                                                                                                                |
| `post_slack_message`           | `post_slack_message(text: string) -> message_id`                                                     | Slack: post new message to thread.                                                                                                                                                                             |
| `update_slack_message`         | `update_slack_message(message_id: string, text: string) -> void`                                     | Slack: update existing message.                                                                                                                                                                                |

---

## Design Principles

- **Lazy loading.** The agent MUST only fetch data it actually needs for the current decision. The agent MUST NOT bulk-load data "just in case."
- **Early exit.** The agent MUST stop as soon as it is confident in a result. The agent MUST NOT process remaining candidates after a high-confidence match.
- **Token efficiency.** The agent MUST minimize the amount of text held in context at any given time. The agent SHOULD prefer compact summaries over raw content. If any single PR description exceeds 20 000 tokens, the agent SHOULD summarize it before scoring.
- **Repository-first.** The agent MUST resolve which GitHub repository to query before fetching any release data.
- **Show your work.** The agent MUST output reasoning alongside the answer so the support engineer can verify.
- **Progress reporting.** The agent MUST keep the support engineer informed by appending status updates to a progress-thread message via `update_slack_message`. Required checkpoints:
  - Subtask 1 start: "Analyzing…"
  - Subtask 3 (if links exist): "Checking linked issues…"
  - Subtask 5 start: "Scanning releases `<first>`–`<last>` (`<N>` releases)…"
  - Subtask 5 between batches (OPTIONAL): "Scanned `<done>` of `<total>` releases…"
- **Graceful degradation.** If a tool call fails, the agent MUST NOT crash. The agent SHOULD log the failure, skip the step, and continue with reduced confidence. The final answer MUST note which steps were skipped and why. If critical steps fail (e.g., cannot resolve repository), the agent MUST defer to SDK maintainers with an explanation.

---

## Subtask 1: Extract Request

**Trigger:** An SDK support engineer posts a customer issue, typically a regression or missing behavior observed since a specific SDK version.

**Tools used:** `extract_request`.

The agent MUST extract:

| Field     | Description                                    |
| --------- | ---------------------------------------------- |
| `sdk`     | Which SDK (platform/repo) is affected.         |
| `version` | The version where the issue was first noticed. |
| `problem` | A concise summary of the reported behavior.    |
| `links`   | Any GitHub issue/PR URLs included (OPTIONAL).  |

If `sdk` or `version` cannot be determined, the agent MUST ask the support engineer before proceeding.

`links` are treated as a **fast path**, not as definitive answers. The agent MAY use them as a starting shortcut (see Subtask 3). If a link resolves to a high-confidence match in a release after `version`, that is sufficient — the agent does not need to cross-reference with the full release notes scan.

**Output:** `{ sdk, version, problem, links? }` or early exit with a clarification request.

See [Appendix A](#appendix-a--example-requests) for example requests.

---

## Subtask 2: Resolve Repository

**Tools used:** `lookup_sdk_repository`; MAY use `resolve_repository_ambiguous` for ambiguous cases.

The agent MUST map `sdk` to a GitHub repository **before** any data fetching.

| SDK identifier          | Repository                |
| ----------------------- | ------------------------- |
| `sentry-cocoa` / iOS    | `getsentry/sentry-cocoa`  |
| `sentry-java` / Android | `getsentry/sentry-java`   |
| `sentry-python`         | `getsentry/sentry-python` |
| ...                     | ...                       |

**Output:** `repo` — the `owner/repo` slug used for all subsequent API calls.

If the SDK cannot be mapped, the agent MUST ask the support engineer to clarify.

---

## Subtask 3: Check Extracted Links

**Tools used:** `get_issue_resolution`, `get_pr_details`, `score_pr_confidence`.

This subtask MUST run **before** fetching any release range or release notes. It is the cheapest path to an answer (1–2 API calls).

If the request included GitHub `links` (issue or PR URLs):

1. The agent MUST check whether the linked issue/PR was resolved in a release **after** `version` via `get_issue_resolution`.
2. If yes, the agent MUST fetch the PR details via `get_pr_details` and score its confidence via `score_pr_confidence`.
3. If the linked issue's fix is in a release **at or before** `version`, the agent MUST discard it — the user already has that version and the problem persists, so this is not the fix.
4. If the link produces a **high-confidence** result, the agent MUST exit early and proceed to Subtask 6.
5. If the link is inconclusive or discarded, the agent MUST proceed to Subtask 4.

If the request included **no links**, the agent MUST skip this subtask and proceed to Subtask 4.

**Output:** High-confidence result (early exit to Subtask 6) or fall-through to Subtask 4.

---

## Subtask 4: Fetch Release Range

**Tools used:** `get_releases_from_version`.

The agent MUST fetch the list of stable releases from `repo`, starting **strictly after** `version` (the user's version MUST be excluded — they already have it and the problem persists) and going forward to the latest stable release (oldest → newest).

**Pre-release exclusion:** The result MUST only contain stable releases — versions with SemVer pre-release tags (e.g., `-alpha.1`, `-beta.2`, `-rc.1`) MUST be excluded. The agent SHOULD use server-side filtering in the GitHub API where available; otherwise it MUST filter client-side by parsing SemVer.

**Release count guard:** After fetching, the agent MUST count the number of releases in the range. If the count exceeds **100**, the agent MUST abort with the result: "The reported version is too old — there are more than 100 releases since then. Unable to look this up efficiently." The agent MUST then proceed directly to Subtask 6 with this result.

**Edge cases:**

- **User is on the latest stable release.** No newer releases exist. The agent MUST report this and defer to SDK maintainers.
- **`version` is not a valid tag.** The agent MUST ask the support engineer to verify.

**Output:** Ordered list of releases (oldest → newest) with release notes, or early exit (too old / already latest / invalid version).

---

## Subtask 5: Scan and Evaluate Release Notes

**Tools used:** `filter_relevant_entries`, `get_pr_details`, `score_pr_confidence`.

The agent MUST perform a **linear scan** of release notes from oldest to newest. The agent MUST NOT skip any release in the range.

### Processing

The agent MUST process releases in batches of at most 5, oldest first:

1. For each batch, pass the combined release notes to `filter_relevant_entries` along with the `problem`.
2. For any relevant entries returned, fetch PR details via `get_pr_details`.
3. Score each PR via `score_pr_confidence`.
4. The agent MUST accumulate all medium-confidence and above candidates across batches.
5. **Early exit:** If a high-confidence match is found, the agent MUST stop and proceed to Subtask 6. The agent MUST NOT fetch the next batch.
6. If no high-confidence match is found, continue to the next batch.

After all batches are processed, the accumulated candidate list is the output. Low-confidence results MUST NOT be treated as candidates — if only low-confidence results exist after scanning all releases, the outcome is "no result."

### Confidence levels

For each PR, the agent MUST assign a confidence level:

| Confidence | Criteria                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| **High**   | PR title/description explicitly mentions fixing the reported symptom. The change is clearly in the same subsystem.    |
| **Medium** | PR is in the right area (same feature/module) but does not directly mention the symptom. Could be a contributing fix. |
| **Low**    | PR touches related code but the connection is speculative.                                                            |

### Release notes format

Sentry SDK release notes follow a structured format:

```
### Fixes

- fix: Description here (#1234)

### Features

- feat: Description here (#5678)
```

When scanning for bug fixes, the agent MUST prioritize "Fixes" sections. "Features" and other sections are lower-priority unless the `problem` describes missing functionality that was added as a new feature.

**Output:** Highest-confidence candidate(s) with version and PR references, or no result.

---

## Subtask 6: Resolve Answer

**Tools used:** `post_slack_message`, `update_slack_message`.

The agent MUST format and post the result according to the confidence level.

### High confidence

The agent MUST report the fix version with supporting evidence. Output MUST use Slack markdown: links as `[PR #N](url)`, version in **bold**, and an optional checkmark (✓) for scanability.

```
✓ This was fixed in **v<version>**. See [PR #N](url).

Checked: releases <first>–<last> in <repo>.
```

`<first>`–`<last>` MUST reflect the **actual** range scanned. When the agent exits early after finding a high-confidence fix, `<last>` is the version where the fix was found, not the latest release in the fetched range. "Relevant PRs evaluated" is shown only when **more than one** PR was evaluated; omit it when there is a single PR.

### Medium confidence

The agent MUST report with a caveat and defer for confirmation. Use **bold** for the version and `[PR #N](url)` for the link.

```
**v<version>** includes changes that may address this ([PR #N](url)),
but I'm not fully certain. Deferring to SDK maintainers to confirm.

Checked: releases <first>–<last> in <repo>.
```

"Relevant PRs evaluated" is shown only when more than one PR was evaluated.

### No result

The agent MUST defer entirely. "Checked" uses the full range scanned (all releases in the range).

```
I wasn't able to identify a fix in the releases after v<version>.
Deferring to SDK maintainers for investigation.

Checked: releases <first>–<last> in <repo>.
Release notes reviewed: <count>.
```

### Too old

The agent MUST report that the version is too far behind:

```
The reported version (v<version>) is more than 100 releases behind
the latest stable release. Unable to look this up efficiently.
Deferring to SDK maintainers.
```

In all cases, the agent MUST include the reasoning trace (which releases were checked, which PRs were evaluated, and why the conclusion was reached). This allows the support engineer to validate the answer. Use Slack markdown for readability: `[PR #N](url)` for links and **bold** for key terms (e.g., version).

---

## Appendix A — Example Requests

### Example A — Missing feature after upgrade

**Request:**

> "Since release v8.45.1 we started sending logs. In 8.46 it seems like 80% of the error events are missing logs."
>
> ExpectedBehavior: "App startup state" log should be on the Issue.
> EXC_BREAKPOINT with no Logs section.

**Extraction:**

| Field     | Value                                                    |
| --------- | -------------------------------------------------------- |
| `sdk`     | `sentry-cocoa` (iOS)                                     |
| `version` | `8.45.1`                                                 |
| `problem` | Error events are missing the Logs section since v8.45.1. |
| `links`   | _(none)_                                                 |

### Example B — Tags showing (empty) in WatchdogTermination issues

**Request:**

> Many of the tags (for example OS) in WatchdogTermination issues show (empty).
> I found a GitHub issue which sounds like it could be the root cause.
> The fix for this issue is in 8.43.0 and they've been using 8.48.0 for quite some time already.
> Discover query also shows no improvement.

**Extraction:**

| Field     | Value                                                   |
| --------- | ------------------------------------------------------- |
| `sdk`     | `sentry-cocoa` (iOS)                                    |
| `version` | `8.48.0`                                                |
| `problem` | WatchdogTermination issues have empty tags (e.g., OS).  |
| `links`   | `https://github.com/getsentry/sentry-cocoa/issues/5397` |

**Expected behavior:** The link points to an issue fixed in 8.43.0, but the user is on 8.48.0 and still sees the problem. Subtask 3 MUST discard this link (fix is at or before the user's version). The agent MUST proceed to Subtask 4 and scan release notes forward from 8.48.0. The linear scan finds [#5242 — "Add missing context for watchdog termination events"](https://github.com/getsentry/sentry-cocoa/releases/tag/8.52.0) in release 8.52.0 as the fix.

**Expected answer:** "✓ This was fixed in **v8.52.0**. See [PR #5242](url). Checked: releases 8.49.0–8.52.0 in getsentry/sentry-cocoa." (actual range scanned; no "Relevant PRs evaluated" when only one PR)
