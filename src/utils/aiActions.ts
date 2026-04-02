export type AiActionType =
  | 'set_step_param'
  | 'insert_step_after'
  | 'remove_step'
  | 'add_error_check_after_step'
  | 'replace_sleep_with_opc_query'
  | 'move_step'
  | 'replace_step'
  | 'replace_flow';

export interface AiAction {
  id: string;
  action_type: AiActionType;
  target_step_id?: string;
  confidence?: 'low' | 'medium' | 'high';
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface AiActionParseResult {
  summary: string;
  findings: string[];
  suggestedFixes: string[];
  confidence: 'low' | 'medium' | 'high';
  actions: AiAction[];
}

export interface StepLike {
  id: string;
  type: string;
  label: string;
  params?: Record<string, unknown>;
  children?: StepLike[];
}

type ParsedRoot = Partial<AiActionParseResult> & {
  actions?: unknown[];
  result?: Record<string, unknown>;
};

const VALID_STEP_TYPES = new Set([
  'connect',
  'disconnect',
  'query',
  'write',
  'set_and_query',
  'sleep',
  'comment',
  'python',
  'save_waveform',
  'save_screenshot',
  'error_check',
  'group',
  'tm_device_command',
  'recall',
]);

const AUTO_GROUP_COMMAND_CAP = 4;

function canonicalStepType(input: unknown): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const aliasMap: Record<string, string> = {
    scpi_write: 'write',
    scpi_query: 'query',
    visa_write: 'write',
    visa_query: 'query',
    wait_seconds: 'sleep',
    wait: 'sleep',
    tm_devices_command: 'tm_device_command',
    tmdevices_command: 'tm_device_command',
    tm_command: 'tm_device_command',
  };
  const mapped = aliasMap[raw] || raw;
  return VALID_STEP_TYPES.has(mapped) ? mapped : '';
}

function safeRandomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeVariableName(value: string, fallback = 'result'): string {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/\b(query|read|get|value|result|results|currentacq|current)\b/g, ' ')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned || fallback;
  return /^\d/.test(base) ? `v_${base}` : base;
}

function normalizeExplicitVariableName(value: string, fallback = 'result'): string {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = cleaned || fallback;
  return /^\d/.test(base) ? `v_${base}` : base;
}

function deriveQueryVariableBase(step: StepLike, fallbackIndex: number): string {
  const params = (step.params || {}) as Record<string, unknown>;
  if (typeof params.saveAs === 'string' && params.saveAs.trim()) {
    return normalizeExplicitVariableName(params.saveAs, `result_${fallbackIndex}`);
  }
  if (typeof params.outputVariable === 'string' && params.outputVariable.trim()) {
    return normalizeExplicitVariableName(params.outputVariable, `result_${fallbackIndex}`);
  }
  const labelBase = sanitizeVariableName(String(step.label || ''), '');
  if (labelBase) return labelBase;
  const commandSource =
    (typeof params.command === 'string' && params.command) ||
    (typeof params.query === 'string' && params.query) ||
    '';
  const commandBase = sanitizeVariableName(
    commandSource
      .split('?')[0]
      .split(':')
      .slice(-2)
      .join('_'),
    ''
  );
  return commandBase || `result_${fallbackIndex}`;
}

function ensureUniqueQueryVariableNames(steps: StepLike[]): void {
  const used = new Set<string>();
  let queryIndex = 1;
  const walk = (items: StepLike[]) => {
    items.forEach((step) => {
      if (Array.isArray(step.children) && step.children.length) {
        walk(step.children);
      }
      if (canonicalStepType(step.type) !== 'query') return;
      const params = step.params && typeof step.params === 'object'
        ? ({ ...(step.params as Record<string, unknown>) } as Record<string, unknown>)
        : {};
      const base = deriveQueryVariableBase({ ...step, params }, queryIndex);
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      used.add(candidate.toLowerCase());
      queryIndex += 1;
      params.saveAs = candidate;
      delete params.outputVariable;
      step.params = params;
    });
  };
  walk(steps);
}

function parseJsonRecordString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sanitizeConfidence(value: unknown): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

function toTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        return (
          (typeof obj.issue === 'string' && obj.issue) ||
          (typeof obj.detail === 'string' && obj.detail) ||
          (typeof obj.note === 'string' && obj.note) ||
          (typeof obj.title === 'string' && obj.title) ||
          JSON.stringify(obj)
        );
      }
      return String(v);
    })
    .filter(Boolean);
}

