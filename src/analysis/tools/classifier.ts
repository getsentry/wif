import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { join } from 'path';

const repoAnalysisSchema = z.object({
  owner: z.string().describe('The GitHub repository owner/organization'),
  repo: z.string().describe('The GitHub repository name'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('Confidence level of the repository match'),
  reasoning: z.string().describe('Explanation of why this repository was chosen'),
  sdkVersion: z
    .string()
    .optional()
    .describe('The SDK version mentioned in the issue description, if any'),
});

export type Result = z.infer<typeof repoAnalysisSchema>;

export function createClassifierTools() {
  return {
    async classifyRepository(issueDescription: string): Promise<Result> {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
      }

      const promptPath = join(__dirname, '..', '..', '..', 'prompts', 'repository-classifier.md');
      const systemPrompt = await readFile(promptPath, 'utf-8');

      const { output } = await generateText({
        model: anthropic('claude-sonnet-4-5'),
        output: Output.object({ schema: repoAnalysisSchema }),
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
        system: systemPrompt,
        prompt: `Analyze this issue and determine which GitHub repository it belongs to:\n\n${issueDescription}`,
      });

      return output;
    },
  };
}
