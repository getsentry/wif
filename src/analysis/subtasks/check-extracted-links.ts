import { parse as semverParse } from 'semver';
import type { AnalysisTools } from '../tools/types.js';
import { prLinkFor } from '../utils.js';

export interface LinkHighConfidenceResult {
  kind: 'high_confidence';
  version: string;
  prNumber: number;
  prLink: string;
  reason: string;
}

export interface LinkFallthrough {
  kind: 'fallthrough';
  skippedLinks?: Array<{ url: string; reason: string }>;
}

export type CheckExtractedLinksOutput = LinkHighConfidenceResult | LinkFallthrough;

function parseVersion(version: string): string {
  const v = version.replace(/^v/, '');
  const parsed = semverParse(v) ?? semverParse(version);
  return parsed ? parsed.version : v;
}

function versionAfter(fixedVersion: string, userVersion: string): boolean {
  const fixed = semverParse(parseVersion(fixedVersion));
  const user = semverParse(parseVersion(userVersion));
  if (!fixed || !user) return false;
  return fixed.compare(user) > 0;
}

export function createCheckExtractedLinksSubtask(
  tools: Pick<
    AnalysisTools,
    'getIssueResolution' | 'getPrDetails' | 'scorePrConfidence' | 'verifyPrMatch'
  >
) {
  return async function checkExtractedLinks(
    links: string[],
    version: string,
    repo: string,
    problem: string,
    issueDescription: string
  ): Promise<CheckExtractedLinksOutput> {
    const skippedLinks: Array<{ url: string; reason: string }> = [];

    for (const link of links) {
      try {
        const resolution = await tools.getIssueResolution(link);
        if (!resolution) continue;

        if (!versionAfter(resolution.fixed_in_version, version)) {
          continue;
        }

        const prDetails = await tools.getPrDetails(repo, resolution.pr_number);
        if (!prDetails) continue;

        const { level, reason } = await tools.scorePrConfidence(
          prDetails.title,
          prDetails.body,
          problem,
          issueDescription
        );

        if (level === 'high') {
          const verification = await tools.verifyPrMatch(
            prDetails.title,
            prDetails.body,
            problem,
            issueDescription
          );
          if (verification.confirmed) {
            const prLink = prLinkFor(repo, resolution.pr_number);
            return {
              kind: 'high_confidence',
              version: resolution.fixed_in_version,
              prNumber: resolution.pr_number,
              prLink,
              reason,
            };
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Failed to check link ${link}:`, error);
        skippedLinks.push({ url: link, reason });
      }
    }

    return {
      kind: 'fallthrough',
      skippedLinks: skippedLinks.length > 0 ? skippedLinks : undefined,
    };
  };
}
