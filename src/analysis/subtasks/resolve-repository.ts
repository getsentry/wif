import type { AnalysisTools } from '../tools/types.js';

export interface ResolveRepositoryResult {
  kind: 'resolved';
  repo: string;
}

export interface ResolveRepositoryClarification {
  kind: 'clarification';
  message: string;
}

export type ResolveRepositoryOutput = ResolveRepositoryResult | ResolveRepositoryClarification;

export function createResolveRepositorySubtask(
  tools: Pick<AnalysisTools, 'lookupSdkRepository' | 'resolveRepositoryAmbiguous'>
) {
  return async function resolveRepository(
    sdk: string,
    context?: string
  ): Promise<ResolveRepositoryOutput> {
    let repo = tools.lookupSdkRepository(sdk);

    if (!repo && context) {
      try {
        repo = await tools.resolveRepositoryAmbiguous(context);
      } catch (error) {
        console.error('Failed to resolve repository:', error);
      }
    }

    if (!repo) {
      return {
        kind: 'clarification',
        message: `Could not map SDK "${sdk}" to a repository. Please specify the GitHub repo.`,
      };
    }

    return { kind: 'resolved', repo };
  };
}
