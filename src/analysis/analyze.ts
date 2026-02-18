import type { AnalysisSubtasks, ScanReleaseNotesOutput } from './subtasks/index.js';
import type { AnalysisTools } from './tools/index.js';
import { prLinkMarkdown } from './utils.js';

export type AnalysisResult = { message: string } & (
  | { kind: 'high_confidence'; version: string; prLink: string; prNumber: number }
  | {
      kind: 'medium_confidence';
      version: string;
      prLink: string;
      prNumber: number;
      candidates: Array<{ version: string; prLink: string; prNumber: number }>;
    }
  | { kind: 'no_result' }
  | { kind: 'too_old' }
  | { kind: 'already_latest' }
  | { kind: 'invalid_version' }
  | { kind: 'fetch_failed' }
  | { kind: 'clarification' }
);

export async function analyzeIssue(
  issueDescription: string,
  tools: AnalysisTools,
  subtasks: AnalysisSubtasks
): Promise<AnalysisResult> {
  let progressText = 'Analyzing…';
  const progressTs = await tools.postNewSlackMessage(progressText);

  const appendProgress = async (line: string): Promise<void> => {
    progressText = progressText + '\n\n' + line;
    await tools.updateSlackMessage(progressTs, progressText);
  };

  const extractResult = await subtasks.extractRequest(issueDescription);
  if (extractResult.kind === 'clarification') {
    await appendProgress(extractResult.message);
    await tools.postNewSlackMessage(extractResult.message);
    return { kind: 'clarification', message: extractResult.message };
  }

  const { sdk, version, problem, links } = extractResult;

  const resolveResult = await subtasks.resolveRepository(sdk, issueDescription);
  if (resolveResult.kind === 'clarification') {
    await appendProgress(resolveResult.message);
    await tools.postNewSlackMessage(resolveResult.message);
    return { kind: 'clarification', message: resolveResult.message };
  }

  const repo = resolveResult.repo;

  const skippedSteps: string[] = [];

  if (links && links.length > 0) {
    await appendProgress('Checking linked issues…');
    const linkResult = await subtasks.checkExtractedLinks(links, version, repo, problem);
    if (linkResult.kind === 'high_confidence') {
      const result: AnalysisResult = {
        message: '',
        kind: 'high_confidence',
        version: linkResult.version,
        prLink: linkResult.prLink,
        prNumber: linkResult.prNumber,
      };
      await postResult(
        tools,
        progressTs,
        result,
        {
          repo,
          firstRelease: linkResult.version,
          lastRelease: linkResult.version,
          releaseCount: 1,
          evaluatedPrs: [prLinkMarkdown(repo, linkResult.prNumber)],
          skippedSteps,
        },
        appendProgress
      );
      return result;
    }
    if (linkResult.skippedLinks?.length) {
      for (const { url, reason } of linkResult.skippedLinks) {
        skippedSteps.push(`Could not check link ${url}: ${reason}`);
      }
    }
  }

  await appendProgress(`Resolving releases for ${repo} after v${version}…`);

  const fetchResult = await subtasks.fetchReleaseRange(repo, version);

  if (fetchResult.kind === 'too_old') {
    const result: AnalysisResult = { kind: 'too_old', message: fetchResult.message };
    await postResult(
      tools,
      progressTs,
      result,
      {
        repo,
        version,
        releaseCount: 0,
        skippedSteps,
      },
      appendProgress
    );
    return result;
  }

  if (fetchResult.kind === 'already_latest') {
    const result: AnalysisResult = {
      kind: 'already_latest',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      {
        repo,
        version,
        releaseCount: 0,
        skippedSteps,
      },
      appendProgress
    );
    return result;
  }

  if (fetchResult.kind === 'invalid_version') {
    const result: AnalysisResult = {
      kind: 'invalid_version',
      message: fetchResult.message,
    };
    await postResult(tools, progressTs, result, { repo, version, skippedSteps }, appendProgress);
    return result;
  }

  if (fetchResult.kind === 'fetch_failed') {
    const result: AnalysisResult = {
      kind: 'fetch_failed',
      message: fetchResult.message,
    };
    await postResult(tools, progressTs, result, { repo, version, skippedSteps }, appendProgress);
    return result;
  }

  const releases = fetchResult.releases;
  const firstRelease = releases[0]?.tag ?? version;
  const lastReleaseInRange = releases[releases.length - 1]?.tag ?? version;

  await appendProgress(
    `Scanning releases \`${firstRelease}\`–\`${lastReleaseInRange}\` (\`${releases.length}\` releases)…`
  );

  const scanResult = await subtasks.scanReleaseNotes(releases, problem, repo, (done, total) => {
    appendProgress(`Scanned \`${done}\` of \`${total}\` releases…`);
  });

  const result = mapScanResultToAnalysisResult(scanResult);

  const lastRelease =
    result.kind === 'high_confidence'
      ? result.version
      : (releases[releases.length - 1]?.tag ?? version);
  await postResult(
    tools,
    progressTs,
    result,
    {
      repo,
      firstRelease,
      lastRelease,
      releaseCount: releases.length,
      version,
      evaluatedPrs:
        result.kind === 'high_confidence'
          ? [prLinkMarkdown(repo, result.prNumber)]
          : result.kind === 'medium_confidence'
            ? result.candidates.slice(0, 3).map((c) => prLinkMarkdown(repo, c.prNumber))
            : [],
      skippedSteps,
    },
    appendProgress
  );

  return result;
}

