import { describe, it, expect, vi } from 'vitest';

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('System prompt'),
}));

import { createClassifyRepositorySubtask } from './classifier.js';
import type { AnalysisTools } from '../tools/types.js';

const mockResult = {
  owner: 'getsentry',
  repo: 'sentry-javascript',
  confidence: 'high' as const,
  reasoning: 'Issue mentions Next.js',
  sdkVersion: '8.1.0',
};

describe('classifyRepository subtask', () => {
  it('calls generateObject with the system prompt and issue description', async () => {
    const tools: Pick<AnalysisTools, 'generateObject'> = {
      generateObject: vi.fn().mockResolvedValue(mockResult),
    };
    const classifyRepository = createClassifyRepositorySubtask(tools);

    const result = await classifyRepository('Issue with Next.js and @sentry/nextjs');

    expect(result).toEqual(mockResult);
    expect(tools.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'System prompt',
        prompt: expect.stringContaining('Issue with Next.js and @sentry/nextjs'),
      })
    );
  });
});
