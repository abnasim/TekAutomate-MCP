import { describe, expect, it } from 'vitest';
import { buildCommandGroupSeedQuery, suggestCommandGroups } from '../src/core/commandGroups';

describe('behavioral.commandGroups', () => {
  it('suggests non-handpicked groups from the command group registry', () => {
    const groups = suggestCommandGroups('Show a histogram with cursor readout on the display and zoom into it');

    expect(groups).toContain('Histogram');
    expect(groups).toContain('Cursor');
    expect(groups).toContain('Display');
    expect(groups).toContain('Zoom');
  });

  it('suggests interface-oriented groups such as Ethernet from the group registry', () => {
    const groups = suggestCommandGroups('Configure the ethernet remote interface, set DHCP, and check LXI service name');

    expect(groups).toContain('Ethernet');
  });

  it('builds BM25 seed queries from the group table instead of hardcoded phrases only', () => {
    const seed = buildCommandGroupSeedQuery('Search and Mark');

    expect(seed).toContain('search');
    expect(seed).toContain('mark');
    expect(seed).toContain('error');
  });
});
