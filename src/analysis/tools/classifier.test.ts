import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResult = vi.hoisted(() => ({
  owner: 'getsentry',
  repo: 'sentry-javascript',
  confidence: 'high' as const,
  reasoning: 'Issue mentions Next.js',
  sdkVersion: '8.1.0',
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('System prompt'),
}));
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ output: mockResult }),
  Output: { object: vi.fn((opts: { schema: unknown }) => opts) },
}));

import { createClassifierTools } from './classifier.js';

describe('createClassifierTools', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  it('classifyRepository returns AI classification result', async () => {
    const { classifyRepository } = createClassifierTools();
    const result = await classifyRepository('Issue with Next.js and @sentry/nextjs');
    expect(result).toEqual(mockResult);
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { classifyRepository } = createClassifierTools();
    await expect(classifyRepository('Some issue')).rejects.toThrow(
      'ANTHROPIC_API_KEY is not configured'
    );
  });
});
