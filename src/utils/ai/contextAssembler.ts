import type { StepPreview } from '../../components/ExecutePage/StepsListPreview';
import type { AssembledContext, ChatTurn, RagChunk, RagCorpus } from './types';

const MAX_TOTAL_TOKENS = 6500;
const TOKEN_BUDGET = {
  system: 1200,
  flow: 1500,
  retrieved: 2000,
  history: 2000,
  user: 200,
};

const HARD_CONSTRAINTS = [
  'tm_devices backend forbids raw write/query/scpi_write/scpi_query/save_screenshot/save_waveform step types; use tm_device_command.',
  'Socket connection is not supported for tm_devices backend; use TCP/IP.',
  'Hybrid is a multi-backend mode, not a standalone fifth backend.',
  'TekHSI is a Python gRPC API surface, not "SCPI over TekHSI".',
  'TekHSI should be used for waveform capture workflows, not generic SCPI measurement flows.',
  'For TekscopePC in PyVISA contexts, prefer *RST instead of scope.reset().',
  'Blockly controls_for blocks must preserve mutation/variable XML.',
  'TekExpress synchronization should use TEKEXP:STATE? style checks; avoid *OPC? assumptions.',
];

const BUILDER_POLICY = [
  'Output flow changes as AiAction entries; do not output Python snippets unless explicitly requested.',
  'Never replace or insert structured steps as type=python unless explicitly requested.',
  'Before using SCPI commands, verify them against retrieved source-of-truth context; do not infer missing commands.',
  'Build what you can verify and skip what you cannot verify.',
  'If some commands are verified and some are not, still produce ACTIONS_JSON for verified commands.',
  'For unverified commands, add comment-step placeholders with clear manual instructions and list the gaps in findings.',
  'Never skip the entire flow because of partial verification.',
  'If a command cannot be verified, explicitly say: "I could not verify this command in the uploaded sources."',
  'If the user explicitly confirms an unverified-but-plausible command choice, proceed with the flow change and mark it as a user-confirmed assumption instead of asking again.',
  'When the user provides the missing channel or confirms a prior clarifying question, do not repeat the clarification; continue and generate the requested actions.',
  'If the user asks to save a screenshot also, add a save_screenshot step in the requested location without asking again once filename/placement are inferable from context.',
  'Treat authoritative flow context and instrument map as locked-down truth. Route command style from backend first, not from guesswork.',
  'If backend is pyvisa, vxi11, or tekhsi, prefer SCPI-oriented steps unless the user explicitly asks to convert.',
  'If backend is tm_devices, prefer tm_device_command steps unless the user explicitly asks to convert.',
  'If the user asks to convert SCPI to tm_devices or tm_devices to SCPI, preserve behavior and change only the command representation.',
  'Prefer one SCPI command per write/query step; avoid semicolon-chained multi-command strings unless the user explicitly asks for a single combined step.',
  'Hard cap semicolon concatenation at 4 commands per step; split and group when more are needed.',
  'Prefer grouped flow design for readability; for multi-phase flows, organize steps into groups (setup/config/trigger/measure/save/cleanup) unless user explicitly requests a flat list.',
  'For measurement-building flows, prefer two groups: "Add Measurements" (ADDMEAS + SOURCE writes) and "Read Results" (measurement result queries with saveAs).',
  'Query steps must include saveAs.',
  'Workflow baseline: connect first, disconnect last.',
  'Group steps must include params:{} and children:[].',
  'File types: .tss full session, .set settings-only, .wfm waveform data.',
  'save_screenshot scopeType: modern for MSO5/6, legacy for 5k/7k/70k.',
  'Steps UI uses JSON, Blockly uses XML; do not emit large raw JSON/XML walls in chat body.',
  'RAG retrieved context is the runtime source of truth for commands and schemas.',
  'Valid TekAutomate step types: connect, disconnect, query, write, set_and_query, sleep, comment, python, save_waveform, save_screenshot, error_check, group, tm_device_command, recall.',
];

const RESPONSE_FORMAT_RULES = [
  'Max 2 short sentences, then action cards.',
  'Never output raw JSON as the main chat body.',
  'Never output Python code unless explicitly requested.',
  'Ask ONE clarifying question only when required parameters are missing.',
  'Do not ask for backend/model/instrument if inferable from live flow context.',
  'Be evidence-based; only flag issues proven by flow/logs/generated code/retrieved docs.',
  'If flow is valid, say "Flow looks good." and return actions:[].',
  'If execution logs or audit show success, do not call the flow invalid for backend/style/internal-param mismatches alone.',
  'Only call something a blocker if it would actually prevent build, apply, or execution.',
];

