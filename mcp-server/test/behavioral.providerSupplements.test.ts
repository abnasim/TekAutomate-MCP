import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { loadProviderCatalog, resetProviderCatalog } from '../src/core/providerCatalog';
import { findProviderSupplementMatches, matchProviderSupplement } from '../src/core/providerMatcher';
import { executeBuild } from '../src/core/buildAction';
import { buildProviderSupplementDeveloperSection } from '../src/core/toolLoop';
import type { McpChatRequest } from '../src/core/schemas';

const PROVIDER_FILE = 'scope_waveform_capture.json';
const OVERLAY_FILE = 'instrument_overlays.json';

function createWaveformManifest() {
  return [
    {
      id: 'scope_waveform_capture',
      name: 'Waveform Capture Golden',
      description: 'Capture CH1 waveform and a screenshot using the golden lab flow.',
      handlerRef: 'flow_template',
      handlerConfig: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        summary: 'Applied waveform capture golden template.',
        steps: [
          {
            id: '1',
            type: 'connect',
            label: 'Connect',
            params: { instrumentIds: ['scope1'], printIdn: true },
          },
          {
            id: '2',
            type: 'save_waveform',
            label: 'Save CH1 waveform',
            params: { source: 'CH1', filename: 'ch1_data.bin', format: 'bin' },
          },
          {
            id: '3',
            type: 'save_screenshot',
            label: 'Save screenshot',
            params: { filename: 'screenshot.png', scopeType: 'modern', method: 'pc_transfer' },
          },
          {
            id: '4',
            type: 'disconnect',
            label: 'Disconnect',
            params: { instrumentIds: ['scope1'] },
          },
        ],
      },
      triggers: ['waveform capture', 'save waveform', 'capture screenshot'],
      tags: ['waveform', 'capture', 'screenshot'],
      author: 'Abdul / Lab Team',
      version: '1.0',
      tested: true,
      match: {
        keywords: ['waveform capture', 'save waveform', 'capture screenshot'],
        operations: ['waveform capture', 'screenshot capture'],
        backends: ['pyvisa'],
        deviceTypes: ['SCOPE'],
        priority: 5,
      },
    },
  ];
}

function createAfgOverlayManifest() {
  return [
    {
      id: 'afg-burst-setup',
      name: 'AFG Burst Setup',
      description: 'Configure a simple burst-mode setup for an AFG workflow that is not part of the standalone command sample set.',
      triggers: ['afg burst', 'burst setup', 'function generator burst'],
      tags: ['afg', 'burst', 'instrument', 'overlay'],
      category: 'instrument',
      handlerRef: 'echo_args',
      handlerConfig: {
        text: 'AFG burst overlay received args.',
        data: {
          checks: ['burst mode', 'trigger source', 'cycle count'],
        },
      },
      author: 'Lab Overlay Team',
      version: '0.9',
      tested: true,
      match: {
        keywords: ['afg burst', 'burst mode setup', 'function generator burst'],
        backends: ['pyvisa'],
        deviceTypes: ['AFG'],
        priority: 4,
      },
    },
  ];
}

function createPromptRequest(userMessage: string): McpChatRequest {
  return {
    userMessage,
    outputMode: 'steps_json',
    mode: 'mcp_ai',
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-5.4-nano',
    flowContext: {
      backend: 'pyvisa',
      host: '127.0.0.1',
      connectionType: 'visa',
      modelFamily: 'AFG31000',
      steps: [],
      selectedStepId: null,
      executionSource: 'steps',
      deviceType: 'AFG',
      alias: 'afg1',
    },
    runContext: {
      runStatus: 'idle',
      logTail: '',
      auditOutput: '',
      exitCode: null,
    },
  };
}

