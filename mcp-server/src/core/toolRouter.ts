import {
  type MicroTool,
  type ToolCategory,
  type ToolSearchHit,
  getToolRegistry,
} from './toolRegistry';
import { getToolSearchEngine, type ToolSearchOptions } from './toolSearch';
import { executeBuild, type BuildRequest } from './buildAction';
import { getSemanticSearchEngine } from './semanticSearch';
import { validateTool } from './toolValidation';

export interface RouterRequest {
  action: 'search' | 'exec' | 'info' | 'list' | 'search_exec' | 'build' | 'create' | 'update' | 'delete';
  query?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  categories?: ToolCategory[];
  limit?: number;
  debug?: boolean;
  context?: BuildRequest['context'];
  buildNew?: boolean;
  instrumentId?: string;
  toolName?: string;
  toolDescription?: string;
  toolTriggers?: string[];
  toolTags?: string[];
  toolCategory?: ToolCategory;
  modelFamily?: string;
  toolSchema?: {
    type?: 'object';
    properties?: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  toolSteps?: Array<Record<string, unknown>>;
}

export interface RouterSearchResult {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  score: number;
  matchStage: 'trigger' | 'keyword' | 'semantic';
  schema: {
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  debug?: {
    bm25Score?: number;
    semanticScore?: number;
    usageBoost?: number;
    recencyBoost?: number;
  };
}

export interface RouterResponse {
  ok: boolean;
  action: string;
  results?: RouterSearchResult[];
  data?: unknown;
  text?: string;
  warnings?: string[];
  error?: string;
  durationMs?: number;
}

function serializeHit(hit: ToolSearchHit, debug = false): RouterSearchResult {
  return {
    id: hit.tool.id,
    name: hit.tool.name,
    description: hit.tool.description,
    category: hit.tool.category,
    score: Math.round(hit.score * 100) / 100,
    matchStage: hit.matchStage,
    schema: {
      properties: hit.tool.schema.properties,
      required: hit.tool.schema.required,
    },
    ...(debug ? { debug: hit.debug } : {}),
  };
}

export async function tekRouter(request: RouterRequest): Promise<RouterResponse> {
  const startedAt = Date.now();

  switch (request.action) {
    case 'search':
      return handleSearch(request, startedAt);
    case 'exec':
      return handleExec(request, startedAt);
    case 'info':
      return handleInfo(request, startedAt);
    case 'list':
      return handleList(startedAt);
    case 'search_exec':
      return handleSearchExec(request, startedAt);
    case 'build':
      return handleBuild(request, startedAt);
    case 'create':
      return handleCreate(request, startedAt);
    case 'update':
      return handleUpdate(request, startedAt);
    case 'delete':
      return handleDelete(request, startedAt);
    default:
      return {
        ok: false,
        action: String(request.action),
        error: `Unknown action "${String(request.action)}". Valid actions: search, exec, info, list, search_exec, build, create, update, delete`,
        durationMs: Date.now() - startedAt,
      };
  }
}

function normalizeList(values: string[] | undefined, fallback: string[] = []): string[] {
  const items = Array.isArray(values) ? values : fallback;
  return Array.from(new Set(items.map((value) => String(value || '').trim()).filter(Boolean)));
}

async function rebuildRouterIndexes(): Promise<void> {
  getToolSearchEngine().rebuildIndex();
  await getSemanticSearchEngine().prepareIndex(getToolRegistry().all());
}

async function persistShortcutMutation(): Promise<void> {
  try {
    const { markShortcutsDirty, persistRuntimeShortcuts } = await import('./routerIntegration');
    markShortcutsDirty();
    await persistRuntimeShortcuts();
  } catch {
    // Best-effort persistence.
  }
}

function buildTemplateHandler(
  toolName: string,
  toolDescription: string,
  toolCategory: ToolCategory,
  toolSteps: Array<Record<string, unknown>>
): MicroTool['handler'] {
  return async () => {
    const payload = {
      summary: `${toolName} flow ready.`,
      findings: [],
      suggestedFixes: [],
      actions: [
        {
          type: 'replace_flow',
          flow: {
            name: toolName,
            description: toolDescription,
            backend: toolCategory === 'template' ? 'pyvisa' : 'template',
            deviceType: 'SCOPE',
            steps: toolSteps,
          },
        },
      ],
    };
    return {
      ok: true,
      data: payload.actions[0],
      text: `ACTIONS_JSON: ${JSON.stringify(payload)}`,
    };
  };
}

export function buildManagedTool(req: RouterRequest, existing?: MicroTool): MicroTool {
  const name = String(req.toolName || existing?.name || '').trim();
  const id = String(req.toolId || existing?.id || (name ? `shortcut:${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}_${Date.now()}` : '')).trim();
  const description = String(req.toolDescription || existing?.description || '').trim();
  const category = (req.toolCategory || existing?.category || 'template') as ToolCategory;
  const schema = {
    type: 'object' as const,
    properties: req.toolSchema?.properties || existing?.schema.properties || {},
    required: req.toolSchema?.required || existing?.schema.required,
  };
  const steps = Array.isArray(req.toolSteps) ? req.toolSteps : [];
  const triggers = normalizeList(req.toolTriggers, existing?.triggers || [name, id]);
  const tags = normalizeList(req.toolTags, existing?.tags || [category, 'runtime']);
  const handler =
    steps.length > 0
      ? buildTemplateHandler(name, description, category, steps)
      : existing?.handler ||
        (async () => ({
          ok: true,
          data: { toolId: id, args: {} },
          text: `${name} executed.`,
        }));

  return {
    id,
    name,
    description,
    triggers,
    tags,
    category,
    schema,
    handler,
    usageCount: existing?.usageCount || 0,
    lastUsedAt: existing?.lastUsedAt || 0,
    successCount: existing?.successCount || 0,
    failureCount: existing?.failureCount || 0,
    autoGenerated: existing?.autoGenerated ?? false,
    steps: steps.length > 0 ? steps : existing?.steps,
  };
}

async function handleSearch(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.query?.trim()) {
    return {
      ok: false,
      action: 'search',
      error: 'Missing required field: query',
      durationMs: Date.now() - startedAt,
    };
  }

