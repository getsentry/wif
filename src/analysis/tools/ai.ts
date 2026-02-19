import { readFile } from 'fs/promises';
import { join } from 'path';
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import type { z as zType } from 'zod';
import { withToolSpan } from './span.js';

const extractRequestSchema = z.object({
  sdk: z.string().nullable().describe('SDK identifier (e.g., sentry-cocoa, iOS)'),
  version: z.string().nullable().describe('Version where issue was first noticed'),
  problem: z.string().describe('Concise summary of the reported behavior'),
  links: z.array(z.string().url()).optional().describe('GitHub issue/PR URLs from the message'),
});

const resolveRepositorySchema = z.object({
  repo: z.string().describe('owner/repo slug (e.g., getsentry/sentry-cocoa)'),
});

const filterRelevantEntriesSchema = z.object({
  entries: z.array(
    z.object({
      release: z.string().describe('Release version'),
      line: z.string().describe('The release note line'),
      pr_reference: z.string().optional().describe('PR reference (e.g., #1234)'),
    })
  ),
});

const scorePrConfidenceSchema = z.object({
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().describe('One-sentence explanation citing specific evidence from the PR'),
});

const verifyPrMatchSchema = z.object({
  confirmed: z
    .boolean()
    .describe('Whether the PR precisely fixes the same symptom described in the issue'),
  reason: z
    .string()
    .describe('One-sentence explanation citing specific evidence from both the issue and the PR'),
});

export function createAITools() {
  async function generateObject<T>(options: {
    schema: zType.ZodType<T>;
    system: string;
    prompt: string;
  }): Promise<T> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const { output } = await generateText({
      model: anthropic('claude-sonnet-4-5'),
      output: Output.object({ schema: options.schema }),
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: true,
        recordOutputs: true,
      },
      system: options.system,
      prompt: options.prompt,
    });

    return output;
  }

  return {
    generateObject,

    async extractRequest(message: string): Promise<z.infer<typeof extractRequestSchema>> {
      return withToolSpan('extractRequest', { message }, async () => {
        const promptPath = join(__dirname, '..', '..', '..', 'prompts', 'extract-request.md');
        const systemPrompt = await readFile(promptPath, 'utf-8');
        return generateObject({
          schema: extractRequestSchema,
          system: systemPrompt,
          prompt: message,
        });
      });
    },

    async resolveRepositoryAmbiguous(context: string): Promise<string> {
      return withToolSpan('resolveRepositoryAmbiguous', { context }, async () => {
        const promptPath = join(
          __dirname,
          '..',
          '..',
          '..',
          'prompts',
          'resolve-repository-ambiguous.md'
        );
        const systemPrompt = await readFile(promptPath, 'utf-8');
        const result = await generateObject({
          schema: resolveRepositorySchema,
          system: systemPrompt,
          prompt: context,
        });
        return result.repo;
      });
    },

    async filterRelevantEntries(
      releaseNotes: string,
      problem: string,
      issueDescription: string
    ): Promise<Array<{ release: string; line: string; pr_reference?: string }>> {
      return withToolSpan('filterRelevantEntries', { problem }, async () => {
        const promptPath = join(
          __dirname,
          '..',
          '..',
          '..',
          'prompts',
          'filter-relevant-entries.md'
        );
        const systemPrompt = await readFile(promptPath, 'utf-8');
        const result = await generateObject({
          schema: filterRelevantEntriesSchema,
          system: systemPrompt,
          prompt: `Problem: ${problem}\n\nIssue description:\n${issueDescription}\n\nRelease notes:\n${releaseNotes}`,
        });
        return result.entries;
      });
    },

    async scorePrConfidence(
      prTitle: string,
      prBody: string | null,
      problem: string,
      issueDescription: string
    ): Promise<{ level: 'high' | 'medium' | 'low'; reason: string }> {
      return withToolSpan('scorePrConfidence', { prTitle, problem }, async () => {
        const promptPath = join(__dirname, '..', '..', '..', 'prompts', 'score-pr-confidence.md');
        const systemPrompt = await readFile(promptPath, 'utf-8');
        const body = (prBody ?? '').slice(0, 80000);
        const result = await generateObject({
          schema: scorePrConfidenceSchema,
          system: systemPrompt,
          prompt: `Problem: ${problem}\n\nIssue description:\n${issueDescription}\n\nPR Title: ${prTitle}\n\nPR Description:\n${body}`,
        });
        return { level: result.confidence, reason: result.reason };
      });
    },

    async verifyPrMatch(
      prTitle: string,
      prBody: string | null,
      problem: string,
      issueDescription: string
    ): Promise<{ confirmed: boolean; reason: string }> {
      return withToolSpan('verifyPrMatch', { prTitle, problem }, async () => {
        const promptPath = join(__dirname, '..', '..', '..', 'prompts', 'verify-pr-match.md');
        const systemPrompt = await readFile(promptPath, 'utf-8');
        const body = (prBody ?? '').slice(0, 80000);
        return generateObject({
          schema: verifyPrMatchSchema,
          system: systemPrompt,
          prompt: `Problem: ${problem}\n\nIssue description:\n${issueDescription}\n\nPR Title: ${prTitle}\n\nPR Description:\n${body}`,
        });
      });
    },
  };
}
