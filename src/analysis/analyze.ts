import type { AnalysisSubtasks, ScanReleaseNotesOutput } from './subtasks/index.js';
import type { AnalysisTools } from './tools/index.js';
import { prLinkMarkdown } from './utils.js';

export interface ReasoningStep {
  step: string;
  output: string;
}

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
  const reasoning: ReasoningStep[] = [];

  const appendProgress = async (line: string): Promise<void> => {
    progressText = progressText + '\n\n' + line;
    await tools.updateSlackMessage(progressTs, progressText);
  };

  const extractResult = await subtasks.extractRequest(issueDescription);
  if (extractResult.kind === 'clarification') {
    reasoning.push({
      step: 'Extract Request',
      output: `Clarification needed: ${extractResult.message}`,
    });
    await appendProgress(extractResult.message);
    await tools.postNewSlackMessage(extractResult.message);
    await uploadReasoning(tools, issueDescription, reasoning, {
      kind: 'clarification',
      message: extractResult.message,
    });
    return { kind: 'clarification', message: extractResult.message };
  }

  const { sdk, version, problem, links } = extractResult;
  reasoning.push({
    step: 'Extract Request',
    output: `SDK: ${sdk}, Version: ${version}, Problem: ${problem}${links?.length ? `, Links: ${links.join(', ')}` : ''}`,
  });

  const resolveResult = await subtasks.resolveRepository(sdk, issueDescription);
  if (resolveResult.kind === 'clarification') {
    reasoning.push({
      step: 'Resolve Repository',
      output: `Clarification needed: ${resolveResult.message}`,
    });
    await appendProgress(resolveResult.message);
    await tools.postNewSlackMessage(resolveResult.message);
    await uploadReasoning(tools, issueDescription, reasoning, {
      kind: 'clarification',
      message: resolveResult.message,
    });
    return { kind: 'clarification', message: resolveResult.message };
  }

  const repo = resolveResult.repo;
  reasoning.push({ step: 'Resolve Repository', output: repo });

  const skippedSteps: string[] = [];

  if (links && links.length > 0) {
    await appendProgress('Checking linked issues…');
    const linkResult = await subtasks.checkExtractedLinks(links, version, repo, problem);
    if (linkResult.kind === 'high_confidence') {
      reasoning.push({
        step: 'Check Extracted Links',
        output: `High confidence from link: v${linkResult.version}, PR #${linkResult.prNumber}`,
      });
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
        appendProgress,
        issueDescription,
        reasoning
      );
      return result;
    }
    reasoning.push({
      step: 'Check Extracted Links',
      output: linkResult.skippedLinks?.length
        ? `Fallthrough. Skipped: ${linkResult.skippedLinks.map((s) => `${s.url}: ${s.reason}`).join('; ')}`
        : 'Fallthrough, no high-confidence match',
    });
    if (linkResult.skippedLinks?.length) {
      for (const { url, reason } of linkResult.skippedLinks) {
        skippedSteps.push(`Could not check link ${url}: ${reason}`);
      }
    }
  }

  await appendProgress(`Resolving releases for ${repo} after v${version}…`);

  const fetchResult = await subtasks.fetchReleaseRange(repo, version);

  if (fetchResult.kind === 'too_old') {
    reasoning.push({ step: 'Fetch Release Range', output: 'Too old: >100 releases since version' });
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
      appendProgress,
      issueDescription,
      reasoning
    );
    return result;
  }

  if (fetchResult.kind === 'already_latest') {
    reasoning.push({ step: 'Fetch Release Range', output: 'Already on latest stable release' });
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
      appendProgress,
      issueDescription,
      reasoning
    );
    return result;
  }

  if (fetchResult.kind === 'invalid_version') {
    reasoning.push({
      step: 'Fetch Release Range',
      output: `Invalid version: ${fetchResult.message}`,
    });
    const result: AnalysisResult = {
      kind: 'invalid_version',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      { repo, version, skippedSteps },
      appendProgress,
      issueDescription,
      reasoning
    );
    return result;
  }

  if (fetchResult.kind === 'fetch_failed') {
    reasoning.push({ step: 'Fetch Release Range', output: `Fetch failed: ${fetchResult.message}` });
    const result: AnalysisResult = {
      kind: 'fetch_failed',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      { repo, version, skippedSteps },
      appendProgress,
      issueDescription,
      reasoning
    );
    return result;
  }

  const releases = fetchResult.releases;
  const firstRelease = releases[0]?.tag ?? version;
  const lastReleaseInRange = releases[releases.length - 1]?.tag ?? version;

  reasoning.push({
    step: 'Fetch Release Range',
    output: `${releases.length} releases (${firstRelease}–${lastReleaseInRange})`,
  });

  await appendProgress(
    `Scanning releases \`${firstRelease}\`–\`${lastReleaseInRange}\` (\`${releases.length}\` releases)…`
  );

  const scanResult = await subtasks.scanReleaseNotes(releases, problem, repo, (done, total) => {
    appendProgress(`Scanned \`${done}\` of \`${total}\` releases…`);
  });

  const result = mapScanResultToAnalysisResult(scanResult);
  const scanOutput =
    result.kind === 'high_confidence'
      ? `High confidence: v${result.version}, PR #${result.prNumber}`
      : result.kind === 'medium_confidence'
        ? `Medium confidence: v${result.version}, PR #${result.prNumber}; candidates: ${result.candidates.length}`
        : 'No result';
  reasoning.push({ step: 'Scan Release Notes', output: scanOutput });

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
            ? result.candidates.map((c) => prLinkMarkdown(repo, c.prNumber))
            : [],
      skippedSteps,
    },
    appendProgress,
    issueDescription,
    reasoning
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

