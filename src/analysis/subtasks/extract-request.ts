import type { AnalysisTools } from '../tools/types.js';

export interface ExtractResult {
  kind: 'extracted';
  sdk: string;
  version: string;
  problem: string;
  links?: string[];
}

export interface ClarificationRequest {
  kind: 'clarification';
  message: string;
}

export type ExtractRequestResult = ExtractResult | ClarificationRequest;

export function createExtractRequestSubtask(tools: Pick<AnalysisTools, 'extractRequest'>) {
  return async function extractRequest(message: string): Promise<ExtractRequestResult> {
    const extracted = await tools.extractRequest(message);

    if (!extracted.sdk || !extracted.version) {
      const missing = [];
      if (!extracted.sdk) missing.push('SDK');
      if (!extracted.version) missing.push('version');
      return {
        kind: 'clarification',
        message: `Could not determine ${missing.join(' and ')}. Please clarify.`,
      };
    }

    return {
      kind: 'extracted',
      sdk: extracted.sdk,
      version: extracted.version,
      problem: extracted.problem,
      links: extracted.links,
    };
  };
}
