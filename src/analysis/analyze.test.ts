import { describe, it, expect, vi } from 'vitest';
import { analyzeIssue } from './analyze.js';
import type { AnalysisTools } from './tools/index.js';
import type { AnalysisSubtasks, Result } from './subtasks/index.js';

const mockResult: Result = {
  owner: 'getsentry',
  repo: 'sentry-javascript',
  confidence: 'high',
  reasoning: 'Issue mentions Next.js',
  sdkVersion: '8.1.0',
};

function makeMockTools(overrides?: Partial<AnalysisTools>): AnalysisTools {
  return {
    generateObject: vi.fn().mockResolvedValue(mockResult),
    postNewSlackMessage: vi
      .fn()
      .mockResolvedValueOnce('progress-ts')
      .mockResolvedValue('result-ts'),
    updateSlackMessage: vi.fn().mockResolvedValue(undefined),
    getReleasesFromVersion: vi.fn().mockResolvedValue([]),
    findAllReleases: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeMockSubtasks(overrides?: Partial<AnalysisSubtasks>): AnalysisSubtasks {
  return {
    classifyRepository: vi.fn().mockResolvedValue(mockResult),
    ...overrides,
  };
}

describe('analyzeIssue', () => {
  it('calls classifyRepository with the issue description and returns result', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    const result = await analyzeIssue('Some issue', tools, subtasks);
    expect(result).toEqual(mockResult);
    expect(subtasks.classifyRepository).toHaveBeenCalledWith('Some issue');
  });

  it('posts progress message, updates it, then posts final result', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    await analyzeIssue('Some issue', tools, subtasks);

    expect(tools.postNewSlackMessage).toHaveBeenNthCalledWith(1, 'Analyzing…');
    expect(tools.updateSlackMessage).toHaveBeenNthCalledWith(
      1,
      'progress-ts',
      'Classifying repository…'
    );
    expect(tools.updateSlackMessage).toHaveBeenNthCalledWith(
      2,
      'progress-ts',
      'Classification done.'
    );
    expect(tools.postNewSlackMessage).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('*Repository Analysis*')
    );
  });

  it('includes SDK version in the result message', async () => {
    const tools = makeMockTools();
    const subtasks = makeMockSubtasks();
    await analyzeIssue('Some issue', tools, subtasks);
    expect(tools.postNewSlackMessage).toHaveBeenLastCalledWith(
      expect.stringContaining('*SDK Version:* 8.1.0')
    );
  });

  it('works without Slack posting when tools are no-ops', async () => {
    const tools = makeMockTools({
      postNewSlackMessage: vi.fn().mockResolvedValue(undefined),
    });
    const subtasks = makeMockSubtasks();
    const result = await analyzeIssue('Some issue', tools, subtasks);
    expect(result).toEqual(mockResult);
    expect(tools.updateSlackMessage).toHaveBeenCalledWith(undefined, 'Classifying repository…');
    expect(tools.updateSlackMessage).toHaveBeenCalledWith(undefined, 'Classification done.');
  });
});
