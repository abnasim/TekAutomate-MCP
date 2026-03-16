import type { McpChatRequest } from './schemas';
import { getCommandIndex } from './commandIndex';

function getTargetFile(deviceType?: string, modelFamily?: string): string {
  const dt = (deviceType || '').toUpperCase();
  const mf = (modelFamily || '').toUpperCase();
  if (dt === 'SMU' || /SMU/.test(mf)) return 'smu.json';
  if (dt === 'AFG' || /AFG/.test(mf)) return 'afg.json';
  if (dt === 'AWG' || /AWG/.test(mf)) return 'awg.json';
  if (dt === 'AFG' || /AFG/.test(mf)) return 'afg.json';
  if (dt === 'AWG' || /AWG/.test(mf)) return 'awg.json';
  if (dt === 'SMU' || /SMU/.test(mf)) return 'smu.json';
  if (/DPO|5K|7K|70K/.test(mf)) return 'MSO_DPO_5k_7k_70K.json';
  return 'mso_2_4_5_6_7.json';
}

async function searchCommandJson(userMessage: string, modelFamily: string, deviceType?: string): Promise<any[]> {
  const idx = await getCommandIndex();
  const entries: any[] = (idx as any).entries || [];
  const targetFile = getTargetFile(deviceType, modelFamily);
  const terms = userMessage
    .toLowerCase()
    .split(/[^a-z0-9_:/]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return [];

  const norm = (t: string) => t.replace(/<[^>]*>/g, '').replace(/\d+/g, '').replace(/[^a-z0-9:_]/gi, '').toUpperCase();

  const scoreEntry = (entry: any) => {
    const header = String(entry.header || '').trim();
    const headerTokens = header.split(':').map(norm).filter(Boolean);
    const setSyn = entry.raw?._manualEntry?.syntax?.set || entry.syntax?.set || '';
    const querySyn = entry.raw?._manualEntry?.syntax?.query || entry.syntax?.query || '';
    const textBlob = [
      header,
      entry.shortDescription,
      entry.description,
      entry.group,
      setSyn,
      querySyn,
      ...(entry.raw?._manualEntry?.examples || []).map((ex: any) => ex?.codeExamples?.scpi?.code || ex?.scpi),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // Path-order score: terms appear in order across header tokens
    let pathScore = 0;
    let pos = 0;
    terms.forEach((term) => {
      const tNorm = norm(term);
      for (let i = pos; i < headerTokens.length; i++) {
        if (headerTokens[i].includes(tNorm) || tNorm.includes(headerTokens[i])) {
          pathScore += 2; // strong match
          pos = i + 1;
          return;
        }
      }
    });

    const textScore = terms.reduce((s, t) => s + (textBlob.includes(t) ? 1 : 0), 0);
    return pathScore + textScore;
  };

  const hits = entries
    .filter((e) => (e.sourceFile || '').endsWith(targetFile))
    .map((e) => ({ rec: e.raw || e, score: scoreEntry(e) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const slim = (r: any) => {
    const m = r._manualEntry || r;
    return {
      header: m.header || r.header,
      commandType: m.commandType,
      syntax: m.syntax,
      arguments: m.arguments,
      examples: Array.isArray(m.examples)
        ? m.examples.slice(0, 2).map((e: any) => ({
            description: e.description,
            scpi: e.codeExamples?.scpi?.code,
            tm_devices: e.codeExamples?.tm_devices?.code,
          }))
        : [],
      notes: m.notes,
      conditions: r.conditions,
    };
  };

  return hits.map((x) => JSON.stringify(slim(x.rec), null, 2)).join('\n\n---\n\n');
}

export async function buildContext(req: McpChatRequest): Promise<string> {
  const sections: string[] = [];
  const targetFile = getTargetFile(req.flowContext.deviceType, req.flowContext.modelFamily);

  sections.push(
    [
      'FIRST LINE OF YOUR RESPONSE MUST BE ONE SENTENCE ONLY.',
      'SECOND LINE MUST BE ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
      'NO numbered lists. NO step explanations. NO prose sections.',
      'IF YOU WRITE MORE THAN 2 LINES BEFORE ACTIONS_JSON YOU ARE WRONG.',
      '',
      'OUTPUT RULE (read first):',
      'End your response with ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}',
      'No code fences. No raw arrays. No prose after ACTIONS_JSON.',
      'If no changes needed: ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[]}',
      'COMPLEX flows (3+ steps): after one short summary sentence, output ACTIONS_JSON immediately. No numbered lists or step-by-step prose. The actions array is the breakdown.',
      'Never ask for confirmation. If parameters are inferable, build immediately and state assumptions in the summary.',
      'If backend is pyvisa/vxi11: use write/query/save_* steps. tm_device_command is ONLY for tm_devices backend.',
      'Combine related SCPI settings into ONE write step using semicolons. Example: CH1:SCALe 0.5;CH1:COUPling DC;CH1:TERMination 50.',
      'Combine ALL channel setup into ONE write step; combine ALL bus config into ONE action. Maximum 3 actions total per response.',
      'Every query step MUST include saveAs. No exceptions.',
      'Never ask for confirmation. Never say "shall I proceed". Apply the request directly.',
    ].join('\n')
  );

  sections.push(
    [
      '## BUILT-IN STEP TYPES — EXACT IMPLEMENTATION',
      '',
      'save_screenshot',
      '  Required params: filename, scopeType, method',
      '  scopeType "modern" (MSO4/5/6) generates:',
      '    SAVE:IMAGE:COMPOSITION NORMAL',
      '    SAVE:IMAGE "/Temp/screenshot.png"',
      '    time.sleep(1.0)',
      '    FILESYSTEM:READFILE "/Temp/screenshot.png"',
      '    read_raw() → writes bytes to local file',
      '    FILESYSTEM:DELETE "/Temp/screenshot.png"',
      '  scopeType "legacy" (DPO5k/7k/70k) generates:',
      '    HARDCOPY:PORT FILE',
      '    HARDCOPY:FORMAT PNG',
      '    HARDCOPY:FILENAME "C:/TekScope/Temp/screenshot.png"',
      '    HARDCOPY START',
      '    FILESYSTEM:READFILE → read_raw() → local file',
      '  NEVER use raw SCPI write steps for screenshots.',
      '  method:"pc_transfer" is the only supported method.',
      '',
      'save_waveform',
      '  Required params: source, filename, format',
      '  format "bin" → read_waveform_binary() fast transfer',
      '  format "csv" → DATA:SOURCE, DATA:ENCDG ASCII, WFMOUTPRE queries, CURVE?',
      '  format "wfm"/"mat" → SAVE:WAVEFORM on scope, FILESYSTEM:READFILE to PC',
      '  NEVER use raw CURVE? or SAVE:WAVEFORM write steps — use this step type.',
      '',
      'recall',
      '  Required params: recallType, filePath (except FACTORY)',
      '  recallType "FACTORY" → RECALL:SETUP FACTORY',
      '  recallType "SETUP"   → RECALL:SETUP "filePath"  (.set file)',
      '  recallType "SESSION" → RECALL:SESSION "filePath" (.tss file) + sleep(2)',
      '  recallType "WAVEFORM"→ RECALL:WAVEFORM "filePath",REF1 (.wfm file)',
      '  reference param: REF1/REF2/REF3/REF4 (for WAVEFORM type only)',
      '',
      'error_check',
      '  params: {command: "ALLEV?"}',
      '  Generates: *CLS → *ESR? → if ESR!=0 → ALLEV?',
      '  NEVER expand into separate write/query steps.',
      '',
      'tm_device_command',
      '  Required params: code, model, description',
      '  code is inserted DIRECTLY into generated Python — no wrapping.',
      '  code examples:',
      '    scope.commands.ch[1].scale.write(0.5)',
      '    scope.commands.measurement.addmeas.write("FREQUENCY")',
      '    result = scope.commands.measurement.meas[1].results.currentacq.mean.query()',
      '    scope.visa_resource.write("TRIGger:A:EDGE:SOUrce CH1")  ← fallback',
      '  model: device model string e.g. "MSO6B"',
      '  description: human readable label',
      '',
      'set_and_query',
      '  params: {command, cmdParams:[], paramValues:{}}',
      '  Performs SET then reads back with query form.',
      '  cmdParams: list of parameter names',
      '  paramValues: dict of param→value',
      '  NOT queryCommand field — that field does not exist.',
      '',
      'connect',
      '  params: {instrumentIds:[], printIdn:true}',
      '  printIdn:true → queries *IDN? and prints result',
      '',
      'disconnect',
      '  params: {instrumentIds:[]}',
      '  Closes all device connections',
      '',
      'query',
      '  params: {command:"CMD?", saveAs:"varName"}',
      '  saveAs is REQUIRED — stores result in Python variable',
      '  Missing saveAs → runtime error in generated Python',
      '',
      'write',
      '  params: {command:"CMD value"}',
      '  Multiple related commands can use semicolons:',
      '  "CH1:SCAle 0.5;CH1:COUPling DC;CH1:TERMination 50"',
      '',
      'sleep',
      '  params: {duration:0.5}  ← seconds as float',
      '',
      'python',
      '  params: {code:"python code here"}',
      '  Only use when explicitly requested by user.',
      '',
      'group',
      '  params: {}',
      '  children: [array of steps]',
      '  Both params:{} AND children:[] are REQUIRED.',
      '',
      'comment',
      '  params: {text:"note"}',
      '  Documentation only — no generated code.',
    ].join('\n')
  );

  sections.push(
    [
      '## tm_device_command Guidance (tm_devices backend ONLY)',
      '',
      'Preferred tm_devices API examples:',
      '  scope.commands.ch[1].scale.write(0.2)',
      '  scope.commands.horizontal.scale.write(1e-6)',
      '  scope.commands.horizontal.recordlength.write(10000)',
      '  scope.commands.trigger.a.type.write("EDGE")',
      '  scope.commands.trigger.a.edge.source.write("CH1")',
      '  scope.commands.trigger.a.level.ch[1].write(0.5)',
      '  scope.commands.acquire.state.write("ON")',
      '  scope.commands.acquire.stopafter.write("SEQUENCE")',
      '  scope.commands.acquire.mode.write("SAMple")',
      '  scope.commands.measurement.addmeas.write("FREQUENCY")',
      '  scope.commands.measurement.meas[1].source.write("CH1")',
      '  scope.commands.measurement.meas[1].results.currentacq.mean.query()',
      '  scope.commands.display.waveview1.ch[1].state.write("ON")',
      '  scope.commands.save.session.write("example.tss")',
      '  scope.commands.save.waveform.write(\'CH1,"example.wfm"\')',
      '  scope.save_screenshot("example.png")',
      '  scope.recall_session("example.tss")',
      '  scope.recall_reference("example.wfm", 1)',
      '',
      'Fallback raw SCPI via visa_resource (when API path unknown):',
      '  scope.visa_resource.write("TRIGger:A:EDGE:SOUrce CH1")',
      '  result = scope.visa_resource.query("MEASUrement:MEAS1:RESUlts:CURRentacq:MEAN?")',
      '  scope.visa_resource.read_bytes(1024)',
      '',
      'Device routing for tm_devices:',
      '  SCOPE → scope.commands.*',
      '  AFG   → afg.commands.* (e.g., afg.commands.frequency.write(1e6))',
      '  AWG   → awg.commands.*',
      '  SMU   → smu.commands.* (e.g., smu.commands.smua.source.levelv.write(3.3))',
      '',
      'tm_devices backend: NEVER emit write/query/save_*; only tm_device_command with valid API code.',
      'pyvisa/vxi11 backend: NEVER emit tm_device_command; use write/query/save_* instead.',
    ].join('\n')
  );

  let scpiHits: string | undefined;
  if (req.scpiContext && Array.isArray(req.scpiContext) && req.scpiContext.length > 0) {
    scpiHits = req.scpiContext.map((r: any) => JSON.stringify(r, null, 2)).join('\n\n---\n\n');
  } else {
    scpiHits = await searchCommandJson(req.userMessage, req.flowContext.modelFamily, req.flowContext.deviceType);
  }
  if (scpiHits && scpiHits.length) {
    sections.push('## MATCHED SCPI COMMANDS\n\n' + scpiHits);
  }

  if (req.tmContext && Array.isArray(req.tmContext) && req.tmContext.length > 0) {
    const tmLines = req.tmContext
      .map((r: any) => {
        const usage = Array.isArray(r?.usage) ? r.usage[0] : r?.usage;
        return `${r.model || ''}:${r.path}${usage ? ` → ${usage}` : ''}`;
      })
      .join('\n');
    sections.push('## MATCHED TM_DEVICES PATHS\n\n' + tmLines);
  }

  if ((req.flowContext.deviceType || '').toUpperCase() === 'SMU') {
    sections.push(`## SMU SCPI PATTERNS (Keithley 24xx series)
Write commands use write step, query commands use query step with saveAs.

Source voltage:
  write: SOURce:FUNCtion VOLTage
  write: SOURce:VOLTage:LEVel:IMMediate:AMPLitude 3.3
  write: SENSe:CURRent:PROTection 0.1
  write: OUTPut:STATe ON

Query measurements:
  query: MEASure:VOLTage:DC? -> saveAs: voltage
  query: MEASure:CURRent:DC? -> saveAs: current
  query: MEASure:RESistance? -> saveAs: resistance

Source current:
  write: SOURce:FUNCtion CURRent
  write: SOURCe:CURRent:LEVel:IMMediate:AMPLitude 0.01
  write: SENSe:VOLTage:PROTection 5.0
  write: OUTPut:STATe ON

NEVER use VSET/ISET/OUTPUT — those are not valid Keithley SCPI.`);
  }

  if ((req.flowContext.deviceType || '').toUpperCase() === 'AFG') {
    sections.push(`## AFG SCPI PATTERNS (Tektronix AFG series)
  write: SOURce1:FUNCtion:SHAPe SINusoid
  write: SOURce1:FREQuency:FIXed 1000
  write: SOURce1:VOLTage:LEVel:IMMediate:AMPLitude 2.0
  write: SOURce1:VOLTage:LEVel:IMMediate:OFFSet 0.0
  write: OUTPut1:STATe ON
  query: SOURce1:FREQuency:FIXed? -> saveAs: freq
  query: OUTPut1:STATe? -> saveAs: output_state

  For square: SOURce1:FUNCtion:SHAPe SQUare
  For pulse:  SOURce1:FUNCtion:SHAPe PULSe
  For ramp:   SOURce1:FUNCtion:SHAPe RAMP
  NEVER use short forms FUNC/FREQ/VOLT/OUTP; use full SOURce/OUTPut paths.`);
  }

  const ws: string[] = [
    `Backend: ${req.flowContext.backend}`,
    `Device: ${req.flowContext.deviceType} / ${req.flowContext.modelFamily}`,
    `Steps: ${JSON.stringify(req.flowContext.steps, null, 2)}`,
    `Device type: ${req.flowContext.deviceType || 'SCOPE'}`,
    `Model family: ${req.flowContext.modelFamily}`,
    `Command library: ${targetFile}`,
  ];
  if (req.flowContext.validationErrors?.length) {
    ws.push('Errors:\n' + req.flowContext.validationErrors.map((e) => `- ${e}`).join('\n'));
  }
  if (req.runContext.logTail) {
    ws.push('Last run log:\n' + req.runContext.logTail);
  }
  sections.push('## WORKSPACE\n\n' + ws.join('\n'));

  if ((req.flowContext.backend || '').toLowerCase() !== 'tm_devices') {
    sections.push(
      '## BACKEND ENFORCEMENT\n\n' +
        `Backend is ${req.flowContext.backend}. Use ONLY write/query/save_* steps with SCPI strings. ` +
        'tm_device_command is FORBIDDEN for this backend. If you see tm_device_command in your response, replace it with write/query.'
    );
  }

  return sections.join('\n\n---\n\n');
}
