import { describe, it, expect, vi } from 'vitest';
import { analyzeIssue } from './analyze.js';
import type { AnalysisTools } from './tools/index.js';
import type { AnalysisSubtasks } from './subtasks/index.js';

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
      }),
    });

    const result = await analyzeIssue('Issue with link', tools, subtasks);

    expect(result.kind).toBe('high_confidence');
    expect(result.version).toBe('8.52.0');
    expect(subtasks.fetchReleaseRange).not.toHaveBeenCalled();
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
