import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { buildCommandGroupVerificationReport } from '../src/core/commandGroupVerification';
import { resolveRepoRoot } from '../src/core/paths';

async function main(): Promise<void> {
  const report = await buildCommandGroupVerificationReport();
  const outDir = path.join(resolveRepoRoot(), 'mcp-server', 'reports');
  const outFile = path.join(outDir, 'command-group-verification.json');
  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, JSON.stringify(report, null, 2));

  const summary = {
    report: outFile,
    groups: report.totals.groupCount,
    ragGroups: report.totals.ragGroupCount,
    listedCommands: report.totals.listedCommandCount,
    uniqueListedCommands: report.totals.uniqueListedCommandCount,
    sharedHeadersAcrossGroups: report.totals.duplicateHeaderCountAcrossGroups,
    duplicateHeadersWithinGroups: report.totals.duplicateHeaderCountWithinGroups,
    verifiedSameGroup: report.totals.verifiedSameGroupCount,
    verifiedShared: report.totals.verifiedSharedCount,
    verifiedCuratedOverride: report.totals.verifiedCuratedOverrideCount,
    missing: report.totals.missingCount,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (report.ragMissingGroups.length || report.missingHeaders.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