  // ── Stage timings ──────────────────────────────────────────────
  let scpiMs = 0;
  let routerMs = 0;
  let ragMs = 0;

  // Direct SCPI command search via command index (header + description + tags)
  let scpiCommands: Array<Record<string, unknown>> = [];
  try {
    const scpiStart = Date.now();
    const { getCommandIndex } = await import('./commandIndex');
    const cmdIdx = await getCommandIndex();
    const results = cmdIdx.searchByQuery(req.query, req.modelFamily, req.limit ?? 5);
    scpiCommands = results.map((cmd: any) => ({
      id: cmd.commandId || cmd.header || '',
      name: cmd.header || '',
      description: cmd.shortDescription || cmd.description || '',
      category: 'scpi',
      score: 10,
      matchStage: 'command_index',
      syntax: cmd.syntax,
      arguments: cmd.arguments,
      examples: cmd.examples || cmd.codeExamples,
      group: cmd.group,
      commandType: cmd.commandType,
    }));
    scpiMs = Date.now() - scpiStart;
  } catch { /* non-fatal */ }

  // Router's own BM25/trigger search for shortcuts and templates
  const routerStart = Date.now();
  const engine = getToolSearchEngine();
  const routerHits = await engine.searchCompound(req.query, {
    limit: 3,
    categories: req.categories,
  });
  const familyHint = (req.modelFamily || '').toUpperCase();
  const filteredRouterHits = routerHits.filter((hit) => {
    const toolId = (hit.tool.id || '').toLowerCase();
    if (!familyHint.includes('DPO') && toolId.includes('dpojet')) return false;
    return true;
  });
  const routerResults = filteredRouterHits
    .filter((hit) => hit.tool.category === 'shortcut' || hit.tool.category === 'template' || hit.tool.category === 'instrument')
    .map((hit) => serializeHit(hit, req.debug === true));
  routerMs = Date.now() - routerStart;

