# AGENTS.md

This file provides guidance for AI coding agents working with the wif repository (Express + Node.js).

## Agent Responsibilities

- **Algorithm compliance:** Code changes to the WIF agent logic MUST align with [docs/ALGORITHM.md](docs/ALGORITHM.md). That document is the single source of truth for the analyze workflow, subtasks, and tools. When implementing or modifying agent behavior, follow the RFC 2119 requirements specified there. If a code change conflicts with ALGORITHM.md, update ALGORITHM.md first, then implement.
- **Continuous Learning**: Whenever an agent performs a task and discovers new patterns, conventions, or best practices that aren't documented here, it should add these learnings to AGENTS.md. This ensures the documentation stays current and helps future agents work more effectively.
- **Context Management**: When using compaction (which reduces context by summarizing older messages), the agent must re-read AGENTS.md afterwards to ensure it's always fully available in context. This guarantees that all guidelines, conventions, and best practices remain accessible throughout the entire session.

## Commit Guidelines

### Conventional Commits

This project uses [Conventional Commits 1.0.0](https://www.conventionalcommits.org/) for all commit messages.

**Commit Message Structure:**

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Line Length Limits:**

- **Subject line:** Maximum 50 characters (including type prefix)
- **Body lines:** Maximum 72 characters per line

The 50-character limit for the subject ensures readability in git log output and GitHub's UI. The 72-character limit for body lines follows the git convention for optimal display in terminals and tools.

**Types that appear in CHANGELOG:**

- `feat:` - A new feature (correlates with MINOR in SemVer)
- `fix:` - A bug fix (correlates with PATCH in SemVer)
- `impr:` - An improvement to existing functionality

**Other Allowed Types (require `#skip-changelog` in PR description):**

- `build:` - Changes to build system or dependencies
- `chore:` - Routine tasks, maintenance
- `ci:` - Changes to CI configuration
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, missing semi-colons, etc.)
- `refactor:` (or `ref:`) - Code refactoring without changing functionality
- `perf:` - Performance improvements
- `test:` - Adding or updating tests

**PR Description Requirements:**

Add `#skip-changelog` to PR descriptions for changes that should not appear in the changelog. Only `feat:`, `fix:`, and `impr:` commits generate changelog entries.

**Breaking Changes:**

- Add `!` after type/scope: `feat!:` or `feat(api)!:`
- Or use footer: `BREAKING CHANGE: description`

**Examples:**

```
feat: add new session replay feature
fix: resolve memory leak in session storage
docs: update installation guide
ref: simplify event serialization
chore: update dependencies
feat!: change API response format

BREAKING CHANGE: API now returns JSON instead of XML
```

**Example with body (respecting 72-char line limit):**

```
ref: rename constant to camelCase convention

Renamed SENTRY_AUTO_TRANSACTION_MAX_DURATION to use camelCase as per
TypeScript naming conventions for module-level constants. This improves
consistency with the rest of the codebase.
```

### File Renaming and Git History Preservation

**CRITICAL: Always preserve git history when renaming files in the codebase.**

Git history is essential for understanding the evolution of code, tracking down bugs, and maintaining project continuity. When renaming files, follow these guidelines:

**Use `git mv` for Renaming:**

```bash
# Correct approach - preserves history
git mv old-name.ts new-name.ts
git commit -m "ref: rename old-name to new-name"
```

**Never use file system operations followed by `git add`:**

```bash
# WRONG - breaks history tracking
mv old-name.ts new-name.ts
git add new-name.ts
git commit -m "ref: rename old-name to new-name"
```

**Benefits:**

- Git can track file history across renames (`git log --follow`)
- Blame annotations continue to work correctly
- Bisect operations remain accurate
- Code archaeology and debugging are easier
- Refactoring history is preserved

**Verification:**

After renaming, verify that git recognizes the rename:

```bash
git status  # Should show "renamed: old-name.ts -> new-name.ts"
git log --follow new-name.ts  # Should show full history including old name
```

## Project Setup

