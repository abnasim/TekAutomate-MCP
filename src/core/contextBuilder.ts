import type { McpChatRequest } from './schemas';
import { getCommandIndex } from './commandIndex';

async function searchCommandJson(userMessage: string, modelFamily: string): Promise<any[]> {
  const idx = await getCommandIndex();
  const entries: any[] = (idx as any).entries || [];
  const isDpo = /DPO|5k|7k|70k/i.test(modelFamily || '');
  const targetFile = isDpo ? 'MSO_DPO_5k_7k_70K.json' : 'mso_2_4_5_6_7.json';
  const terms = userMessage.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];

  const hits = entries
    .filter((e) => (e.sourceFile || '').endsWith(targetFile))
    .map((e) => {
      const text = [
        e.header,
        e.shortDescription,
        e.description,
        e.group,
        e.raw?._manualEntry?.syntax?.set,
        e.raw?._manualEntry?.syntax?.query,
        ...(e.raw?._manualEntry?.examples || []).map((ex: any) => ex?.codeExamples?.scpi?.code),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      return { rec: e.raw || e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const slim = (r: any) => ({
    header: r.header,
    commandType: r.commandType,
    syntax: r.syntax,
    arguments: r.arguments,
    examples: (r.examples || []).slice(0, 2),
    notes: r.notes,
    conditions: r.conditions,
  });

  return hits
    .map((x) => JSON.stringify(slim(x.rec._manualEntry || x.rec)))
    .join('\n\n---\n\n');
}

export async function buildContext(req: McpChatRequest): Promise<string> {
  const sections: string[] = [];

  sections.push(
    [
      'OUTPUT RULE (read first):',
      'End your response with ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
      'No code fences. No raw arrays. No prose after ACTIONS_JSON.',
      'If no changes needed: ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[]}',
      'COMPLEX flows (3+ steps): after one short summary sentence, output ACTIONS_JSON immediately. No numbered lists or step-by-step prose. The actions array is the breakdown.',
    ].join('\n')
  );

  sections.push(
    [
      '## Built-in Step Types — Use These, Never Raw SCPI Equivalents',
      '',
      'save_screenshot',
      '  params: {filename, scopeType:"modern"|"legacy", method:"pc_transfer"}',
      '  NEVER replace with: SAVE:IMAGe, HARDCopy, FILESYSTEM:READFILE',
      '  Handles: capture + PC transfer pipeline automatically',
      '',
      'save_waveform',
      '  params: {source:"CH1", filename:"data.wfm", format:"bin"|"csv"|"mat"}',
      '  NEVER replace with: raw DATa:SOUrce + CURVe? + WFMOutpre steps',
      '  Handles: full waveform transfer pipeline automatically',
      '',
      'error_check',
      '  params: {command:"ALLEV?"}',
      '  NEVER replace with: raw *CLS + *ESR? + ALLEV? write/query steps',
      '  Handles: *CLS → *ESR? → if error → ALLEV? internally',
      '',
      'recall',
      '  params: {recallType:"SESSION"|"SETUP"|"WAVEFORM", filePath:"...", reference:"REF1"}',
      '  NEVER replace with: raw RECAll:SETUp or RECAll:WAVEform write steps',
      '',
      'connect / disconnect',
      '  Always first and last steps',
      '  NEVER add raw *RST or *IDN? unless explicitly requested',
      '',
      'tm_device_command',
      '  params: {code:"scope.commands.x.y.write(val)", model:"MSO6B", description:"..."}',
      '  ONLY for tm_devices backend — never use for pyvisa/vxi11',
      '  code must be valid tm_devices Python API path, NOT raw SCPI strings',
    ].join('\n')
  );

  const scpiHits = await searchCommandJson(req.userMessage, req.flowContext.modelFamily);
  if (scpiHits && scpiHits.length) {
    sections.push('## MATCHED SCPI COMMANDS\n\n' + scpiHits);
  }

  const ws: string[] = [
    `Backend: ${req.flowContext.backend}`,
    `Device: ${req.flowContext.deviceType} / ${req.flowContext.modelFamily}`,
    `Steps: ${JSON.stringify(req.flowContext.steps, null, 2)}`,
  ];
  if (req.flowContext.validationErrors?.length) {
    ws.push('Errors:\n' + req.flowContext.validationErrors.map((e) => `- ${e}`).join('\n'));
  }
  if (req.runContext.logTail) {
    ws.push('Last run log:\n' + req.runContext.logTail);
  }
  sections.push('## WORKSPACE\n\n' + ws.join('\n'));

  return sections.join('\n\n---\n\n');
}
