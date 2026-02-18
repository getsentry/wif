import type { AnalysisTools } from '../tools/types.js';
import { createClassifyRepositorySubtask } from './classifier.js';
import type { Result } from './classifier.js';

export type { Result };

export interface AnalysisSubtasks {
  classifyRepository(issueDescription: string): Promise<Result>;
}

export function createAnalysisSubtasks(tools: AnalysisTools): AnalysisSubtasks {
  return {
    classifyRepository: createClassifyRepositorySubtask(tools),
  };
}