  let results = [...scpiCommands, ...routerResults];

  // ── Explorer injection (5%) ────────────────────────────────────
  // Surface a least-used tool to encourage discovery of underused features
  if (results.length >= 3) {
    const resultIds = new Set(results.map((r: any) => r.id || r.name));
    const registry = getToolRegistry();
    const allTools = registry.all()
      .filter(t => !resultIds.has(t.id) && !t.id.startsWith('rag:') && t.category !== 'composite')
      .sort((a, b) => a.usageCount - b.usageCount);
    if (allTools.length > 0) {
      const explorer = allTools[0];
      results[results.length - 1] = {
        id: explorer.id,
        name: explorer.name,
        description: explorer.description,
        category: explorer.category,
        score: 0.1,
        matchStage: 'explorer',
        explorer: true,
      };
    }
  }

  // RAG knowledge — only for question-like queries
  let knowledge: Array<{ corpus: string; title: string; body: string }> | undefined;
  const isQuestion = /\b(why|how|what|explain|error|fail|timeout|issue|problem|debug)\b/i.test(req.query);
  if (isQuestion) {
    try {
      const ragStart = Date.now();
      const { retrieveRagChunks } = await import('../tools/retrieveRagChunks');
      const ragResults: Array<{ corpus: string; title: string; body: string }> = [];
      for (const corpus of ['errors', 'app_logic', 'scpi'] as const) {
        const res = await retrieveRagChunks({ corpus, query: req.query, topK: 1 });
        if (res.ok && Array.isArray(res.data)) {
          for (const chunk of res.data) {
            const c = chunk as { title?: string; body?: string };
            if (c.body && c.body.length > 30) {
              ragResults.push({ corpus, title: c.title || '', body: c.body.slice(0, 300) });
            }
          }
        }
      }
      if (ragResults.length > 0) knowledge = ragResults;
      ragMs = Date.now() - ragStart;
    } catch { /* non-fatal */ }
  }

  // ── Blind spot prevention ──────────────────────────────────────
  // When no results found, show available categories so AI can refine
  let blindSpotHint: string | undefined;
  if (results.length === 0) {
    try {
      const { GROUP_NAMES } = await import('./commandGroups');
      const registry = getToolRegistry();
      const shortcutCount = registry.all().filter(t => t.category === 'shortcut').length;
      const builtinCount = registry.all().filter(t => t.id.startsWith('builtin:')).length;
      blindSpotHint =
        `No results for "${req.query}". Try a different query.\n` +
        `Available SCPI groups: ${GROUP_NAMES.join(', ')}\n` +
        `Shortcuts: ${shortcutCount}, Builtin tools: ${builtinCount}\n` +
        `Tip: use more specific SCPI terms, or try action:"search_exec" with query:"browse scpi commands" args:{group:"GroupName"}`;
    } catch { /* non-fatal */ }
  }

  // ── Timing transparency ────────────────────────────────────────
  const totalMs = Date.now() - startedAt;
  const timing = `${totalMs}ms (SCPI:${scpiMs}ms + Router:${routerMs}ms${ragMs ? ` + RAG:${ragMs}ms` : ''})`;

  return {
    ok: true,
    action: 'search',
    results,
    knowledge,
    blindSpotHint,
    timing,
    text: results.length
      ? `Found ${results.length} result(s) for "${req.query}" in ${timing}.`
      : blindSpotHint || `No results for "${req.query}" (${timing}).`,
    durationMs: totalMs,
  };
}

async function handleExec(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'exec',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }

