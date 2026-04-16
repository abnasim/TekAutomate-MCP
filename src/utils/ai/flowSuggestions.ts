import type { StepPreview } from '../../components/ExecutePage/StepsListPreview';
import type { AiAction } from '../aiActions';
import type { RagCorpus } from './types';

export interface FlowSuggestion {
  id: string;
  label: string;
  severity: 'error' | 'warning' | 'info';
  fixAction?: AiAction;      // instant apply — deterministic fix
  chatPrompt?: string;       // pre-fill message box — needs AI
}

function flattenSteps(steps: StepPreview[]): StepPreview[] {
  const flat: StepPreview[] = [];
  const walk = (items: StepPreview[]) =>
    items.forEach((s) => {
      flat.push(s);
      if (Array.isArray(s.children)) walk(s.children);
    });
  walk(steps);
  return flat;
}

export function computeFlowSuggestions(
  steps: StepPreview[],
  executionSource: 'steps' | 'blockly'
): FlowSuggestion[] {
  if (executionSource === 'blockly') return []; // Blockly has its own validation

  const suggestions: FlowSuggestion[] = [];
  const flat = flattenSteps(steps);

  // Rule 1: query steps missing saveAs
  const queriesWithoutSaveAs = flat.filter(
    (s) =>
      s.type === 'query' &&
      !((s.params as any)?.saveAs) &&
      !((s.params as any)?.outputVariable)
  );
  if (queriesWithoutSaveAs.length > 0) {
    suggestions.push({
      id: 'missing-saveAs',
      label: `${queriesWithoutSaveAs.length} query step${
        queriesWithoutSaveAs.length > 1 ? 's' : ''
      } missing saveAs`,
      severity: 'error',
      chatPrompt: `Add saveAs parameters to all query steps that are missing them`,
    });
  }

  // Rule 2: no disconnect at end
  const lastTopLevel = steps[steps.length - 1];
  if (steps.length > 0 && lastTopLevel?.type !== 'disconnect') {
    suggestions.push({
      id: 'missing-disconnect',
      label: 'Flow should end with a disconnect step',
      severity: 'error',
      chatPrompt: 'Add a disconnect step at the end of the flow',
    });
  }

  // Rule 3: no connect at start
  if (steps.length > 0 && steps[0]?.type !== 'connect') {
    suggestions.push({
      id: 'missing-connect',
      label: 'Flow should start with a connect step',
      severity: 'error',
      chatPrompt: 'Add a connect step at the beginning of the flow',
    });
  }

  // Rule 4: tm_device_command with pyvisa backend (wrong combo)
  const connectStep = flat.find((cs) => cs.type === 'connect');
  const backend = (connectStep?.params as any)?.backend || '';
  const badTmSteps = flat.filter(
    (s) => s.type === 'tm_device_command' && backend === 'pyvisa'
  );
  if (badTmSteps.length > 0) {
    suggestions.push({
      id: 'tm-devices-pyvisa-mismatch',
      label: 'tm_device_command steps found but backend is pyvisa',
      severity: 'warning',
      chatPrompt:
        'Fix backend mismatch — switch connect step to tm_devices backend',
    });
  }

  // Rule 5: group steps missing children or params
  const badGroups = flat.filter(
    (s) =>
      s.type === 'group' &&
      (!Array.isArray(s.children) || !(s.params && typeof s.params === 'object'))
  );
  if (badGroups.length > 0) {
    suggestions.push({
      id: 'bad-groups',
      label: `${badGroups.length} group step${
        badGroups.length > 1 ? 's' : ''
      } missing params or children`,
      severity: 'warning',
      chatPrompt:
        'Fix group steps — ensure all groups have params:{} and children:[]',
    });
  }

  return suggestions;
}

/** Shape returned by computeDynamicQuickActions. */
export interface DynamicQuickAction {
  id: string;
  label: string;
  /** Sent immediately as the user message. Empty string means don't auto-send. */
  prompt: string;
  /**
   * Pre-fills the textarea with this string and focuses it instead of sending.
   * Used for actions like "SCPI Lookup" where the user must complete the query.
   */
  inputTemplate?: string;
  corporaHint?: RagCorpus[];
}

