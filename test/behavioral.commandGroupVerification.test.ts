import { describe, expect, it } from 'vitest';
import { buildCommandGroupVerificationReport } from '../src/core/commandGroupVerification';

const EXPECTED_MISSING_HEADERS: Array<{ groupName: string; header: string }> = [];

describe('behavioral.commandGroupVerification', () => {
  it('verifies the full curated command-group registry against the JSON corpus', async () => {
    const report = await buildCommandGroupVerificationReport();

    expect(report.totals.groupCount).toBe(34);
    expect(report.totals.ragGroupCount).toBe(34);
    expect(report.totals.listedCommandCount).toBe(2952);
    expect(report.ragMissingGroups).toEqual([]);
    expect(report.totals.duplicateHeaderCountAcrossGroups).toBe(108);
    expect(report.totals.duplicateHeaderCountWithinGroups).toBe(4);

    expect(report.missingHeaders).toEqual(EXPECTED_MISSING_HEADERS);
  });

  it('distinguishes shared headers from curated overrides instead of treating both as hard failures', async () => {
    const report = await buildCommandGroupVerificationReport();

    expect(report.totals.verifiedSharedCount).toBeGreaterThan(0);
    expect(report.totals.verifiedCuratedOverrideCount).toBeGreaterThan(0);

    const cursor = report.groups.find((group) => group.name === 'Cursor');
    expect(cursor?.statusCounts.verified_shared).toBeGreaterThan(0);

    const statusAndError = report.groups.find((group) => group.name === 'Status and Error');
    expect(statusAndError?.statusCounts.verified_curated_override).toBeGreaterThan(0);
  });
});
