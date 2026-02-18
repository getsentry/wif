import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { z } from 'zod';

export function createAITools() {
  return {
    async generateObject<T>(options: {
      schema: z.ZodType<T>;
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
    },
  };
}