function mapScanResultToAnalysisResult(scan: ScanReleaseNotesOutput): AnalysisResult {
  if (scan.kind === 'high_confidence') {
    return {
      message: '',
      kind: 'high_confidence',
      version: scan.candidate.version,
      prLink: scan.candidate.prLink,
      prNumber: scan.candidate.prNumber,
    };
  }
  if (scan.kind === 'medium') {
    const best = scan.candidates[0];
    return {
      message: '',
      kind: 'medium_confidence',
      version: best.version,
      prLink: best.prLink,
      prNumber: best.prNumber,
      candidates: scan.candidates.map((c) => ({
        version: c.version,
        prLink: c.prLink,
        prNumber: c.prNumber,
      })),
    };
  }
  return { kind: 'no_result', message: '' };
}

interface PostResultContext {
  repo?: string;
  firstRelease?: string;
  lastRelease?: string;
  releaseCount?: number;
  version?: string;
  evaluatedPrs?: string[];
  skippedSteps?: string[];
}

async function postResult(
  tools: AnalysisTools,
  progressTs: string | undefined,
  result: AnalysisResult,
  ctx: PostResultContext,
  appendProgress: (line: string) => Promise<void>
): Promise<void> {
  const checked =
    ctx.firstRelease && ctx.lastRelease && ctx.repo
      ? `Checked: releases \`${ctx.firstRelease}\`–\`${ctx.lastRelease}\` in \`${ctx.repo}\`.`
      : ctx.version
        ? `Checked: version \`${ctx.version}\`.`
        : '';
  const evaluated =
    ctx.evaluatedPrs && ctx.evaluatedPrs.length > 1
      ? `Relevant PRs evaluated: ${ctx.evaluatedPrs.join(', ')}.`
      : ctx.releaseCount !== undefined && (!ctx.evaluatedPrs || ctx.evaluatedPrs.length === 0)
        ? `Release notes reviewed: ${ctx.releaseCount}.`
        : '';
  const skipped =
    ctx.skippedSteps && ctx.skippedSteps.length > 0
      ? `Skipped steps: ${ctx.skippedSteps.join('; ')}.`
      : '';

  let responseText: string;

  const trace = [checked, evaluated, skipped].filter(Boolean).join('\n');

  switch (result.kind) {
    case 'high_confidence': {
      const prMd = ctx.repo ? prLinkMarkdown(ctx.repo, result.prNumber) : result.prLink;
      responseText =
        `✓ This was fixed in **v${normalizeVersion(result.version)}**. See ${prMd}.\n\n` + trace;
      break;
    }
    case 'medium_confidence': {
      const topCandidates = result.candidates.slice(0, 3);
      const candidateLines = topCandidates.map(
        (c, i) =>
          `${i + 1}. **v${normalizeVersion(c.version)}** — ${ctx.repo ? prLinkMarkdown(ctx.repo, c.prNumber) : c.prLink}`
      );
      responseText =
        `I'm not fully certain, but here are potential candidates:\n\n` +
        candidateLines.join('\n') +
        `\n\nDeferring to SDK maintainers to confirm.\n\n` +
        trace;
      break;
    }
    case 'no_result':
      responseText =
        `I wasn't able to identify a fix in the releases after v${ctx.version ?? '?'}.\n` +
        `Deferring to SDK maintainers for investigation.\n\n` +
        trace;
      break;
    case 'too_old':
      responseText =
        `The reported version (v${ctx.version ?? '?'}) is more than 100 releases behind ` +
        `the latest stable release. Unable to look this up efficiently.\n` +
        `Deferring to SDK maintainers.` +
        (skipped ? `\n\n${skipped}` : '');
      break;
    case 'already_latest':
    case 'invalid_version':
    case 'fetch_failed':
    case 'clarification':
      responseText = result.message + (skipped ? `\n\n${skipped}` : '');
      break;
  }

  await appendProgress('Done.');
  await tools.postNewSlackMessage(responseText);
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}