function normalizeAction(raw: unknown, idx: number): AiAction[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : safeRandomId(`ai_norm_${idx}`);
  const explicitType = typeof r.action_type === 'string' ? r.action_type : typeof r.type === 'string' ? r.type : '';

  if (explicitType === 'set_step_param') {
    const targetStepId =
      typeof r.targetStepId === 'string'
        ? r.targetStepId
        : typeof r.stepId === 'string'
          ? r.stepId
          : typeof r.target_step_id === 'string'
            ? r.target_step_id
            : '';
    const payloadObj =
      r.payload && typeof r.payload === 'object'
        ? (r.payload as Record<string, unknown>)
        : {};
    const param =
      typeof r.param === 'string'
        ? r.param
        : typeof payloadObj.param === 'string'
          ? payloadObj.param
          : '';
    const hasValue = Object.prototype.hasOwnProperty.call(r, 'value') || Object.prototype.hasOwnProperty.call(payloadObj, 'value');
    const value = Object.prototype.hasOwnProperty.call(r, 'value') ? r.value : payloadObj.value;
    const reason = typeof r.note === 'string' ? r.note : typeof r.reason === 'string' ? r.reason : undefined;
    const confidence = sanitizeConfidence(r.confidence);
    if (!targetStepId || !param || !hasValue) return [];
    if (param === 'params') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      return Object.entries(value as Record<string, unknown>)
        .filter(([childParam]) => childParam !== 'params')
        .map(([childParam, childValue], childIdx) => ({
          id: `${id}_${childIdx + 1}`,
          action_type: 'set_step_param' as const,
          target_step_id: targetStepId,
          reason,
          confidence,
          payload: { param: childParam, value: childValue },
        }));
    }
    return [{
      id,
      action_type: 'set_step_param',
      target_step_id: targetStepId,
      reason,
      confidence,
      payload: { param, value },
    }];
  }

  if (explicitType === 'insert_step_after') {
    const targetStepId =
      typeof r.targetStepId === 'string'
        ? r.targetStepId
        : typeof r.stepId === 'string'
          ? r.stepId
          : typeof r.target_step_id === 'string'
            ? r.target_step_id
            : '';
    const payloadObj =
      r.payload && typeof r.payload === 'object'
        ? (r.payload as Record<string, unknown>)
        : {};
    const newStep =
      (r.newStep && typeof r.newStep === 'object' ? (r.newStep as Record<string, unknown>) : null) ||
      parseJsonRecordString(r.newStep) ||
      (payloadObj.newStep && typeof payloadObj.newStep === 'object'
        ? (payloadObj.newStep as Record<string, unknown>)
        : null) ||
      parseJsonRecordString(payloadObj.newStep) ||
      (payloadObj.new_step && typeof payloadObj.new_step === 'object'
        ? (payloadObj.new_step as Record<string, unknown>)
        : null) ||
      parseJsonRecordString(payloadObj.new_step);
    if (!newStep) return [];
    return [{
      id,
      action_type: 'insert_step_after',
      target_step_id: targetStepId || undefined,
      reason: typeof r.note === 'string' ? r.note : typeof r.reason === 'string' ? r.reason : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: {
        new_step: newStep,
        ...(payloadObj.allow_python === true || payloadObj.allowPython === true ? { allow_python: true } : {}),
      },
    }];
  }

  if (explicitType === 'remove_step') {
    const targetStepId =
      typeof r.targetStepId === 'string'
        ? r.targetStepId
        : typeof r.stepId === 'string'
          ? r.stepId
          : typeof r.target_step_id === 'string'
            ? r.target_step_id
            : '';
    if (!targetStepId) return [];
    return [{
      id,
      action_type: 'remove_step',
      target_step_id: targetStepId,
      reason: typeof r.note === 'string' ? r.note : typeof r.reason === 'string' ? r.reason : undefined,
      confidence: sanitizeConfidence(r.confidence),
    }];
  }

  if (explicitType === 'replace_step') {
    const stepId =
      typeof r.targetStepId === 'string'
        ? r.targetStepId
        : typeof r.stepId === 'string'
          ? r.stepId
          : typeof r.target_step_id === 'string'
            ? r.target_step_id
            : '';
    const payloadObj =
      r.payload && typeof r.payload === 'object'
        ? (r.payload as Record<string, unknown>)
        : {};
    const newStep =
      (r.newStep && typeof r.newStep === 'object' ? (r.newStep as Record<string, unknown>) : null) ||
      parseJsonRecordString(r.newStep) ||
      (payloadObj.newStep && typeof payloadObj.newStep === 'object'
        ? (payloadObj.newStep as Record<string, unknown>)
        : null) ||
      parseJsonRecordString(payloadObj.newStep) ||
      (payloadObj.new_step && typeof payloadObj.new_step === 'object'
        ? (payloadObj.new_step as Record<string, unknown>)
        : null) ||
      parseJsonRecordString(payloadObj.new_step);
    if (!stepId || !newStep) return [];
    return [{
      id,
      action_type: 'replace_step',
      target_step_id: stepId,
      reason: typeof r.note === 'string' ? r.note : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: {
        new_step: newStep,
        ...(payloadObj.allow_python === true || payloadObj.allowPython === true ? { allow_python: true } : {}),
      },
    }];
  }

  if (explicitType === 'move_step') {
    const stepId =
      typeof r.targetStepId === 'string'
        ? r.targetStepId
        : typeof r.stepId === 'string'
          ? r.stepId
          : typeof r.target_step_id === 'string'
            ? r.target_step_id
            : '';
    const targetGroupId =
      typeof r.targetGroupId === 'string' ? r.targetGroupId : typeof r.target_group_id === 'string' ? r.target_group_id : '';
    const payloadObj =
      r.payload && typeof r.payload === 'object'
        ? (r.payload as Record<string, unknown>)
        : {};
    const afterStepId =
      typeof r.afterStepId === 'string'
        ? r.afterStepId
        : typeof r.after_step_id === 'string'
          ? r.after_step_id
          : typeof payloadObj.afterStepId === 'string'
            ? payloadObj.afterStepId
            : typeof payloadObj.after_step_id === 'string'
              ? payloadObj.after_step_id
              : '';
    const position =
      typeof r.position === 'number'
        ? r.position
        : typeof payloadObj.position === 'number'
          ? payloadObj.position
          : undefined;
    if (!stepId || (!targetGroupId && !afterStepId && !Number.isFinite(position))) return [];
    return [{
      id,
      action_type: 'move_step',
      target_step_id: stepId,
      reason: typeof r.note === 'string' ? r.note : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: {
        ...(targetGroupId ? { target_group_id: targetGroupId } : {}),
        ...(afterStepId ? { after_step_id: afterStepId } : {}),
        ...(Number.isFinite(position) ? { position } : {}),
      },
    }];
  }

  if (explicitType === 'replace_flow') {
    const payloadObj =
      r.payload && typeof r.payload === 'object'
        ? (r.payload as Record<string, unknown>)
        : {};
    const flowObj =
      r.flow && typeof r.flow === 'object'
        ? (r.flow as Record<string, unknown>)
        : parseJsonRecordString(r.flow)
          ? (parseJsonRecordString(r.flow) as Record<string, unknown>)
        : null;
    const steps =
      Array.isArray(r.steps)
        ? (r.steps as unknown[])
        : Array.isArray(r.newSteps)
          ? (r.newSteps as unknown[])
        : Array.isArray(r.new_steps)
          ? (r.new_steps as unknown[])
        : Array.isArray(flowObj?.steps)
          ? (flowObj?.steps as unknown[])
        : Array.isArray(r.payload) // tolerate payload as direct array
          ? (r.payload as unknown[])
          : Array.isArray((r.payload as Record<string, unknown> | undefined)?.steps)
            ? ((r.payload as Record<string, unknown>).steps as unknown[])
            : Array.isArray(payloadObj.newSteps)
              ? (payloadObj.newSteps as unknown[])
            : Array.isArray(payloadObj.new_steps)
              ? (payloadObj.new_steps as unknown[])
            : [];
    if (!steps.length) return [];
    return [{
      id,
      action_type: 'replace_flow',
      reason: typeof r.note === 'string' ? r.note : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: { steps },
    }];
  }

  if (explicitType === 'note' || explicitType === 'recommendation' || explicitType === 'verify_or_edit_python') {
    return [];
  }

  const allowed: AiActionType[] = [
    'set_step_param',
    'insert_step_after',
    'remove_step',
    'add_error_check_after_step',
    'replace_sleep_with_opc_query',
    'move_step',
    'replace_step',
    'replace_flow',
  ];
  if (allowed.includes(explicitType as AiActionType)) {
    return [{
      id,
      action_type: explicitType as AiActionType,
      target_step_id: typeof r.target_step_id === 'string' ? r.target_step_id : undefined,
      reason: typeof r.reason === 'string' ? r.reason : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : undefined,
    }];
  }

  if (typeof r.action === 'string' && r.replacement && typeof r.replacement === 'object') {
    const replacement = r.replacement as Record<string, unknown>;
    const stepId = typeof r.stepId === 'string' ? r.stepId : '';
    if (!stepId) return [];
    return [{
      id,
      action_type: 'replace_step',
      target_step_id: stepId,
      reason: typeof r.note === 'string' ? r.note : undefined,
      confidence: sanitizeConfidence(r.confidence),
      payload: { new_step: replacement },
    }];
  }

  // Legacy assistant schema compatibility:
  // { "action": "save_waveforms", "parameters": { ... } }
  if (typeof r.action === 'string') {
    const legacyAction = String(r.action || '').trim().toLowerCase();
    const params =
      r.parameters && typeof r.parameters === 'object' && !Array.isArray(r.parameters)
        ? (r.parameters as Record<string, unknown>)
        : {};

    const mkInsert = (newStep: Record<string, unknown>, suffix: string): AiAction => ({
      id: `${id}_${suffix}`,
      action_type: 'insert_step_after',
      reason: typeof r.note === 'string' ? r.note : `Translated legacy action: ${legacyAction}`,
      confidence: sanitizeConfidence(r.confidence),
      payload: { new_step: newStep },
    });

    if (legacyAction === 'save_waveforms' || legacyAction === 'save_waveform') {
      const formatRaw = String(params.format || 'wfm').trim().toLowerCase();
      const format = (['wfm', 'bin', 'csv'].includes(formatRaw) ? formatRaw : 'wfm') as 'wfm' | 'bin' | 'csv';
      const allChannels = params.all_channels === true || params.allChannels === true;
      const channels = allChannels ? ['CH1', 'CH2', 'CH3', 'CH4'] : [String(params.source || 'CH1').toUpperCase()];
      const children = channels.map((ch, chIdx) => ({
        id: safeRandomId(`legacy_save_${chIdx + 1}`),
        type: 'save_waveform',
        label: `Save ${ch} waveform`,
        params: {
          source: ch,
          filename: `${ch.toLowerCase()}.${format}`,
          format,
        },
      }));
      return [
        mkInsert({
          id: safeRandomId('legacy_group'),
          type: 'group',
          label: allChannels ? 'Save Waveforms' : 'Save Waveform',
          params: {},
          collapsed: false,
          children,
        }, 'save_waveforms'),
      ];
    }

    if (legacyAction === 'save_setup') {
      return [
        mkInsert({
          id: safeRandomId('legacy_setup'),
          type: 'write',
          label: 'Save setup',
          params: {
            command: 'SAVe:SETUp "setup.set"',
          },
        }, 'save_setup'),
      ];
    }

    if (legacyAction === 'save_screenshot') {
      const ext = String(params.format || '.png').replace(/^\.+/, '').toLowerCase() || 'png';
      return [
        mkInsert({
          id: safeRandomId('legacy_screen'),
          type: 'save_screenshot',
          label: 'Save screenshot',
          params: {
            filename: `screenshot.${ext}`,
            scopeType: 'modern',
            method: 'pc_transfer',
          },
        }, 'save_screenshot'),
      ];
    }

    if (legacyAction === 'zip_files' || legacyAction === 'zip_folder' || legacyAction === 'rename_file') {
      const archive = String(params.archive || 'archive.zip');
      const renameTo = String(params.rename_to || params.renameTo || '').trim();
      const code =
        "import os\n" +
        "import zipfile\n\n" +
        `archive = ${JSON.stringify(archive)}\n` +
        "files = [f for f in os.listdir('.') if os.path.isfile(f)]\n" +
        "with zipfile.ZipFile(archive, 'w') as z:\n" +
        "    for f in files:\n" +
        "        z.write(f)\n" +
        (renameTo ? `os.rename(archive, ${JSON.stringify(renameTo)})\n` : '');
      return [
        mkInsert({
          id: safeRandomId('legacy_zip'),
          type: 'python',
          allow_python: true,
          label: renameTo ? 'Zip and rename files' : 'Zip files',
          params: { code },
        }, 'zip'),
      ];
    }
  }
  return [];
}