function formatReasoningMarkdown(
  issueDescription: string,
  reasoning: ReasoningStep[],
  result: AnalysisResult
): string {
  const inputPreview =
    issueDescription.length > 500 ? issueDescription.slice(0, 500) + '…' : issueDescription;

  const stepsMd = reasoning
    .map((r, i) => `### Step ${i + 1}: ${r.step}\n\n**Output:** ${r.output}`)
    .join('\n\n');

  const resultSummary =
    result.kind === 'high_confidence'
      ? `High confidence: fixed in v${result.version} (PR #${(result as { prNumber: number }).prNumber})`
      : result.kind === 'medium_confidence'
        ? `Medium confidence: v${result.version} (PR #${(result as { prNumber: number }).prNumber})`
        : result.kind === 'clarification'
          ? `Clarification: ${result.message}`
          : result.kind;

  return `# WIF Reasoning Document

## Input

\`\`\`
${inputPreview}
\`\`\`

## Steps Taken

${stepsMd}

## Final Result

${resultSummary}
`;
}

async function uploadReasoning(
  tools: AnalysisTools,
  issueDescription: string,
  reasoning: ReasoningStep[],
  result: AnalysisResult
): Promise<void> {
  const markdown = formatReasoningMarkdown(issueDescription, reasoning, result);
  await tools.uploadFileToThread('reasoning.md', markdown).catch((err) => {
    console.warn('Failed to upload reasoning document:', err);
  });
}

async function postResult(
  tools: AnalysisTools,
  progressTs: string | undefined,
  result: AnalysisResult,
  ctx: PostResultContext,
  appendProgress: (line: string) => Promise<void>,
  issueDescription: string,
  reasoning: ReasoningStep[]
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
        `✓ This was fixed in **v${normalizeVersion(result.version)}**. See ${prMd}.\n` +
        `Confidence: **High**\n\n` +
        trace;
      break;
    }
    case 'medium_confidence': {
      const prMd = ctx.repo ? prLinkMarkdown(ctx.repo, result.prNumber) : result.prLink;
      responseText =
        `**v${normalizeVersion(result.version)}** includes changes that may address this (${prMd}), ` +
        `but I'm not fully certain. Deferring to SDK maintainers to confirm.\n` +
        `Confidence: **Medium**\n\n` +
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
  await uploadReasoning(tools, issueDescription, reasoning, result);
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}
