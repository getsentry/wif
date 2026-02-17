# AGENTS.md

This file provides guidance for AI coding agents working with the wif repository (Express + Node.js).

## Agent Responsibilities

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