const ACTION_OUTPUT_RULES = [
  'insert_step_after -> { targetStepId, newStep:{ type,label,params } }',
  'set_step_param -> { targetStepId, param, value }',
  'remove_step -> { targetStepId }',
  'move_step -> either { targetStepId, targetGroupId, position } to move into a group, or { targetStepId, afterStepId } / { targetStepId, position } to reorder at the same level.',
  'replace_flow -> { steps:[...] } (only when user asks to rebuild from scratch)',
  'add_error_check_after_step -> { targetStepId }',
];

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (approxTokens(text) <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function formatRetrievedChunks(chunksByCorpus: Partial<Record<RagCorpus, RagChunk[]>>): string {
  const sections: string[] = [];
  (Object.keys(chunksByCorpus) as RagCorpus[]).forEach((corpus) => {
    const chunks = chunksByCorpus[corpus] || [];
    if (!chunks.length) return;
    const block = chunks
      .map((c) => {
        const head = `[${c.id}] ${c.title}`;
        const meta = [c.source, c.pathHint].filter(Boolean).join(' | ');
        return `${head}${meta ? `\n${meta}` : ''}\n${c.body}`;
      })
      .join('\n\n');
    sections.push(`## ${corpus}\n${block}`);
  });
  return sections.join('\n\n');
}

function isApplyIntent(message: string): boolean {
  return /(apply|fix|change|update|patch|rewrite|replace|move|reorder|convert)/i.test(message);
}

function isBuildIntent(message: string): boolean {
  return /(build|create|generate|compose|setup|configure|capture|measurement|measurements|steps|blockly|json|xml|flow)/i.test(
    message
  );
}

function isValidateIntent(message: string): boolean {
  return /(validate|does this look right|does this look good|looks right|review|check flow|is this right)/i.test(message);
}

function isCommandLookupIntent(message: string): boolean {
  return /(fastframe|scpi|syntax|command|query command|set command|what('?s| is)\s+the\s+command|how do i .*command)/i.test(
    message
  );
}

function collectFlowFacts(steps: StepPreview[]): {
  stepTypes: string[];
  hasTmDevicesStep: boolean;
  hasSaveScreenshotStep: boolean;
  isSimpleScreenshotFlow: boolean;
} {
  const flat: StepPreview[] = [];
  const walk = (items: StepPreview[]) => {
    items.forEach((s) => {
      flat.push(s);
      if (Array.isArray(s.children) && s.children.length) walk(s.children);
    });
  };
  walk(steps);
  const stepTypes = Array.from(
    new Set(flat.map((s) => String(s.type || '').toLowerCase()).filter(Boolean))
  );
  const hasTmDevicesStep = stepTypes.includes('tm_device_command');
  const hasSaveScreenshotStep = stepTypes.includes('save_screenshot');
  const topLevelTypes = steps.map((s) => String(s.type || '').toLowerCase());
  const isSimpleScreenshotFlow =
    steps.length === 3 &&
    topLevelTypes[0] === 'connect' &&
    topLevelTypes[1] === 'save_screenshot' &&
    topLevelTypes[2] === 'disconnect';
  return { stepTypes, hasTmDevicesStep, hasSaveScreenshotStep, isSimpleScreenshotFlow };
}

function inferExecutionContext(steps: StepPreview[]): {
  inferredBackend: string;
  inferredModel: string;
  inferredConnection: string;
  inferredHost: string;
} {
  const flat: StepPreview[] = [];
  const walk = (items: StepPreview[]) => {
    items.forEach((s) => {
      flat.push(s);
      if (Array.isArray(s.children) && s.children.length) walk(s.children);
    });
  };
  walk(steps);
  const connect = flat.find((s) => s.type === 'connect');
  const p = (connect?.params || {}) as Record<string, unknown>;
  const inferredBackend =
    (typeof p.backend === 'string' && p.backend) ||
    (typeof p.protocol === 'string' && p.protocol) ||
    '';
  const inferredModel =
    (typeof p.modelFamily === 'string' && p.modelFamily) ||
    (typeof p.deviceDriver === 'string' && p.deviceDriver) ||
    '';
  const inferredConnection =
    (typeof p.connectionType === 'string' && p.connectionType) ||
    (typeof p.connection === 'string' && p.connection) ||
    '';
  const inferredHost =
    (typeof p.host === 'string' && p.host) ||
    (typeof p.hostIP === 'string' && p.hostIP) ||
    '';
  return {
    inferredBackend: inferredBackend || '(unknown)',
    inferredModel: inferredModel || '(unknown)',
    inferredConnection: inferredConnection || '(unknown)',
    inferredHost: inferredHost || '(unknown)',
  };
}

export function compressStep(step: StepPreview): Record<string, unknown> {
  const params = (step.params || {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: step.id,
    type: step.type,
    label: step.label,
  };
  if (typeof params.command === 'string') out.command = params.command;
  if (typeof params.outputVariable === 'string') out.outputVariable = params.outputVariable;
  if (typeof params.saveAs === 'string') out.outputVariable = params.saveAs;
  if (typeof params.backend === 'string') out.backend = params.backend;
  return out;
}

export function assembleAiContext(input: {
  userMessage: string;
  steps: StepPreview[];
  executionSource: 'steps' | 'blockly';
  runStatus: 'idle' | 'connecting' | 'running' | 'done' | 'error';
  runLog: string;
  code: string;
  flowContext?: {
    backend?: string;
    modelFamily?: string;
    connectionType?: string;
    host?: string;
    deviceType?: string;
    deviceDriver?: string;
    visaBackend?: string;
    alias?: string;
    instrumentMap?: Array<{
      alias: string;
      backend: string;
      host?: string;
      connectionType?: string;
      deviceType?: string;
      deviceDriver?: string;
      visaBackend?: string;
    }>;
  };
  history: ChatTurn[];
  retrievedChunksByCorpus: Partial<Record<RagCorpus, RagChunk[]>>;
}): AssembledContext {
  const facts = collectFlowFacts(input.steps);
  const inferred = inferExecutionContext(input.steps);
  const authoritative = {
    backend: input.flowContext?.backend || inferred.inferredBackend,
    model: input.flowContext?.modelFamily || inferred.inferredModel,
    connection: input.flowContext?.connectionType || inferred.inferredConnection,
    host: input.flowContext?.host || inferred.inferredHost,
    deviceType: input.flowContext?.deviceType || '(unknown)',
    deviceDriver: input.flowContext?.deviceDriver || '(unknown)',
    visaBackend: input.flowContext?.visaBackend || '(unknown)',
    alias: input.flowContext?.alias || 'scope1',
  };
  const instrumentMapText = (input.flowContext?.instrumentMap || [])
    .map((device) =>
      `- ${device.alias}: ${device.deviceType || 'SCOPE'}, ${device.backend}${device.deviceDriver ? `, driver ${device.deviceDriver}` : ''}${device.visaBackend ? `, visa ${device.visaBackend}` : ''}${device.host ? ` @ ${device.host}` : ''}`
    )
    .join('\n');
  const activeConstraints = [
    authoritative.backend === 'tm_devices' || facts.hasTmDevicesStep ? HARD_CONSTRAINTS[0] : '',
    authoritative.backend === 'tm_devices' || facts.hasTmDevicesStep ? HARD_CONSTRAINTS[1] : '',
    HARD_CONSTRAINTS[2],
    HARD_CONSTRAINTS[3],
    HARD_CONSTRAINTS[4],
  ].filter(Boolean);

  const compressedFlow = trimToTokenBudget(
    JSON.stringify(input.steps, null, 2),
    TOKEN_BUDGET.flow
  );
  const historyText = trimToTokenBudget(
    input.history
      .slice(-12)
      .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
      .join('\n\n'),
    TOKEN_BUDGET.history
  );
  const retrievedText = trimToTokenBudget(
    formatRetrievedChunks(input.retrievedChunksByCorpus),
    TOKEN_BUDGET.retrieved
  );
  const runLog = trimToTokenBudget(input.runLog || '', 900);
  const codeSnippet = trimToTokenBudget(input.code || '', 1200);
  const userText = trimToTokenBudget(input.userMessage, TOKEN_BUDGET.user);

  const systemPrompt = trimToTokenBudget(
    [
      '## Role',
      'You are TekAutomate Flow Builder: a conversational assistant that builds, edits, and validates automation flows.',
      'PRIMARY job: add/edit/validate Steps and Blockly via AiAction actions. Not analysis essays. Not Python rewrites.',
      '',
      '## Response Format - STRICT',
      ...RESPONSE_FORMAT_RULES.map((r) => `- ${r}`),
      '',
      '## Builder Policy',
      ...BUILDER_POLICY.map((r) => `- ${r}`),
      '',
      '## Mode Rules',
      '- Build mode: ask one required clarifier if needed, then generate actions.',
      '- Edit mode: targeted changes only, use existing step IDs.',
      '- Validate mode: max 3 bullets, real blockers only.',
      '',
      '## Action Output Format',
      '- For any flow change, end with ACTIONS_JSON block.',
      '- Never use replace_step with type=python.',
      '- Never place Python code inside action payloads unless explicitly requested.',
      'Allowed action schemas:',
      ...ACTION_OUTPUT_RULES.map((r) => `- ${r}`),
      '',
      '## Machine Block',
      'ACTIONS_JSON:',
      '{"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
      'If no actionable change exists: actions:[]',
      '',
      '## Hard constraints',
      ...activeConstraints.map((rule) => `- ${rule}`),
    ].join('\n'),
    TOKEN_BUDGET.system
  );

  const needsActions = isApplyIntent(input.userMessage) || isBuildIntent(input.userMessage);
  const actionFormatHint = needsActions
    ? [
        '',
        'Important output requirement:',
        'Include ACTIONS_JSON block so changes can be applied directly.',
      ].join('\n')
    : '';
  const buildHint = isBuildIntent(input.userMessage)
    ? [
        '',
        'Build instruction:',
        '- Generate insert_step_after / set_step_param actions using correct step types and order.',
        '- Ask one question if a required parameter is missing before generating steps.',
        '- Do not generate Python. Do not generate analysis wall.',
      ].join('\n')
    : '';
  const commandLookupHint = isCommandLookupIntent(input.userMessage)
    ? [
        '',
        'Command lookup mode:',
        '- Answer with direct command(s) first; no unnecessary clarifying questions.',
        '- Provide both SCPI set/query syntax when applicable.',
        '- Provide matching TekAutomate step suggestion for current backend context.',
        '- If a safe autofix can be applied, include ACTIONS_JSON action(s).',
      ].join('\n')
    : '';
  const validateHint = isValidateIntent(input.userMessage)
    ? [
        '',
        'Validate instruction:',
        '- Keep answer to max 3 bullets.',
        '- Flag only blockers that are directly evidenced.',
      ].join('\n')
    : '';

  const userPrompt = [
    `Execution source: ${input.executionSource}`,
    `Run status: ${input.runStatus}`,
    '',
    'Live flow (compressed):',
    compressedFlow,
    '',
    'Flow facts:',
    `- stepTypes: ${facts.stepTypes.join(', ') || '(none)'}`,
    `- simpleScreenshotFlow: ${facts.isSimpleScreenshotFlow ? 'yes' : 'no'}`,
    `- hasTmDevicesStep: ${facts.hasTmDevicesStep ? 'yes' : 'no'}`,
    `- hasSaveScreenshotStep: ${facts.hasSaveScreenshotStep ? 'yes' : 'no'}`,
    '',
    'Authoritative flow context:',
    `- backend: ${authoritative.backend}`,
    `- model: ${authoritative.model}`,
    `- connection: ${authoritative.connection}`,
    `- host: ${authoritative.host}`,
    `- deviceType: ${authoritative.deviceType}`,
    `- deviceDriver: ${authoritative.deviceDriver}`,
    `- visaBackend: ${authoritative.visaBackend}`,
    `- alias: ${authoritative.alias}`,
    '',
    'Instrument map:',
    instrumentMapText || '(none)',
    '',
    'Step-inferred execution context:',
    `- backend: ${inferred.inferredBackend}`,
    `- model: ${inferred.inferredModel}`,
    `- connection: ${inferred.inferredConnection}`,
    `- host: ${inferred.inferredHost}`,
    '',
    'Generated python (trimmed):',
    codeSnippet || '(none)',
    '',
    'Run logs (trimmed):',
    runLog || '(none)',
    '',
    'Retrieved context:',
    retrievedText || '(none)',
    '',
    'Conversation history (recent):',
    historyText || '(none)',
    '',
    `User request:\n${userText}`,
    actionFormatHint,
    buildHint,
    commandLookupHint,
    validateHint,
  ].join('\n');

  return {
    systemPrompt,
    userPrompt,
    debug: {
      corpora: Object.keys(input.retrievedChunksByCorpus) as RagCorpus[],
      retrievedChunkIds: Object.values(input.retrievedChunksByCorpus)
        .flat()
        .map((c) => c.id),
      approxTokens: approxTokens(systemPrompt) + approxTokens(userPrompt),
    },
  };
}

export const CONTEXT_BUDGETS = {
  ...TOKEN_BUDGET,
  maxTotal: MAX_TOTAL_TOKENS,
};