describe('behavioral.providerSupplements', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'tek-provider-supplements-'));
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      path.join(tempDir, PROVIDER_FILE),
      JSON.stringify(createWaveformManifest(), null, 2),
      'utf8'
    );
    await writeFile(
      path.join(tempDir, OVERLAY_FILE),
      JSON.stringify(createAfgOverlayManifest(), null, 2),
      'utf8'
    );
  });

  afterEach(async () => {
    delete process.env.MCP_PROVIDER_SUPPLEMENTS;
    delete process.env.MCP_PROVIDER_SUPPLEMENTS_DIR;
    resetProviderCatalog();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('loads provider supplement manifests from providers/', async () => {
    const catalog = await loadProviderCatalog({ providersDir: tempDir });
    const entries = catalog.all();
    const waveformEntry = entries.find((entry) => entry.id === 'scope_waveform_capture');
    const overlayEntry = entries.find((entry) => entry.id === 'afg-burst-setup');

    expect(entries).toHaveLength(2);
    expect(waveformEntry).toMatchObject({
      providerId: 'scope_waveform_capture',
      id: 'scope_waveform_capture',
      kind: 'template',
      backend: 'pyvisa',
      deviceType: 'SCOPE',
      author: 'Abdul / Lab Team',
      version: '1.0',
      tested: true,
    });
    expect(overlayEntry).toMatchObject({
      providerId: 'instrument_overlays',
      id: 'afg-burst-setup',
      kind: 'overlay',
      backend: 'pyvisa',
      deviceType: 'AFG',
      author: 'Lab Overlay Team',
      version: '0.9',
      tested: true,
    });
  });

  it('matches waveform capture as a strong provider override', async () => {
    const catalog = await loadProviderCatalog({ providersDir: tempDir });
    const match = matchProviderSupplement(
      catalog.all(),
      'Capture waveform and save screenshot from CH1',
      { backend: 'pyvisa', deviceType: 'SCOPE', buildNew: true }
    );

    expect(match).not.toBeNull();
    expect(match?.decision).toBe('override');
    expect(match?.score).toBeGreaterThanOrEqual(0.75);
  });

  it('matches afg overlay manifests as context supplements', async () => {
    const catalog = await loadProviderCatalog({ providersDir: tempDir });
    const matches = findProviderSupplementMatches(
      catalog.all(),
      'Configure a simple burst-mode setup for an AFG workflow that is not part of the standalone command sample set',
      { backend: 'pyvisa', deviceType: 'AFG', buildNew: true },
      { kinds: ['overlay'], limit: 2 }
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      decision: 'context',
      entry: {
        id: 'afg-burst-setup',
        kind: 'overlay',
        providerId: 'instrument_overlays',
      },
    });
    expect(matches[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it('rejects low-confidence false positives for generic capture wording', async () => {
    const catalog = await loadProviderCatalog({ providersDir: tempDir });
    const match = matchProviderSupplement(
      catalog.all(),
      'Capture the weird behavior before crash',
      { backend: 'pyvisa', deviceType: 'SCOPE', buildNew: true }
    );

    expect(match).toBeNull();
  });

  it('uses the provider template deterministically when confidence is high', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'true';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Capture waveform and save screenshot from CH1',
      context: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        alias: 'scope1',
      },
    });

    const data = result.data as Record<string, unknown>;
    const providerMatch = data.providerMatch as Record<string, unknown>;
    expect(providerMatch.applied).toBe(true);
    expect(result.text).toContain('Using golden template: scope_waveform_capture v1.0');
    expect(result.text).toContain('Template author: Abdul / Lab Team');
    expect(result.text).toContain('Template tested: true');
    expect(result.text).toContain('"name":"Waveform Capture Golden"');
  });

  it('defaults provider supplements to enabled unless explicitly disabled', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Capture waveform and save screenshot from CH1',
      context: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        alias: 'scope1',
      },
    });

    const data = result.data as Record<string, unknown>;
    const providerMatch = data.providerMatch as Record<string, unknown>;
    expect(providerMatch.applied).toBe(true);
    expect(result.text).toContain('Using golden template: scope_waveform_capture v1.0');
  });

  it('keeps planner output for medium-confidence matches and surfaces the hint', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'true';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Save waveform on CH1',
      context: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        alias: 'scope1',
      },
    });

    const data = result.data as Record<string, unknown>;
    const providerMatch = data.providerMatch as Record<string, unknown>;
    expect(providerMatch.applied).toBe(false);
    expect(providerMatch.decision).toBe('hint');
    expect(result.text).toContain('Matched golden template candidate: scope_waveform_capture v1.0');
    expect(result.text).not.toContain('Using golden template: scope_waveform_capture v1.0');
    expect(result.text).toContain('"summary":"Built');
  });

  it('surfaces overlay provider context during build fallback without overriding the flow', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'true';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Configure a simple burst-mode setup for an AFG workflow that is not part of the standalone command sample set',
      context: {
        backend: 'pyvisa',
        deviceType: 'AFG',
        modelFamily: 'AFG31000',
        steps: [],
        alias: 'afg1',
      },
    });

    const data = (result.data || {}) as Record<string, unknown>;
    expect(data.providerMatch).toBeUndefined();
    expect(result.text).toContain('Matched provider supplement: afg-burst-setup v0.9');
    expect(result.text).toContain('Provider text: AFG burst overlay received args.');
    expect(result.text).toContain('Provider data: burst mode, trigger source, cycle count');
    expect(result.text).not.toContain('Using golden template: afg-burst-setup');
  });

  it('injects matched provider overlays into the AI developer prompt context', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'true';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const section = await buildProviderSupplementDeveloperSection(
      createPromptRequest('Configure a simple burst-mode setup for an AFG workflow that is not part of the standalone command sample set')
    );

    expect(section).toContain('## MATCHED PROVIDER SUPPLEMENTS');
    expect(section).toContain('AFG Burst Setup [instrument_overlays/afg-burst-setup]');
    expect(section).toContain('role: overlay-context');
    expect(section).toContain('provider text: AFG burst overlay received args.');
    expect(section).toContain('provider data: burst mode, trigger source, cycle count');
  });

  it('falls back cleanly to planner output when providers do not match', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'true';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Set CH1 scale to 200mV and offset to 0',
      context: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        alias: 'scope1',
      },
    });

    const data = (result.data || {}) as Record<string, unknown>;
    expect(data.providerMatch).toBeUndefined();
    expect(result.text).not.toContain('golden template');
    expect(result.text).toContain('"summary":"Built');
  });

  it('preserves planner-only behavior when the feature flag is disabled', async () => {
    process.env.MCP_PROVIDER_SUPPLEMENTS = 'false';
    process.env.MCP_PROVIDER_SUPPLEMENTS_DIR = tempDir;
    resetProviderCatalog();

    const result = await executeBuild({
      query: 'Capture waveform and save screenshot from CH1',
      context: {
        backend: 'pyvisa',
        deviceType: 'SCOPE',
        modelFamily: 'MSO4/5/6 Series',
        steps: [],
        alias: 'scope1',
      },
    });

    const data = (result.data || {}) as Record<string, unknown>;
    expect(data.providerMatch).toBeUndefined();
    expect(result.text).not.toContain('Using golden template');
    expect(result.text).toContain('"summary":"Built');
  });
});
