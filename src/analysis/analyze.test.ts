import { describe, expect, it, vi } from 'vitest';
import { analyzeIssue } from './analyze.js';
import type { AnalysisSubtasks } from './subtasks/index.js';
import type { AnalysisTools } from './tools/index.js';
import type { SlackMessageContent } from './tools/slack.js';

/** Extract all mrkdwn text from a Slack message (string or blocks) for assertions. */
function getMessageText(content: SlackMessageContent): string {
  if (typeof content === 'string') return content;
  return content.blocks
    .map((b) => {
      if (b.type === 'section' && b.text) return b.text.text;
      if (b.type === 'context') return b.elements.map((e) => e.text).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function makeMockTools(overrides?: Partial<AnalysisTools>): AnalysisTools {
  return {
    extractRequest: vi.fn(),
    lookupSdkRepository: vi.fn(),
    resolveRepositoryAmbiguous: vi.fn(),
    getIssueResolution: vi.fn(),
    getReleasesFromVersion: vi.fn(),
    findAllReleases: vi.fn(),
    filterRelevantEntries: vi.fn(),
    getPrDetails: vi.fn(),
    scorePrConfidence: vi.fn(),
    generateObject: vi.fn(),
    postNewSlackMessage: vi
      .fn()
      .mockResolvedValueOnce('progress-ts')
      .mockResolvedValue('result-ts'),
    updateSlackMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AnalysisTools;
}

function makeMockSubtasks(overrides?: Partial<AnalysisSubtasks>): AnalysisSubtasks {
  return {
    extractRequest: vi.fn().mockResolvedValue({
      kind: 'extracted',
      sdk: 'sentry-cocoa',
      version: '8.45.1',
      problem: 'Error events missing logs',
      links: [],
    }),
    resolveRepository: vi.fn().mockResolvedValue({
      kind: 'resolved',
      repo: 'getsentry/sentry-cocoa',
    }),
    checkExtractedLinks: vi.fn().mockResolvedValue({ kind: 'fallthrough' }),
    fetchReleaseRange: vi.fn().mockResolvedValue({
      kind: 'releases',
      releases: [
        { tag: 'v8.46.0', name: '8.46.0', url: '', body: '### Fixes\n- fix: logs (#123)' },
      ],
    }),
    scanReleaseNotes: vi.fn().mockResolvedValue({
      kind: 'no_result',
    }),
    ...overrides,
  } as unknown as AnalysisSubtasks;
}

describe('analyzeIssue', () => {
  it('runs full workflow and returns result', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    const result = await analyzeIssue('Some issue about iOS', tools, subtasks);

    expect(subtasks.extractRequest).toHaveBeenCalledWith('Some issue about iOS');
    expect(subtasks.resolveRepository).toHaveBeenCalledWith('sentry-cocoa', 'Some issue about iOS');
    expect(subtasks.fetchReleaseRange).toHaveBeenCalledWith('getsentry/sentry-cocoa', '8.45.1');
    expect(result.kind).toBe('no_result');
  });

  it('posts progress message and final result', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    await analyzeIssue('Some issue', tools, subtasks);

    expect(tools.postNewSlackMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        blocks: expect.any(Array),
        text: 'Analyzing…',
      })
    );
    const updatePayload = (tools.updateSlackMessage as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => getMessageText(c[1]).includes('Scanning releases')
    )?.[1];
    expect(updatePayload).toBeDefined();
    expect(getMessageText(updatePayload as SlackMessageContent)).toContain('Scanning releases');

    const lastPost = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(getMessageText(lastPost as SlackMessageContent)).toContain(
      "I wasn't able to identify a fix"
    );
  });

  it('appends progress updates instead of replacing', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    await analyzeIssue('Some issue', tools, subtasks);

    const updateCalls = (tools.updateSlackMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    const firstUpdateText = getMessageText(updateCalls[0][1] as SlackMessageContent);
    expect(firstUpdateText).toContain('Analyzing…');
    expect(firstUpdateText).toContain('Resolving releases');

    const lastUpdateText = getMessageText(
      updateCalls[updateCalls.length - 1][1] as SlackMessageContent
    );
    expect(lastUpdateText).toContain('Analyzing…');
    expect(lastUpdateText).toContain('Resolving releases');
    expect(lastUpdateText).toContain('Scanning releases');
    expect(lastUpdateText).toContain('Done.');
  });

  it('returns clarification when extractRequest needs more info', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      extractRequest: vi.fn().mockResolvedValue({
        kind: 'clarification',
        message: 'Could not determine SDK. Please clarify.',
      }),
    });

    const result = await analyzeIssue('Vague message', tools, subtasks);

    expect(result.kind).toBe('clarification');
    expect(result.message).toContain('Could not determine');
    expect(subtasks.resolveRepository).not.toHaveBeenCalled();
  });

  it('exits early with high-confidence result from linked issue', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      extractRequest: vi.fn().mockResolvedValue({
        kind: 'extracted',
        sdk: 'sentry-cocoa',
        version: '8.45.1',
        problem: 'Tags empty',
        links: ['https://github.com/getsentry/sentry-cocoa/issues/123'],
      }),
      checkExtractedLinks: vi.fn().mockResolvedValue({
        kind: 'high_confidence',
        version: '8.52.0',
        prNumber: 5242,
        prLink: 'https://github.com/getsentry/sentry-cocoa/pull/5242',
        reason:
          'PR title explicitly mentions adding missing context for watchdog termination events.',
      }),
    });

    const result = await analyzeIssue('Issue with link', tools, subtasks);

    expect(result.kind).toBe('high_confidence');
    if (result.kind === 'high_confidence') {
      expect(result.version).toBe('8.52.0');
    }
    expect(subtasks.fetchReleaseRange).not.toHaveBeenCalled();

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('Fixed in v8.52.0');
    expect(finalMessage).toContain('PR #5242');
    expect(finalMessage).toContain('High confidence');
    expect(finalMessage).toContain('watchdog termination events');
    expect(finalMessage).not.toContain('Relevant PRs evaluated');
  });

  it('posts markdown-formatted result and actual range for high-confidence from scan', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'releases',
        releases: [
          { tag: 'v8.49.0', name: '8.49.0', url: '', body: '' },
          { tag: 'v8.50.0', name: '8.50.0', url: '', body: '' },
          { tag: 'v8.52.0', name: '8.52.0', url: '', body: '### Fixes\n- fix: watchdog (#5242)' },
          { tag: 'v9.4.1', name: '9.4.1', url: '', body: '' },
        ],
      }),
      scanReleaseNotes: vi.fn().mockResolvedValue({
        kind: 'high_confidence',
        candidate: {
          version: '8.52.0',
          prNumber: 5242,
          prLink: 'https://github.com/getsentry/sentry-cocoa/pull/5242',
          confidence: 'high',
          reason:
            'PR title explicitly mentions adding missing context for watchdog termination events.',
        },
      }),
    });

    const result = await analyzeIssue('Watchdog tags empty', tools, subtasks);

    expect(result.kind).toBe('high_confidence');
    if (result.kind === 'high_confidence') {
      expect(result.version).toBe('8.52.0');
    }

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('Fixed in v8.52.0');
    expect(finalMessage).toContain('PR #5242');
    expect(finalMessage).toContain('High confidence');
    expect(finalMessage).toContain('watchdog termination events');
    expect(finalMessage).toContain('Checked releases');
    expect(finalMessage).toContain('v8.49.0');
    expect(finalMessage).toContain('8.52.0');
    expect(finalMessage).not.toContain('9.4.1');
    expect(finalMessage).not.toContain('Relevant PRs evaluated');
  });

  it('shows top 3 medium-confidence candidates as potential fixes when no high-confidence match', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'releases',
        releases: [
          {
            tag: 'v8.46.0',
            name: '8.46.0',
            url: '',
            body: '### Fixes\n- fix A (#100)\n- fix B (#101)\n- fix C (#102)',
          },
        ],
      }),
      scanReleaseNotes: vi.fn().mockResolvedValue({
        kind: 'medium',
        candidates: [
          {
            version: '8.46.0',
            prNumber: 100,
            prLink: 'https://github.com/getsentry/sentry-cocoa/pull/100',
            confidence: 'medium',
            reason:
              'PR modifies the same logging subsystem but does not mention the symptom directly.',
          },
          {
            version: '8.46.0',
            prNumber: 101,
            prLink: 'https://github.com/getsentry/sentry-cocoa/pull/101',
            confidence: 'medium',
            reason: 'PR touches related error event handling code.',
          },
          {
            version: '8.46.0',
            prNumber: 102,
            prLink: 'https://github.com/getsentry/sentry-cocoa/pull/102',
            confidence: 'medium',
            reason: 'PR modifies error event handling.',
          },
        ],
      }),
    });

    await analyzeIssue('Some regression', tools, subtasks);

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('Potential candidates found');
    expect(finalMessage).toContain('1. *v8.46.0*');
    expect(finalMessage).toContain('Medium confidence');
    expect(finalMessage).toContain('logging subsystem');
    expect(finalMessage).toContain('Relevant PRs evaluated');
    expect(finalMessage).toContain('PR #100');
    expect(finalMessage).toContain('PR #101');
    expect(finalMessage).toContain('PR #102');
    expect(finalMessage).toContain('Deferring to SDK maintainers to confirm');
  });

  it('caps at top 3 when more than 3 medium-confidence candidates exist', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'releases',
        releases: [
          {
            tag: 'v8.46.0',
            name: '8.46.0',
            url: '',
            body: '### Fixes\n- a (#100)\n- b (#101)\n- c (#102)\n- d (#103)',
          },
        ],
      }),
      scanReleaseNotes: vi.fn().mockResolvedValue({
        kind: 'medium',
        candidates: [
          { version: '8.46.0', prNumber: 100, prLink: 'x', confidence: 'medium', reason: 'a' },
          { version: '8.46.0', prNumber: 101, prLink: 'x', confidence: 'medium', reason: 'b' },
          { version: '8.46.0', prNumber: 102, prLink: 'x', confidence: 'medium', reason: 'c' },
          { version: '8.46.0', prNumber: 103, prLink: 'x', confidence: 'medium', reason: 'd' },
        ],
      }),
    });

    await analyzeIssue('Some regression', tools, subtasks);

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('PR #100');
    expect(finalMessage).toContain('PR #101');
    expect(finalMessage).toContain('PR #102');
    expect(finalMessage).toContain('PR #103'); // in trace (Relevant PRs evaluated)
    expect(finalMessage).not.toContain('4. *'); // candidates list capped at 3
  });

  it('shows only available candidates when fewer than 3 medium-confidence matches', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'releases',
        releases: [
          {
            tag: 'v8.46.0',
            name: '8.46.0',
            url: '',
            body: '### Fixes\n- fix A (#100)',
          },
        ],
      }),
      scanReleaseNotes: vi.fn().mockResolvedValue({
        kind: 'medium',
        candidates: [
          {
            version: '8.46.0',
            prNumber: 100,
            prLink: 'https://github.com/getsentry/sentry-cocoa/pull/100',
            confidence: 'medium',
            reason: 'PR touches related code.',
          },
        ],
      }),
    });

    await analyzeIssue('Some regression', tools, subtasks);

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('Potential candidates found');
    expect(finalMessage).toContain('1. *v8.46.0*');
    expect(finalMessage).toContain('PR #100');
    expect(finalMessage).not.toContain('2. *');
  });

  it('includes known version range when already_latest', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'already_latest',
        message:
          'No releases found after the reported version. Known stable versions range from `1.0.0` to `2.19.2`.',
      }),
    });

    const result = await analyzeIssue('Python SDK v7', tools, subtasks);

    expect(result.kind).toBe('already_latest');
    expect(result.message).toContain('Known stable versions range from');

    const finalContent = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    const finalMessage = getMessageText(finalContent as SlackMessageContent);
    expect(finalMessage).toContain('Known stable versions range from');
    expect(finalMessage).toContain('1.0.0');
    expect(finalMessage).toContain('2.19.2');
  });

  it('works without Slack posting when tools are no-ops', async () => {
    const tools = makeMockTools({
      postNewSlackMessage: vi.fn().mockResolvedValue(undefined),
    });
    const subtasks = makeMockSubtasks();
    const result = await analyzeIssue('Some issue', tools, subtasks);

    expect(result.kind).toBe('no_result');
    expect(tools.updateSlackMessage).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        blocks: expect.any(Array),
        text: expect.any(String),
      })
    );
  });
});