export function normalizeAiActions(rawActions: unknown[]): AiAction[] {
  if (!Array.isArray(rawActions)) return [];
  return rawActions.flatMap((action, index) => normalizeAction(action, index));
}

export function parseAiActionResponse(text: string): AiActionParseResult | null {
  try {
    const parsed = JSON.parse(text) as ParsedRoot;
    if (!parsed || typeof parsed !== 'object') return null;
    const parsedAsFlow = parsed as Record<string, unknown>;
    if (Array.isArray(parsedAsFlow.steps)) {
      return {
        summary:
          typeof parsedAsFlow.description === 'string' && parsedAsFlow.description
            ? parsedAsFlow.description
            : typeof parsedAsFlow.name === 'string' && parsedAsFlow.name
              ? `Parsed flow: ${parsedAsFlow.name}`
              : 'Parsed full flow JSON from assistant output.',
        findings: [],
        suggestedFixes: [],
        confidence: 'medium',
        actions: [{
          id: safeRandomId('ai_flow'),
          action_type: 'replace_flow',
          confidence: 'medium',
          payload: { steps: parsedAsFlow.steps as unknown[] },
        }],
      };
    }
    const sourceActions = Array.isArray(parsed.actions)
      ? parsed.actions
      : Array.isArray(parsed.result?.actions)
        ? (parsed.result?.actions as unknown[])
        : [];
    const actions = normalizeAiActions(sourceActions);
    if (actions.length === 0 && typeof parsed.summary !== 'string') return null;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Proposed actionable fixes.',
      findings: toTextList(parsed.findings),
      suggestedFixes: toTextList(parsed.suggestedFixes),
      confidence: sanitizeConfidence(parsed.confidence),
      actions,
    };
  } catch {
    return null;
  }
}

