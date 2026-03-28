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

  // Primary: use smart_scpi_lookup for SCPI command search (best intent + group logic)
  let scpiCommands: Array<Record<string, unknown>> = [];
  try {
    const { smartScpiLookup } = await import('./smartScpiAssistant');
    const scpiRes = await smartScpiLookup({ query: req.query, modelFamily: req.modelFamily });
    if (scpiRes.ok && Array.isArray(scpiRes.data) && scpiRes.data.length > 0) {
      scpiCommands = scpiRes.data.slice(0, req.limit ?? 5).map((cmd: any) => ({
        id: cmd.commandId || cmd.header || '',
        name: cmd.header || '',
        description: cmd.shortDescription || cmd.description || '',
        category: 'scpi',
        score: 10,
        matchStage: 'smart_scpi',
        syntax: cmd.syntax,
        arguments: cmd.arguments,
        examples: cmd.examples || cmd.codeExamples,
        group: cmd.group,
        commandType: cmd.commandType,
      }));
    }
  } catch { /* non-fatal */ }

  // Secondary: router's own BM25/trigger search for shortcuts and templates
  const engine = getToolSearchEngine();
  const routerHits = await engine.searchCompound(req.query, {
    limit: 3,
    categories: req.categories,
  });
  // Filter DPOJET
  const familyHint = (req.modelFamily || '').toUpperCase();
  const filteredRouterHits = routerHits.filter((hit) => {
    const toolId = (hit.tool.id || '').toLowerCase();
    if (!familyHint.includes('DPO') && toolId.includes('dpojet')) return false;
    return true;
  });
  const routerResults = filteredRouterHits
    .filter((hit) => hit.tool.category === 'shortcut' || hit.tool.category === 'template' || hit.tool.category === 'instrument')
    .map((hit) => serializeHit(hit, req.debug === true));

  // Combine: SCPI commands first, then shortcuts/templates
  const results = [...scpiCommands, ...routerResults];

  // RAG knowledge — only for queries that sound like questions, not SCPI commands
  let knowledge: Array<{ corpus: string; title: string; body: string }> | undefined;
  const isQuestion = /\b(why|how|what|explain|error|fail|timeout|issue|problem|debug)\b/i.test(req.query);
  if (isQuestion) {
    try {
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
    } catch { /* non-fatal */ }
  }

  return {
    ok: true,
    action: 'search',
    results,
    knowledge,
    text: results.length
      ? `Found ${results.length} result(s) for "${req.query}".`
      : `No results for "${req.query}".`,
    durationMs: Date.now() - startedAt,
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

  const engine = getToolSearchEngine();
  const hits = await engine.search(req.query, {
    limit: 1,
    categories: req.categories,
  });

  if (!hits.length) {
    return {
      ok: false,
      action: 'search_exec',
      error: `No tools found for "${req.query}".`,
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
    'TekAutomate instrument automation router. Controls Tektronix oscilloscopes via SCPI commands.\n\n' +
    '## How to use for instrument control:\n\n' +
    '### Step 1: SEARCH for commands\n' +
    'Use action:"search" with a natural language query. The router understands measurement types, ' +
    'trigger types, bus protocols, and oscilloscope concepts.\n\n' +
    'Good search queries (natural language works):\n' +
    '- "add jitter measurement"\n' +
    '- "configure i2c bus decode"\n' +
    '- "setup edge trigger"\n' +
    '- "save screenshot"\n' +
    '- "measure rise time"\n' +
    '- "show detailed results"\n' +
    '- "set channel scale"\n' +
    '- "sampling rate"\n\n' +
    '### Step 2: EXEC the found command\n' +
    'Use action:"exec" with the toolId from search results and appropriate args.\n' +
    '- For SET commands: pass commandType:"set" and value:<the value>\n' +
    '- For QUERY commands: pass commandType:"query"\n' +
    '- For specific channels/sources: pass concreteHeader like "CH1:SCAle" instead of "CH<x>:SCAle"\n\n' +
    '### Common multi-step workflows:\n' +
    '- Add measurement: search "add measurement" → exec ADDMEAS with value, then set SOUrce\n' +
    '- Set channel: search "channel scale" → exec with concreteHeader "CH1:SCAle" and value\n' +
    '- Configure trigger: search "edge trigger" → exec TRIGger:A:LEVel with value\n' +
    '- Bus decode: search "i2c bus" → exec BUS:TYPe, then configure pins\n\n' +
    'Actions: "search", "exec", "search_exec", "build", "create", "update", "delete", "info", "list".',
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
