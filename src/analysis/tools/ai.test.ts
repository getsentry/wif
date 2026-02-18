import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const mockOutput = vi.hoisted(() => ({
  owner: 'getsentry',
  repo: 'sentry-javascript',
  confidence: 'high' as const,
  reasoning: 'Issue mentions Next.js',
}));

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ output: mockOutput }),
  Output: { object: vi.fn((opts: { schema: unknown }) => opts) },
}));

import { createAITools } from './ai.js';

const testSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

describe('createAITools', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  it('generateObject returns AI result', async () => {
    const { generateObject } = createAITools();
    const result = await generateObject({
      schema: testSchema,
      system: 'System prompt',
      prompt: 'Test prompt',
    });
    expect(result).toEqual(mockOutput);
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { generateObject } = createAITools();
    await expect(
      generateObject({ schema: testSchema, system: 'sys', prompt: 'prompt' })
    ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');
  });
});