export function computeDynamicQuickActions(
  steps: StepPreview[],
  executionSource: 'steps' | 'blockly',
  suggestions: FlowSuggestion[]
): DynamicQuickAction[] {
  const flat = flattenSteps(steps);
  const stepTypes = new Set(flat.map((s) => s.type));
  const hasErrors = suggestions.some((s) => s.severity === 'error');
  const hasTmDevices = stepTypes.has('tm_device_command');
  const hasScreenshot = stepTypes.has('save_screenshot');

  // ── Base actions (always shown unless swapped below) ────────────────────
  const base: DynamicQuickAction[] = [
    {
      id: 'validate-flow',
      label: '✓ Validate Flow',
      prompt:
        'Validate the current flow — check for missing saveAs, disconnect, group structure, and backend mismatches',
      corporaHint: ['templates', 'errors'],
    },
    {
      id: 'scpi-lookup',
      label: '⌨ SCPI Lookup',
      prompt: '',
      inputTemplate: 'What is the SCPI command to ',
      corporaHint: ['scpi'],
    },
    {
      id: 'fix-errors',
      label: '🔧 Fix Issues',
      prompt: 'Fix all validation errors in the current flow',
      corporaHint: ['templates'],
    },
    {
      id: 'add-measurements',
      label: '📊 Add Measurements',
      prompt:
        'Add frequency and amplitude measurements on CH1 and save results to variables',
      corporaHint: ['scpi', 'templates'],
    },
    {
      id: 'explain-flow',
      label: '💬 Explain Flow',
      prompt: 'Explain what this flow does step by step',
    },
    {
      id: 'optimize-flow',
      label: '⚡ Optimize',
      prompt:
        'Review this flow for any improvements — missing error checks, OPC sync, or inefficient steps',
      corporaHint: ['templates', 'errors'],
    },
  ];

  // ── Context-aware swaps ──────────────────────────────────────────────────

  // Empty flow: replace "Fix Issues" (index 2) and "Add Measurements" (index 3)
  // with instrument-specific build starters.
  if (steps.length === 0) {
    base[2] = {
      id: 'build-scope',
      label: '🔭 Build Scope Flow',
      prompt:
        'Build a connect → measure → screenshot → disconnect flow for an MSO5/6 scope',
      corporaHint: ['templates'],
    };
    base[3] = {
      id: 'build-awg',
      label: '🌊 Build AWG Flow',
      prompt:
        'Build a connect → configure output → enable channel → disconnect flow for an AFG/AWG',
      corporaHint: ['templates'],
    };
  }

  // Screenshot step present: swap Optimize for screenshot verification.
  if (hasScreenshot) {
    const optimizeIdx = base.findIndex((a) => a.id === 'optimize-flow');
    if (optimizeIdx !== -1) {
      base[optimizeIdx] = {
        id: 'check-screenshot',
        label: '📷 Check Screenshot',
        prompt:
          'Verify the screenshot step is correct for this scope type (modern vs legacy)',
        corporaHint: ['scpi', 'templates'],
      };
    }
  }

  // tm_device_command steps: swap Optimize for tm_devices path verification.
  if (hasTmDevices) {
    const optimizeIdx = base.findIndex((a) => a.id === 'optimize-flow');
    if (optimizeIdx !== -1) {
      base[optimizeIdx] = {
        id: 'tm-path',
        label: '🔗 tm_devices Path',
        prompt:
          'Verify the tm_devices API path and method for the current flow',
        corporaHint: ['tmdevices'],
      };
    }
  }

  // Errors present: bubble "Fix Issues" to the front of the list.
  if (hasErrors) {
    const fixIdx = base.findIndex((a) => a.id === 'fix-errors');
    if (fixIdx > 0) {
      const [fixAction] = base.splice(fixIdx, 1);
      base.unshift(fixAction);
    }
  }

  return base.slice(0, 6);
}