export function canMaterializeAiAction(action: AiAction): boolean {
  if (!action || !action.action_type) return false;
  if (action.action_type !== 'replace_flow') return true;
  return applyAiActionsToSteps<StepLike>([], [action]).length > 0;
}

export function applyAiActionsToSteps<T extends StepLike>(steps: T[], actions: AiAction[]): T[] {
  const cloneStep = (s: StepLike): StepLike => ({
    ...s,
    params: s.params ? { ...s.params } : {},
    children: s.children ? s.children.map(cloneStep) : undefined,
  });
  let current = steps.map((s) => cloneStep(s)) as T[];
  const assignedIds = new Set<string>();
  const insertedIdMap = new Map<string, string>();

  const rebuildAssignedIds = () => {
    assignedIds.clear();
    const walk = (items: StepLike[]) => {
      items.forEach((item) => {
        const stepId = String(item.id || '').trim();
        if (stepId) assignedIds.add(stepId);
        if (Array.isArray(item.children) && item.children.length) {
          walk(item.children);
        }
      });
    };
    walk(current as StepLike[]);
  };

  const reserveInsertedIds = (step: StepLike): StepLike => {
    const desiredId = String(step.id || '').trim();
    let actualId = desiredId;
    if (!actualId || assignedIds.has(actualId)) {
      actualId = safeRandomId('ai_step');
    }
    if (desiredId) {
      insertedIdMap.set(desiredId, actualId);
    }
    assignedIds.add(actualId);
    return {
      ...step,
      id: actualId,
      children: Array.isArray(step.children)
        ? step.children.map((child) => reserveInsertedIds(child))
        : step.children,
    };
  };

  const reserveNestedChildIds = (children: StepLike[] | undefined): StepLike[] | undefined => {
    if (!Array.isArray(children)) return children;
    return children.map((child) => reserveInsertedIds(child));
  };

  const resolveTargetId = (target: string): string => insertedIdMap.get(target) || target;

  rebuildAssignedIds();

  const normalizeTopLevelConnectDisconnect = () => {
    if (!Array.isArray(current) || current.length === 0) return;
    const connectIndexes: number[] = [];
    const disconnectIndexes: number[] = [];
    current.forEach((s, idx) => {
      const t = String((s as StepLike).type || '').toLowerCase();
      if (t === 'connect') connectIndexes.push(idx);
      if (t === 'disconnect') disconnectIndexes.push(idx);
    });
    if (connectIndexes.length <= 1 && disconnectIndexes.length <= 1) return;

    const keepConnect = connectIndexes.length ? connectIndexes[0] : -1;
    const keepDisconnect = disconnectIndexes.length ? disconnectIndexes[disconnectIndexes.length - 1] : -1;
    current = current.filter((_, idx) => {
      if (connectIndexes.includes(idx) && idx !== keepConnect) return false;
      if (disconnectIndexes.includes(idx) && idx !== keepDisconnect) return false;
      return true;
    }) as T[];
  };

  const ensureBaselineConnectDisconnect = () => {
    if (current.length > 0) return;
    current = [
      {
        id: safeRandomId('ai_connect'),
        type: 'connect',
        label: 'Connect',
        params: {},
      },
      {
        id: safeRandomId('ai_disconnect'),
        type: 'disconnect',
        label: 'Disconnect',
        params: {},
      },
    ] as T[];
    rebuildAssignedIds();
  };

  const ensureFlowHasTopLevelConnectDisconnect = () => {
    if (!current.length) return;
    const hasConnect = current.some((s) => String((s as StepLike).type || '').toLowerCase() === 'connect');
    const hasDisconnect = current.some((s) => String((s as StepLike).type || '').toLowerCase() === 'disconnect');
    if (!hasConnect) {
      current.unshift({
        id: safeRandomId('ai_connect'),
        type: 'connect',
        label: 'Connect',
        params: {},
      } as T);
    }
    if (!hasDisconnect) {
      current.push({
        id: safeRandomId('ai_disconnect'),
        type: 'disconnect',
        label: 'Disconnect',
        params: {},
      } as T);
    }
    rebuildAssignedIds();
  };

  const insertNearEnd = (step: StepLike) => {
    const disconnectIdx = current.findIndex((s) => String((s as StepLike).type || '').toLowerCase() === 'disconnect');
    if (disconnectIdx >= 0) {
      current.splice(disconnectIdx, 0, step as T);
    } else {
      current.push(step as T);
    }
  };

  const removeStepById = (arr: StepLike[], stepId: string): StepLike | null => {
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].id === stepId) {
        const [removed] = arr.splice(i, 1);
        return removed;
      }
      if (arr[i].children?.length) {
        const removed = removeStepById(arr[i].children!, stepId);
        if (removed) return removed;
      }
    }
    return null;
  };

  const findStepById = (arr: StepLike[], stepId: string): StepLike | null => {
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].id === stepId) return arr[i];
      if (arr[i].children?.length) {
        const found = findStepById(arr[i].children!, stepId);
        if (found) return found;
      }
    }
    return null;
  };

  const findStepLocation = (
    arr: StepLike[],
    stepId: string
  ): { array: StepLike[]; index: number } | null => {
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].id === stepId) return { array: arr, index: i };
      if (arr[i].children?.length) {
        const found = findStepLocation(arr[i].children!, stepId);
        if (found) return found;
      }
    }
    return null;
  };

  const findAndMutate = (
    arr: StepLike[],
    fn: (arrRef: StepLike[], idx: number) => boolean
  ): boolean => {
    for (let i = 0; i < arr.length; i++) {
      if (fn(arr, i)) return true;
      if (arr[i].children?.length) {
        const ok = findAndMutate(arr[i].children!, fn);
        if (ok) return true;
      }
    }
    return false;
  };

  const normalizeStepCandidate = (
    candidate: unknown,
    fallbackType: string,
    idx = 0
  ): StepLike | null => {
    if (!candidate || typeof candidate !== 'object') return null;
    const c = candidate as Record<string, unknown>;
    const nextType = canonicalStepType(c.type || fallbackType);
    if (!nextType) return null;
    if (nextType === 'python' && c.allow_python !== true && c.allowPython !== true) {
      return null;
    }
    const params =
      c.params && typeof c.params === 'object'
        ? ({ ...(c.params as Record<string, unknown>) } as Record<string, unknown>)
        : {};

    if (nextType === 'write') {
      const cmd =
        (typeof params.command === 'string' && params.command) ||
        (typeof c.command === 'string' && c.command) ||
        '';
      if (!cmd) return null;
      params.command = cmd;
    }
    if (nextType === 'query') {
      const cmd =
        (typeof params.command === 'string' && params.command) ||
        (typeof params.query === 'string' && params.query) ||
        (typeof c.command === 'string' && c.command) ||
        (typeof c.query === 'string' && c.query) ||
        '';
      if (!cmd) return null;
      const saveAs =
        (typeof params.saveAs === 'string' && params.saveAs) ||
        (typeof params.outputVariable === 'string' && params.outputVariable) ||
        'result';
      params.command = cmd;
      params.saveAs = saveAs;
      delete params.query;
      delete params.outputVariable;
    }
    if (nextType === 'tm_device_command') {
      const codeFromParams = typeof params.code === 'string' ? params.code : '';
      const codeFromCommand = typeof c.command === 'string' ? c.command : '';
      const seq = Array.isArray(c.command_sequence)
        ? (c.command_sequence as unknown[]).map((s) => String(s)).join('\n')
        : '';
      const code = codeFromParams || codeFromCommand || seq;
      if (!code) return null;
      params.code = code;
      delete params.command;
    }

    const children = Array.isArray(c.children)
      ? (c.children as unknown[])
          .map((child, childIdx) => normalizeStepCandidate(child, 'comment', childIdx))
          .filter((x): x is StepLike => Boolean(x))
      : undefined;

    return {
      id: String(c.id || safeRandomId(`ai_step_${idx}`)),
      type: nextType,
      label: String(c.label || nextType),
      params,
      children,
    };
  };

  const maybeAutoGroupCompoundCommandStep = (step: StepLike): StepLike => {
    const withChildren: StepLike = step.children?.length
      ? { ...step, children: step.children.map((child) => maybeAutoGroupCompoundCommandStep(child)) }
      : step;
    if (withChildren.type !== 'write' && withChildren.type !== 'query' && withChildren.type !== 'set_and_query') {
      return withChildren;
    }
    const command = String(withChildren.params?.command || '');
    const parts = command
      .split(';')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length <= AUTO_GROUP_COMMAND_CAP) return withChildren;
    const baseLabel = (withChildren.label || 'Command').replace(/\s+\(\d+\/\d+\)$/, '');
    return {
      id: safeRandomId('ai_group'),
      type: 'group',
      label: baseLabel,
      params: {},
      children: parts.map((cmd, idx) => ({
        ...withChildren,
        id: idx === 0 ? withChildren.id : safeRandomId('ai_step'),
        label: baseLabel,
        params: { ...(withChildren.params || {}), command: cmd },
        children: undefined,
      })),
    };
  };

  for (const action of actions) {
    if (!action || !action.action_type) continue;
    switch (action.action_type) {
      case 'set_step_param': {
        const target = String(action.target_step_id || '');
        const param = String(action.payload?.param || '');
        if (!target || !param) break;
        findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          const value = action.payload?.value;
          arrRef[idx] = {
            ...arrRef[idx],
            params: { ...(arrRef[idx].params || {}), [param]: value },
          };
          return true;
        });
        break;
      }
      case 'insert_step_after': {
        let candidate: Record<string, unknown> | undefined =
          action.payload?.new_step && typeof action.payload.new_step === 'object'
            ? (action.payload.new_step as Record<string, unknown>)
            : action.payload?.newStep && typeof action.payload.newStep === 'object'
              ? (action.payload.newStep as Record<string, unknown>)
              : (action.payload as Record<string, unknown> | undefined);
        const normalizedStep = normalizeStepCandidate(candidate, 'comment');
        if (!normalizedStep) break;
        ensureBaselineConnectDisconnect();
        const groupedStep = reserveInsertedIds(maybeAutoGroupCompoundCommandStep(normalizedStep));
        const target = resolveTargetId(String(action.target_step_id || ''));
        if (!target) {
          insertNearEnd(groupedStep);
          break;
        }
        const inserted = findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          arrRef.splice(idx + 1, 0, groupedStep);
          return true;
        });
        if (!inserted) {
          insertNearEnd(groupedStep);
        }
        break;
      }
      case 'remove_step': {
        const target = String(action.target_step_id || '');
        if (!target) break;
        findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          arrRef.splice(idx, 1);
          return true;
        });
        break;
      }
      case 'add_error_check_after_step': {
        const target = String(action.target_step_id || '');
        if (!target) break;
        findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          const newStep: StepLike = {
            id: safeRandomId('ai_err'),
            type: 'error_check',
            label: 'Error check',
            params: {},
          };
          arrRef.splice(idx + 1, 0, newStep);
          return true;
        });
        break;
      }
      case 'replace_sleep_with_opc_query': {
        const target = String(action.target_step_id || '');
        if (!target) break;
        findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          if (arrRef[idx].type !== 'sleep') return false;
          arrRef[idx] = {
            ...arrRef[idx],
            type: 'query',
            label: 'Wait for OPC',
            params: { command: '*OPC?', saveAs: String(action.payload?.saveAs || 'opc_status') },
          };
          return true;
        });
        break;
      }
      case 'move_step': {
        const target = String(action.target_step_id || '');
        const targetGroupId = String(action.payload?.target_group_id || '');
        const afterStepId = String(action.payload?.after_step_id || action.payload?.afterStepId || '');
        const positionValue = action.payload?.position;
        const hasPosition = typeof positionValue === 'number' && Number.isFinite(positionValue);
        if (!target) break;
        const sourceLocation = findStepLocation(current, target);
        if (!sourceLocation) break;
        const removed = removeStepById(current, target);
        if (!removed) break;
        if (targetGroupId) {
          const targetGroup = findStepById(current, targetGroupId);
          if (!targetGroup) {
            current.push(removed as T);
            break;
          }
          if (!Array.isArray(targetGroup.children)) targetGroup.children = [];
          const pos = Number(positionValue);
          const insertAt = Number.isFinite(pos) ? Math.max(0, Math.min(targetGroup.children.length, Math.floor(pos))) : targetGroup.children.length;
          targetGroup.children.splice(insertAt, 0, removed);
          break;
        }
        const destinationArray = sourceLocation.array;
        if (afterStepId) {
          const afterTarget = resolveTargetId(afterStepId);
          const afterLocation = findStepLocation(current, afterTarget);
          if (afterLocation) {
            const insertAt = afterLocation.array === destinationArray
              ? afterLocation.index + 1
              : destinationArray.length;
            destinationArray.splice(Math.max(0, Math.min(destinationArray.length, insertAt)), 0, removed);
            break;
          }
        }
        if (hasPosition) {
          const insertAt = Math.max(0, Math.min(destinationArray.length, Math.floor(Number(positionValue))));
          destinationArray.splice(insertAt, 0, removed);
          break;
        }
        destinationArray.push(removed);
        break;
      }
      case 'replace_step': {
        const target = String(action.target_step_id || '');
        const newStep = action.payload?.new_step && typeof action.payload.new_step === 'object'
          ? (action.payload.new_step as Record<string, unknown>)
          : null;
        if (!target || !newStep) break;
        findAndMutate(current, (arrRef, idx) => {
          if (arrRef[idx].id !== target) return false;
          const nextType = canonicalStepType(newStep.type || arrRef[idx].type);
          if (!nextType) return false;
          const allowPython =
            action.payload?.allow_python === true || action.payload?.allowPython === true;
          if (nextType === 'python' && arrRef[idx].type !== 'python' && !allowPython) {
            // Prevent accidental conversion of structured steps into raw python unless explicitly allowed.
            return false;
          }
          if (nextType !== 'python' && arrRef[idx].type === 'python' && !allowPython) {
            // Prevent accidental replacement of existing python snippets unless explicitly allowed.
            return false;
          }
          const normalizedReplacement = normalizeStepCandidate(
            { ...newStep, type: nextType, id: target },
            arrRef[idx].type,
          );
          if (!normalizedReplacement) return false;
          const nextParamsBase =
            normalizedReplacement.params && typeof normalizedReplacement.params === 'object'
              ? (normalizedReplacement.params as Record<string, unknown>)
              : {};
          let nextParams: Record<string, unknown> = { ...(arrRef[idx].params || {}), ...nextParamsBase };
          if (nextType === 'write') {
            const cmd = (typeof nextParams.command === 'string' && nextParams.command)
              || (typeof normalizedReplacement.params?.command === 'string' && normalizedReplacement.params.command)
              || (typeof newStep.command === 'string' && newStep.command)
              || (typeof newStep.scpi === 'string' && newStep.scpi)
              || (typeof nextParams.scpi === 'string' && String(nextParams.scpi))
              || '';
            if (!cmd) return false;
            nextParams = { ...nextParams, command: cmd };
          }
          if (nextType === 'query') {
            const cmd = (typeof nextParams.command === 'string' && nextParams.command)
              || (typeof nextParams.query === 'string' && nextParams.query)
              || (typeof newStep.command === 'string' && newStep.command)
              || (typeof newStep.query === 'string' && newStep.query)
              || '';
            const saveAs = (typeof nextParams.saveAs === 'string' && nextParams.saveAs)
              || (typeof nextParams.outputVariable === 'string' && nextParams.outputVariable)
              || 'result';
            if (!cmd) return false;
            nextParams = { ...nextParams, command: cmd, saveAs };
            delete nextParams.query;
            delete nextParams.outputVariable;
          }
          if (nextType === 'tm_device_command') {
            const codeFromParams = typeof nextParams.code === 'string' ? nextParams.code : '';
            const codeFromCommand = typeof newStep.command === 'string' ? newStep.command : '';
            const seq = Array.isArray(newStep.command_sequence)
              ? (newStep.command_sequence as unknown[]).map((s) => String(s)).join('\n')
              : '';
            const code = codeFromParams || codeFromCommand || seq;
            if (!code) return false;
            nextParams = { ...nextParams, code };
            if (typeof nextParams.command !== 'undefined') delete nextParams.command;
          }
          arrRef[idx] = {
            id: target,
            type: nextType,
            label: String(normalizedReplacement.label || arrRef[idx].label),
            params: nextParams,
            children: Array.isArray(normalizedReplacement.children)
              ? reserveNestedChildIds(normalizedReplacement.children)
              : arrRef[idx].children,
          };
          return true;
        });
        break;
      }
      case 'replace_flow': {
        const rawSteps = Array.isArray(action.payload?.steps)
          ? (action.payload?.steps as unknown[])
          : [];
        if (!rawSteps.length) break;
        const normalized = rawSteps
          .map((s, i) => normalizeStepCandidate(s, 'comment', i))
          .filter((s): s is StepLike => Boolean(s));
        if (!normalized.length) break;
        current = normalized.map((s) => maybeAutoGroupCompoundCommandStep(s)) as T[];
        insertedIdMap.clear();
        ensureFlowHasTopLevelConnectDisconnect();
        break;
      }
      default:
        break;
    }
  }
  normalizeTopLevelConnectDisconnect();
  ensureUniqueQueryVariableNames(current as StepLike[]);
  return current;
}