  const registry = getToolRegistry();
  const tool = registry.get(req.toolId);
  if (!tool) {
    return {
      ok: false,
      action: 'exec',
      error: `Tool not found: "${req.toolId}". Use action:"search" to find the right tool ID.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const result = await tool.handler(req.args || {});
    registry.recordUsage(req.toolId);
    if (result.ok) registry.recordSuccess(req.toolId);
    else registry.recordFailure(req.toolId);
    return {
      ok: result.ok,
      action: 'exec',
      data: result.data,
      text: result.text,
      warnings: result.warnings,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    registry.recordFailure(req.toolId);
    return {
      ok: false,
      action: 'exec',
      error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function handleInfo(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'info',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }

  const registry = getToolRegistry();
  const tool = registry.get(req.toolId);
  if (!tool) {
    return {
      ok: false,
      action: 'info',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    ok: true,
    action: 'info',
    data: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      triggers: tool.triggers,
      tags: tool.tags,
      schema: tool.schema,
      usageCount: tool.usageCount,
    },
    durationMs: Date.now() - startedAt,
  };
}

async function handleList(startedAt: number): Promise<RouterResponse> {
  const registry = getToolRegistry();
  const all = registry.all();
  const byCat: Record<string, number> = {};
  for (const tool of all) {
    byCat[tool.category] = (byCat[tool.category] || 0) + 1;
  }

  return {
    ok: true,
    action: 'list',
    data: {
      totalTools: all.length,
      categories: byCat,
    },
    text: `${all.length} tools across ${Object.keys(byCat).length} categories.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleSearchExec(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.query?.trim()) {
    return {
      ok: false,
      action: 'search_exec',
      error: 'Missing required field: query',
      durationMs: Date.now() - startedAt,
    };
  }

  // ── Priority: check builtin MCP tools first ──────────────────
  // Builtin tools (search_scpi, verify_scpi, etc.) should always win
  // over SCPI command headers that happen to share keywords.
  const registry = getToolRegistry();
  const queryLower = req.query.toLowerCase().trim();
  // Find all builtin tools whose triggers match, then pick the one
  // with the longest matching trigger (most specific match wins).
  let builtinMatch: typeof registry extends { all(): (infer T)[] } ? T : any = null;
  let longestTrigger = 0;
  for (const tool of registry.all()) {
    if (!tool.id.startsWith('builtin:')) continue;
    for (const t of tool.triggers) {
      const tLower = t.toLowerCase();
      if (queryLower.includes(tLower) && tLower.length > longestTrigger) {
        builtinMatch = tool;
        longestTrigger = tLower.length;
      }
    }
  }

  if (builtinMatch) {
    try {
      const toolStart = Date.now();
      const result = await builtinMatch.handler(req.args || {});
      const toolMs = Date.now() - toolStart;
      registry.recordUsage(builtinMatch.id);
      if (result.ok) registry.recordSuccess(builtinMatch.id);
      else registry.recordFailure(builtinMatch.id);
      const totalMs = Date.now() - startedAt;
      return {
        ok: result.ok,
        action: 'search_exec',
        data: result.data,
        text: result.text ? `[${builtinMatch.name}] ${result.text}` : `Executed ${builtinMatch.name} successfully.`,
        warnings: result.warnings,
        error: result.error,
        timing: `${totalMs}ms (match:${totalMs - toolMs}ms + exec:${toolMs}ms)`,
        durationMs: totalMs,
      };
    } catch (err) {
      registry.recordFailure(builtinMatch.id);
      return {
        ok: false,
        action: 'search_exec',
        error: `Builtin tool "${builtinMatch.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  // ── Fall through to general search engine ─────────────────────
  const searchStart = Date.now();
  const engine = getToolSearchEngine();
  const hits = await engine.search(req.query, {
    limit: 1,
    categories: req.categories,
  });
  const searchMs = Date.now() - searchStart;

  // ── Blind spot prevention ──────────────────────────────────────
  if (!hits.length) {
    let blindSpotHint = `No tools found for "${req.query}".`;
    try {
      const { GROUP_NAMES } = await import('./commandGroups');
      const shortcutCount = registry.all().filter(t => t.category === 'shortcut').length;
      blindSpotHint +=
        `\nAvailable SCPI groups: ${GROUP_NAMES.join(', ')}` +
        `\nShortcuts: ${shortcutCount}` +
        `\nTip: try "search scpi commands" with a different query, or "browse scpi commands" with a group name.`;
    } catch { /* non-fatal */ }
    return {
      ok: false,
      action: 'search_exec',
      error: blindSpotHint,
      durationMs: Date.now() - startedAt,
    };
  }

  const top = hits[0];
  if (top.score < 5.0) {
    return {
      ok: true,
      action: 'search_exec',
      results: hits.map((hit) => serializeHit(hit, req.debug === true)),
      text: `Low confidence match. Top result: ${top.tool.name} (score: ${top.score.toFixed(2)}). Use action:"exec" with the tool ID and args to proceed.`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const result = await top.tool.handler(req.args || {});
    const registry = getToolRegistry();
    registry.recordUsage(top.tool.id);
    if (result.ok) registry.recordSuccess(top.tool.id);
    else registry.recordFailure(top.tool.id);
    return {
      ok: result.ok,
      action: 'search_exec',
      data: result.data,
      text: result.text ? `[${top.tool.name}] ${result.text}` : `Executed ${top.tool.name} successfully.`,
      warnings: result.warnings,
      error: result.error,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    getToolRegistry().recordFailure(top.tool.id);
    return {
      ok: false,
      action: 'search_exec',
      error: `Auto-exec of "${top.tool.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function handleCreate(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  const registry = getToolRegistry();
  const tool = buildManagedTool(req);
  const validation = validateTool(tool);
  if (!validation.valid) {
    return {
      ok: false,
      action: 'create',
      error: validation.reason,
      durationMs: Date.now() - startedAt,
    };
  }
  if (registry.has(tool.id)) {
    return {
      ok: false,
      action: 'create',
      error: `Tool already exists: "${tool.id}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  registry.register(tool);
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'create',
    data: { toolId: tool.id },
    text: `Registered tool ${tool.id}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleUpdate(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'update',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }
  const registry = getToolRegistry();
  const existing = registry.get(req.toolId);
  if (!existing) {
    return {
      ok: false,
      action: 'update',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  const tool = buildManagedTool(req, existing);
  const validation = validateTool(tool);
  if (!validation.valid) {
    return {
      ok: false,
      action: 'update',
      error: validation.reason,
      durationMs: Date.now() - startedAt,
    };
  }
  registry.register(tool);
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'update',
    data: { toolId: tool.id },
    text: `Updated tool ${tool.id}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleDelete(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.toolId?.trim()) {
    return {
      ok: false,
      action: 'delete',
      error: 'Missing required field: toolId',
      durationMs: Date.now() - startedAt,
    };
  }
  const registry = getToolRegistry();
  const removed = registry.unregister(req.toolId);
  if (!removed) {
    return {
      ok: false,
      action: 'delete',
      error: `Tool not found: "${req.toolId}"`,
      durationMs: Date.now() - startedAt,
    };
  }
  await rebuildRouterIndexes();
  await persistShortcutMutation();
  return {
    ok: true,
    action: 'delete',
    data: { toolId: req.toolId, deleted: true },
    text: `Deleted tool ${req.toolId}.`,
    durationMs: Date.now() - startedAt,
  };
}

async function handleBuild(req: RouterRequest, startedAt: number): Promise<RouterResponse> {
  if (!req.query?.trim()) {
    return {
      ok: false,
      action: 'build',
      error: 'Missing required field: query',
      durationMs: Date.now() - startedAt,
    };
  }

  const result = await executeBuild({
    query: req.query,
    context: req.context,
    buildNew: req.buildNew,
    instrumentId: req.instrumentId,
  });

  return {
    ok: result.ok,
    action: 'build',
    data: result.data,
    text: result.text,
    warnings: result.warnings,
    error: result.error,
    durationMs: Date.now() - startedAt,
  };
}

export const TEK_ROUTER_TOOL_DEFINITION = {
  name: 'tek_router',
  description:
    'TekAutomate gateway — routes to 21,000+ internal SCPI tools for Tektronix oscilloscopes.\n\n' +

    '## IMPORTANT: How to call\n' +
    'Always use action:"search_exec". The query field selects which internal tool to use.\n' +
    'The args field passes that tool\'s parameters. Structure:\n' +
    '  {action:"search_exec", query:"<trigger phrase>", args:{<tool parameters>}}\n\n' +

    '## Decision Rule: FUZZY vs EXACT\n' +
    '- Know the intent but NOT the exact SCPI header?\n' +
    '  → query:"search scpi commands", args:{query:"your description here"}\n' +
    '  Example: {action:"search_exec", query:"search scpi commands", args:{query:"callout text underline"}}\n' +
    '  Example: {action:"search_exec", query:"search scpi commands", args:{query:"vertical cursor position MathFFT"}}\n\n' +
    '- Know the EXACT SCPI header?\n' +
    '  → query:"get command by header", args:{header:"EXACT:HEADER:HERE"}\n' +
    '  Example: {action:"search_exec", query:"get command by header", args:{header:"CALLOUTS:CALLOUT<x>:FONT:UNDERLine"}}\n' +
    '  IMPORTANT: header must be exact canonical form. If unsure, use "search scpi commands" first.\n\n' +

    '## Available Internal Tools (query trigger → args)\n\n' +

    'SEARCH:\n' +
    '  "search scpi commands"     → {query:"<natural language or keywords>"}\n' +
    '  "get command by header"    → {header:"<exact canonical SCPI header>"}\n' +
    '  "batch header lookup"      → {headers:["header1","header2",...]}\n' +
    '  "browse scpi commands"     → {group:"Trigger"} or {group:"Measurement", filter:"jitter"}\n' +
    '  "list command groups"      → {} (no args needed)\n\n' +

    'BUILD:\n' +
    '  "materialize scpi command" → {header:"CH<x>:SCAle", commandType:"set", value:"1.0", placeholderBindings:{"CH<x>":"CH1"}}\n' +
    '  "finalize scpi"            → {items:[{header:"...", commandType:"set", value:"..."}]}\n\n' +

    'VERIFY:\n' +
    '  "verify scpi commands"     → {commands:["CH1:SCAle 1.0","ACQuire:MODE?"]}\n' +
    '  "validate action payload"  → {actionsJson:{steps:[...]}}\n' +
    '  "validate device context"  → {steps:[...]}\n\n' +

    'KNOWLEDGE:\n' +
    '  "retrieve rag chunks"      → {corpus:"scpi"|"app_logic"|"errors"|"templates", query:"..."}\n' +
    '  "known failures"           → {query:"timeout"}\n' +
    '  "template examples"        → {query:"jitter measurement"}\n\n' +

    'POLICY:\n' +
    '  "get policy"               → {mode:"steps_json"}\n' +
    '  "valid step types"         → {mode:"steps_json"}\n\n' +

    '## Other Actions\n' +
    '  action:"search"  → search SCPI commands by description. {query:"edge trigger", limit:5}\n' +
    '  action:"build"   → generate workflow. {query:"set up jitter measurement on CH1"}\n' +
    '  action:"exec"    → run tool by ID. {toolId:"scpi:CH<x>:SCAle", args:{...}}\n' +
    '  action:"create"  → save shortcut. {toolName:"...", toolDescription:"...", toolTriggers:[...], toolCategory:"shortcut", toolSteps:[...]}\n' +
    '  action:"info"    → tool details. {toolId:"scpi:CH<x>:SCAle"}\n' +
    '  action:"list"    → list all tools.\n\n' +

    '## Workflow Pattern\n' +
    '  1. Search: tek_router({action:"search_exec", query:"search scpi commands", args:{query:"callout underline"}})\n' +
    '  2. Build:  tek_router({action:"search_exec", query:"materialize scpi command", args:{header:"CALLOUTS:CALLOUT<x>:FONT:UNDERLine", commandType:"set", value:"1", placeholderBindings:{"CALLOUT<x>":"CALLOUT1"}}})\n' +
    '  3. Send:   send_scpi({commands:["CALLOUTS:CALLOUT1:FONT:UNDERLine 1"]})\n' +
    '  4. Verify: capture_screenshot()\n\n' +

    '## When Search Returns Wrong/No Results\n' +
    'If your search does not find the right command:\n' +
    '  1. Browse by group: {action:"search_exec", query:"browse scpi commands", args:{group:"Search"}} (or Trigger, Measurement, Display, etc.)\n' +
    '  2. Try different keywords — use SCPI terms not natural language (e.g. "SEARCHTABle" not "search results table")\n' +
    '  3. Use discover_scpi to probe the live instrument: discover_scpi({basePath:"SEARCH", liveMode:true})\n' +
    '  4. If the user pastes manual/documentation text, parse the SCPI header from it and execute directly via send_scpi\n' +
    '  5. After finding the right command, SAVE IT: {action:"create", toolName:"<descriptive name>", toolDescription:"<what it does>", toolTriggers:["<natural language phrases that should find this>"], toolCategory:"shortcut", toolSteps:[{tool:"send_scpi", args:{commands:["<the command>"]}}]}\n' +
    '  6. NEVER loop on the same failed search — try a different approach after 1 failed attempt\n\n' +

    '## Model Family\n' +
    'If the user has not specified their instrument model:\n' +
    '  - ASK the user which model they have (MSO4, MSO5, MSO6, MSO6B, DPO7, AFG, AWG, etc.)\n' +
    '  - If they say "oscilloscope" or "scope" without a model, default to MSO series (MSO5/MSO6)\n' +
    '  - If they say "DPO" or "legacy", use DPO family\n' +
    '  - Pass modelFamily in search args when known: args:{query:"...", modelFamily:"MSO6"}\n' +
    '  - This filters results to commands available on that instrument',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'exec', 'info', 'list', 'search_exec', 'build', 'create', 'update', 'delete'],
        description: 'Operation to run.',
      },
      query: {
        type: 'string',
        description: 'Natural language query for search, search_exec, or build.',
      },
      toolId: {
        type: 'string',
        description: 'Tool ID from router search results.',
      },
      args: {
        type: 'object',
        description: 'Arguments for tool execution.',
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional category filter.',
      },
      limit: {
        type: 'number',
        description: 'Maximum search results to return.',
      },
      debug: {
        type: 'boolean',
        description: 'Include match trace details such as BM25, semantic, and usage boosts.',
      },
      context: {
        type: 'object',
        description: 'Optional flow context for build: backend, deviceType, modelFamily, steps, selectedStepId, alias.',
      },
      buildNew: {
        type: 'boolean',
        description: 'For build: true creates replace_flow, false inserts into the current flow.',
      },
      instrumentId: {
        type: 'string',
        description: 'Instrument alias to use for generated connect/disconnect steps.',
      },
      toolName: {
        type: 'string',
        description: 'Tool name for create or update action.',
      },
      toolDescription: {
        type: 'string',
        description: 'Tool description for create or update action.',
      },
      toolTriggers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Trigger phrases for create or update action.',
      },
      toolTags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Search tags for create or update action.',
      },
      toolCategory: {
        type: 'string',
        description: 'Tool category for create or update action.',
      },
      toolSchema: {
        type: 'object',
        description: 'Input schema for create or update action.',
      },
      toolSteps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
        },
        description: 'Step sequence for template-style tools created or updated through the router.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};