- **Package manager:** Use `pnpm`, not npm. Run `pnpm add <package>` for dependencies.
- **Development:** `pnpm dev` starts the live-reloading server (tsx watch).
- **Testing:** `pnpm test` runs Vitest (unit + integration tests). Use `pnpm test:watch` for watch mode.
- **Linting:** `pnpm lint` runs ESLint. Use `pnpm lint:fix` to auto-fix. `pnpm format` runs Prettier.
- **Pre-commit:** Install [pre-commit](https://pre-commit.com/) (`pip install pre-commit` or `brew install pre-commit`), then run `pre-commit install && pre-commit install --hook-type commit-msg`. Hooks run Prettier, ESLint, TypeScript check, tests, and validate conventional commit messages.

## Verification Loop

When iterating on changes (e.g., addressing review feedback, fixing bugs, or implementing features), run these steps before considering work complete:

1. **Build:** `pnpm build`
2. **Test:** `pnpm test`
3. **Lint:** `pnpm lint` (or `pnpm lint:fix` to auto-fix)
4. **Format:** `pnpm format`

**When committing:** Pre-commit hooks run the same checks. If the commit fails (e.g., Prettier or ESLint modified files), add the changed files and commit again: `git add -u && git commit -m "..."`. If it fails again after adding changes, investigate the failure—do not retry blindly.

## Slack Integration

- **Use the SDK:** Prefer [@slack/bolt](https://docs.slack.dev/tools/node-slack-sdk/) and its methods over manual implementations. For example, use `verifySlackRequest` from `@slack/bolt` for request signature verification instead of implementing HMAC-SHA256 yourself.
- **Signing Secret vs OAuth token:** `SLACK_SIGNING_SECRET` is used to verify incoming webhook requests. `SLACK_OAUTH_TOKEN` is for outbound API calls. Do not confuse them.
- **url_verification:** When Slack sends a `url_verification` event (during Events API URL setup), respond with `res.status(200).json({ challenge: body.challenge })`.
- **Rich markdown:** Use `markdown_text` (not `text`) in `chat.postMessage` for rich formatting. Supports `**bold**`, `[link text](url)`, and `-` for lists. Do not use template literals with leading indentation—whitespace is included in the message. Use `ChannelAndMarkdownText` type; do not combine with `blocks` or `text`.

## GitHub Integration

- **GitHub App auth:** Use [octokit](https://github.com/octokit/octokit.js) with `@octokit/auth-app` for GitHub App authentication. Use `createAppAuth` with `appId`, `privateKey`, and `installationId`.
- **Private key loading:** Try `/run/secrets/github-app-private-key` first (production), then `./secrets/github-app-private-key` (local). Add `secrets/` to `.gitignore`.
- **Environment variables:** `GITHUB_APP_ID` and `GITHUB_INSTALLATION_ID` override defaults. Document optional vars in `.env.example`.
- **Release data:** Use the GitHub Releases API as the single source for release notes. Do not fetch or parse `CHANGELOG.md` files from repositories — for Sentry SDKs, the changelog content is published as GitHub Release notes. This avoids maintaining two data-source code paths.
- **Pre-release filtering:** When listing releases, exclude versions with SemVer pre-release tags (`-alpha`, `-beta`, `-rc`). Use server-side filtering in the GitHub API where available; otherwise filter client-side via the `semver` package.
- **Pagination efficiency:** When fetching releases for a version range, stop pagination as soon as the target boundary is reached. Do not fetch the entire release history and filter client-side.

## Error Handling

- **4xx (user/client errors):** Use the `HttpError` class. These should not be reported to Sentry.
- **5xx (server errors):** Let unhandled errors propagate to Sentry's `setupExpressErrorHandler`.
- **Middleware order:** Register the `httpErrorHandler` middleware before `Sentry.setupExpressErrorHandler` so 4xx responses are sent without Sentry reporting.

## Project Structure

- **`src/app.ts`:** Express app factory (`createApp`) used by server and integration tests.
- **`src/types.ts`:** Shared types and custom error classes (e.g., `HttpError`, `SlackWebhookBody`).
- **`src/middleware/`:** Middleware modules (e.g., `slackVerification.ts`, `errorHandler.ts`).
- **`src/middleware/index.ts`:** Barrel file exporting middleware for clean imports.
- **`src/github/`:** GitHub integration. Use OOP: `GithubClient` class, `types.ts` for interfaces, `index.ts` barrel export. Keep a clean file hierarchy for external service clients.
- **`src/analysis/tools/`:** Atomic analysis tools (see below).
- **`src/analysis/subtasks/`:** Composed analysis subtasks (see below).

## Analysis: Tools and Subtasks

The analysis layer is split into two distinct kinds of units with strict rules about what each may and must not do.

### Tools

Tools live in `src/analysis/tools/`. They are **atomic** — each tool wraps a single external capability.

**Rules:**

- **Must not** call other tools.
- **Must not** call subtasks.
- Are responsible for obtaining API keys, initializing clients, and handling auth.

**Existing tools:**

- `slack.ts` — post and update Slack messages
- `github.ts` — fetch GitHub releases
- `ai.ts` — call the AI model (`generateObject`)

**Adding a new tool:**

Create a `create<Name>Tools()` factory that returns an object of methods. Register the result in `createAnalysisTools()` in `tools/index.ts`, add its methods to the `AnalysisTools` interface in `tools/types.ts`, and add a no-op fallback if the underlying service is optional.

```typescript
// src/analysis/tools/myservice.ts
export function createMyServiceTools() {
  return {
    async doSomething(input: string): Promise<string> {
      const apiKey = process.env.MY_API_KEY;
      if (!apiKey) throw new Error('MY_API_KEY is not configured');
      // ... call external service directly
      return result;
    },
  };
}
```

### Subtasks

Subtasks live in `src/analysis/subtasks/`. They **compose** tools to accomplish a higher-level goal.

**Rules:**

- **May** call tools (received via dependency injection).
- **Must not** call other subtasks.
- **Must not** obtain API keys or initialize clients — that is the tools' responsibility.

**Existing subtasks:**

- `classifier.ts` — `classifyRepository`: reads the prompt file, calls `tools.generateObject`, returns a structured result.

**Adding a new subtask:**

Create a `create<Name>Subtask(tools)` factory that returns an async function. Accept only the specific tools it needs via `Pick<AnalysisTools, '...'>`. Register the result in `createAnalysisSubtasks()` in `subtasks/index.ts` and add its signature to the `AnalysisSubtasks` interface.

```typescript
// src/analysis/subtasks/mysubtask.ts
import type { AnalysisTools } from '../tools/types.js';

export function createMySubtask(tools: Pick<AnalysisTools, 'generateObject' | 'findAllReleases'>) {
  return async function mySubtask(input: string): Promise<MyResult> {
    // use tools to accomplish the goal — no API keys, no client init here
    const data = await tools.findAllReleases(input);
    return tools.generateObject({ schema: mySchema, system: '...', prompt: '...' });
  };
}
```

### Orchestration (`analyzeIssue`)

`analyzeIssue` in `src/analysis/analyze.ts` is the top-level orchestrator. It receives both `tools` and `subtasks` and may call either directly. It must not contain business logic that belongs in a subtask.

```
analyzeIssue(issueDescription, tools, subtasks)
  ├── tools.postNewSlackMessage(...)   ← direct tool call
  ├── subtasks.classifyRepository(...) ← subtask call
  └── tools.postNewSlackMessage(...)   ← direct tool call
```

### Wiring it together (`worker.ts`)

```typescript
const tools = createAnalysisTools(slackContext, githubService);
const subtasks = createAnalysisSubtasks(tools);
await analyzeIssue(eventText, tools, subtasks);
```

### Analysis Architecture

The WIF analysis pipeline follows a **workflow → subtasks → tools** layering defined in [docs/ALGORITHM.md](docs/ALGORITHM.md):

- **`src/analysis/analyze.ts`:** Top-level workflow entry point (`analyzeIssue`). Orchestrates subtasks in order, handles progress reporting, and posts the final answer.
- **`src/analysis/subtasks/`:** One file per subtask. Each subtask is a factory function that receives tools and returns an async function. Subtasks contain the decision logic (e.g., LLM prompts, confidence scoring, early exit conditions). Export via `index.ts` barrel.
- **`src/analysis/tools/`:** Reusable I/O primitives (Slack, GitHub API, LLM). Tools MUST NOT contain workflow logic — they only perform data access or generation. Typed via `types.ts`, composed via `index.ts` barrel.
- **`prompts/`:** Markdown prompt files loaded by subtasks at runtime.

When adding a new subtask or tool:

1. Define the pseudo-code signature in `docs/ALGORITHM.md` first.
2. Add the TypeScript interface to `src/analysis/tools/types.ts` (for tools) or `src/analysis/subtasks/index.ts` (for subtasks).
3. Implement the function in its own file.
4. Export via the barrel `index.ts`.
5. Wire it into the workflow in `analyze.ts`.

### Formatting After Documentation Changes

Always run `pnpm format` after editing markdown files (including `docs/ALGORITHM.md` and `AGENTS.md`). Prettier enforces consistent table alignment, line breaks, and whitespace.

## Testability

- **Dependency injection:** For functions that call external services (Slack, GitHub), accept optional overrides as a second parameter. Use `Pick<ClientClass, "methodName">` for minimal mock types. Default to module-level singletons when no overrides provided.
- **Mocking external clients:** When testing flows that hit Slack or GitHub, inject mock clients with `vi.fn()` to avoid real API calls. Assert on method calls and arguments.

## Git Rebase

When resolving merge conflicts during `git pull --rebase`:

- **pnpm-lock.yaml conflicts:** Run `git checkout --ours pnpm-lock.yaml` then `pnpm install --no-frozen-lockfile` to regenerate the lockfile.
- **Non-interactive rebase continue:** Use `GIT_EDITOR=true git rebase --continue` when the terminal has no editor configured.
