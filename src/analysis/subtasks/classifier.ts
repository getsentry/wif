import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import type { AnalysisTools } from '../tools/types.js';

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

export function createClassifyRepositorySubtask(tools: Pick<AnalysisTools, 'generateObject'>) {
  return async function classifyRepository(issueDescription: string): Promise<Result> {
    const promptPath = join(__dirname, '..', '..', '..', 'prompts', 'repository-classifier.md');
    const systemPrompt = await readFile(promptPath, 'utf-8');

    return tools.generateObject({
      schema: repoAnalysisSchema,
      system: systemPrompt,
      prompt: `Analyze this issue and determine which GitHub repository it belongs to:\n\n${issueDescription}`,
    });
  };
}
