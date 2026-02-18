import { describe, expect, it, vi } from 'vitest';
import { analyzeIssue } from './analyze.js';
import type { AnalysisSubtasks } from './subtasks/index.js';
import type { AnalysisTools } from './tools/index.js';

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

    expect(tools.postNewSlackMessage).toHaveBeenNthCalledWith(1, 'Analyzing…');
    expect(tools.updateSlackMessage).toHaveBeenCalledWith(
      'progress-ts',
      expect.stringContaining('Scanning releases')
    );
    expect(tools.postNewSlackMessage).toHaveBeenLastCalledWith(
      expect.stringContaining("I wasn't able to identify a fix")
    );
  });

  it('appends progress updates instead of replacing', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    await analyzeIssue('Some issue', tools, subtasks);

    const updateCalls = (tools.updateSlackMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    const firstUpdate = updateCalls[0][1] as string;
    expect(firstUpdate).toMatch(/^Analyzing…\n\n/);
    expect(firstUpdate).toContain('Resolving releases');

    const lastUpdate = updateCalls[updateCalls.length - 1][1] as string;
    expect(lastUpdate).toContain('Analyzing…');
    expect(lastUpdate).toContain('Resolving releases');
    expect(lastUpdate).toContain('Scanning releases');
    expect(lastUpdate).toContain('Done.');
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

    const finalMessage = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    expect(finalMessage).toContain('✓');
    expect(finalMessage).toContain('**v8.52.0**');
    expect(finalMessage).toContain('[PR #5242]');
    expect(finalMessage).toContain('Confidence: **High** —');
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

    const finalMessage = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    expect(finalMessage).toContain('✓');
    expect(finalMessage).toContain('**v8.52.0**');
    expect(finalMessage).toContain('[PR #5242]');
    expect(finalMessage).toContain('Confidence: **High** —');
    expect(finalMessage).toContain('watchdog termination events');
    expect(finalMessage).toContain('Checked: releases `v8.49.0`–`8.52.0`');
    expect(finalMessage).not.toContain('9.4.1');
    expect(finalMessage).not.toContain('Relevant PRs evaluated');
  });

  it('includes Relevant PRs evaluated when multiple PRs for medium confidence', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks({
      fetchReleaseRange: vi.fn().mockResolvedValue({
        kind: 'releases',
        releases: [
          {
            tag: 'v8.46.0',
            name: '8.46.0',
            url: '',
            body: '### Fixes\n- fix A (#100)\n- fix B (#101)',
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
        ],
      }),
    });

    await analyzeIssue('Some regression', tools, subtasks);

    const finalMessage = (tools.postNewSlackMessage as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0];
    expect(finalMessage).toContain('Confidence: **Medium** —');
    expect(finalMessage).toContain('logging subsystem');
    expect(finalMessage).toContain('Relevant PRs evaluated:');
    expect(finalMessage).toContain('[PR #100]');
    expect(finalMessage).toContain('[PR #101]');
  });

  it('works without Slack posting when tools are no-ops', async () => {
    const tools = makeMockTools({
      postNewSlackMessage: vi.fn().mockResolvedValue(undefined),
    });
    const subtasks = makeMockSubtasks();
    const result = await analyzeIssue('Some issue', tools, subtasks);

    expect(result.kind).toBe('no_result');
    expect(tools.updateSlackMessage).toHaveBeenCalledWith(undefined, expect.any(String));
  });
});
