# MCP Server Quick-Fix Implementation Guide

## Priority 1: Apply These Fixes IMMEDIATELY (Critical Bugs)

### Fix 1: Initialize Indexes Before Starting HTTP Server
**File:** `src/server.ts`  
**Lines:** 185-207

```typescript
// BEFORE (BUGGY):
export async function createServer(port = 8787): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    await Promise.all([
      initCommandIndex(),
      initTmDevicesIndex(),
      // ...initialization inside request handler = BUG
    ]);
    // ...handle request...
  });
  
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

// AFTER (FIXED):
export async function createServer(port = 8787): Promise<http.Server> {
  // INITIALIZE FIRST, before HTTP server
  const startInit = Date.now();
  
  const results = await Promise.allSettled([
    initCommandIndex(),
    initTmDevicesIndex(),
    initRagIndexes(),
    initTemplateIndex(),
    ...(providerSupplementsEnabled() ? [initProviderCatalog()] : []),
  ]);
  
  // Check for failures
  const failures = results
    .map((r, i) => r.status === 'rejected' ? { index: i, error: r.reason } : null)
    .filter(Boolean);
  
  if (failures.length > 0) {
    const names = ['CommandIndex', 'TmDevicesIndex', 'RagIndexes', 'TemplateIndex', 'ProviderCatalog'];
    throw new Error(`Initialization failed: ${failures.map(f => names[f.index]).join(', ')}`);
  }
  
  console.log(`✅ All indexes initialized in ${Date.now() - startInit}ms`);
  
  // NOW create the HTTP server (but don't start listening yet)
  const server = http.createServer(async (req, res) => {
    // All indexes are ready - can safely use them
    // ...existing request handlers...
  });
  
  // Start listening
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`🚀 MCP Server ready on http://localhost:${port}`);
      resolve(server);
    });
    
    server.on('error', (error) => {
      console.error('Server startup failed:', error);
      reject(error);
    });
  });
}
```

**Testing:**
```bash
# Should NOT get "index not initialized" errors
curl http://localhost:8787/health
curl -X POST http://localhost:8787/ai/chat -d '...'
```

---

### Fix 2: Clear Semantic Index Memory Properly
**File:** `src/core/semanticSearch.ts`  
**Lines:** 62-85

```typescript
// BEFORE (BUGGY):
async prepareIndex(tools: MicroTool[]): Promise<boolean> {
  if (!this.enabled) return false;
  if (!tools.length) {
    this.toolIds = [];
    this.toolIdSet = new Set();
    // Old matrix NOT cleared = MEMORY LEAK
    return true;
  }
  // ...
}

// AFTER (FIXED):
async prepareIndex(tools: MicroTool[]): Promise<boolean> {
  if (!this.enabled) return false;
  
  try {
    // ALWAYS clear old data first
    this.matrix = new Float32Array(0);
    this.norms = new Float32Array(0);
    this.toolIds = [];
    this.toolIdSet.clear();
    this.dimensions = 0;
    this.indexedAt = 0;
    
    if (!tools.length) {
      return true;  // Cleared successfully
    }

    const texts = tools.map((tool) => 
      [tool.name, tool.description, ...tool.tags, ...tool.triggers].join(' ')
    );
    const vectors = await this.provider.embed(texts);
    
    if (!vectors.length) {
      console.warn('[SemanticSearch] Empty embedding result');
      return false;
    }

    const dimensions = vectors[0].length;
    const matrixSize = vectors.length * dimensions;
    const matrix = new Float32Array(matrixSize);
    const norms = new Float32Array(vectors.length);

    for (let i = 0; i < vectors.length; i += 1) {
      const vector = vectors[i];
      for (let j = 0; j < dimensions; j += 1) {
        matrix[i * dimensions + j] = vector[j];
      }
      
      let norm = 0;
      for (let j = 0; j < dimensions; j += 1) {
        norm += vector[j] * vector[j];
      }
      norms[i] = Math.sqrt(norm);
    }

    this.matrix = matrix;
    this.norms = norms;
    this.toolIds = tools.map((t) => t.id);
    this.toolIdSet = new Set(this.toolIds);
    this.dimensions = dimensions;
    this.indexedAt = Date.now();

    return true;
  } catch (error) {
    console.error('[SemanticSearch] Index preparation failed:', error);
    
    // IMPORTANT: Clean up on error
    this.matrix = new Float32Array(0);
    this.norms = new Float32Array(0);
    this.toolIds = [];
    this.toolIdSet.clear();
    this.dimensions = 0;
    
    return false;
  }
}
```

**Testing:**
```bash
# Monitor memory while reloading providers
# (Should not continuously grow)
```

---

### Fix 3: Handle Dynamic Import Errors
**File:** `src/core/toolLoop.ts`  
**Lines:** 155-190

```typescript
// BEFORE (BUGGY):
async function runSmartScpiAssistant(req: McpChatRequest) {
  const { smartScpiLookup } = await import('./smartScpiAssistant');  // Can fail, no catch
  
  try {
    const toolResult = await smartScpiLookup({
      query: req.userMessage,
      modelFamily: req.flowContext.modelFamily,
      context: `${req.flowContext.deviceType || 'SCOPE'} ${req.flowContext.backend || 'pyvisa'}`
    });
    // ...
  } catch (error) {
    // import error already happened above, won't be caught here
  }
}

// AFTER (FIXED):
async function runSmartScpiAssistant(req: McpChatRequest) {
  try {
    // Import with try/catch
    let smartScpiLookup: any;
    try {
      const module = await import('./smartScpiAssistant');
      smartScpiLookup = module.smartScpiLookup;
    } catch (importError) {
      throw new Error(`Failed to load SmartScpiAssistant: ${
        importError instanceof Error ? importError.message : String(importError)
      }`);
    }
    
    if (!smartScpiLookup) {
      throw new Error('smartScpiLookup function not found in module');
    }
    
    const toolResult = await smartScpiLookup({
      query: req.userMessage,
      modelFamily: req.flowContext.modelFamily,
      context: `${req.flowContext.deviceType || 'SCOPE'} ${req.flowContext.backend || 'pyvisa'}`
    });

    if (!toolResult) {
      throw new Error('smartScpiLookup returned no result');
    }

    return {
      text: toolResult.conversationalPrompt || '',
      assistantThreadId: undefined,
      errors: [],
      warnings: [],
      metrics: {
        totalMs: 0,
        usedShortcut: true,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 }
      },
      debug: {
        toolTrace: [],
        resolutionPath: 'smart_scpi:success'
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SMART_SCPI] Error:', errorMessage);
    
    return {
      text: `Smart SCPI Assistant error: ${errorMessage}`,
      assistantThreadId: undefined,
      errors: [errorMessage],
      warnings: [],
      metrics: {
        totalMs: 0,
        usedShortcut: false,
        iterations: 0,
        toolCalls: 0,
        toolMs: 0,
        modelMs: 0,
        promptChars: { system: 0, user: 0 }
      },
      debug: {
        toolTrace: [],
        resolutionPath: 'smart_scpi:error'
      }
    };
  }
}
```

---

### Fix 4: Robust ACTIONS_JSON Extraction
**File:** `src/server.ts`  
**Lines:** 76-98

```typescript
// BEFORE (BUGGY):
function extractActionsJson(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/ACTIONS_JSON:\s*```json\s*/gi, 'ACTIONS_JSON: ')
    .replace(/```/g, '');  // Too aggressive, removes all backticks
  const match = cleaned.match(/ACTIONS_JSON:\s*(\{[\s\S]*\})/);  // Greedy, matches to last }
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;  // Silent failure
  }
}

// AFTER (FIXED):
function extractActionsJson(text: string): Record<string, unknown> | null {
  try {
    // Step 1: Find ACTIONS_JSON marker
    const actionJsonMatch = text.match(/ACTIONS_JSON:\s*/i);
    if (!actionJsonMatch) {
      return null;  // No ACTIONS_JSON marker
    }

    // Step 2: Start from marker position
    const startIdx = actionJsonMatch.index! + actionJsonMatch[0].length;
    let jsonText = text.substring(startIdx).trim();

    // Step 3: Remove code block markers if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.substring('```json'.length);
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.substring('```'.length);
    }

    // Step 4: Find matching braces (non-greedy: find first complete JSON object)
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonText.length; i += 1) {
      const ch = jsonText[i];
      if (ch === '{') braceCount += 1;
      else if (ch === '}') {
        braceCount -= 1;
        if (braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    if (endIdx === -1) {
      console.warn('[POST_CHECK] Could not find complete JSON object in ACTIONS_JSON');
      return null;
    }

    // Step 5: Parse the JSON
    const jsonStr = jsonText.substring(0, endIdx);
    const parsed = JSON.parse(jsonStr);

    // Step 6: Validate structure (should be object)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.warn('[POST_CHECK] ACTIONS_JSON is not an object:', typeof parsed);
      return null;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn('[POST_CHECK] Invalid JSON in ACTIONS_JSON:', error.message);
    } else {
      console.warn('[POST_CHECK] Error parsing ACTIONS_JSON:', error);
    }
    return null;
  }
}
```

**Testing:**
```typescript
const tests = [
  { input: 'ACTIONS_JSON: { "actions": [] }', expected: { actions: [] } },
  { input: 'ACTIONS_JSON: ```json\n{ "actions": [] }\n```', expected: { actions: [] } },
  { input: 'ACTIONS_JSON: { "actions": [] } extra text', expected: { actions: [] } },
  { input: 'no json here', expected: null },
];

for (const test of tests) {
  const result = extractActionsJson(test.input);
  console.assert(JSON.stringify(result) === JSON.stringify(test.expected), test.input);
}
```

---

### Fix 5: Router Health Endpoint Validation
**File:** `src/server.ts`  
**Lines:** ~225

```typescript
// BEFORE (BUGGY):
if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true' && 
    req.method === 'GET' && req.url === '/ai/router/health') {
  sendJson(res, 200, getRouterHealth());  // May be undefined → bad JSON
  return;
}

// AFTER (FIXED):
if (String(process.env.MCP_ROUTER_ENABLED || '').trim() === 'true' && 
    req.method === 'GET' && req.url === '/ai/router/health') {
  const health = getRouterHealth();
  
  if (!health) {
    sendJson(res, 503, {
      ok: false,
      status: 'initializing',
      message: 'Router still initializing'
    });
  } else {
    sendJson(res, 200, health);
  }
  return;
}
```

---

## Priority 2: Apply These Fixes NEXT (High-Priority Bugs)

### Quick Fixes for HIGH Severity Issues

**BUG-006: SmartScpiAssistant Empty Pool Fallback**
```typescript
// Add proper warning
if (pool.length === 0 && groups.length > 0) {
  console.warn(`[SmartScpiAssistant] WARNING: No commands in groups [${groups.join(', ')}]. Using full corpus fallback.`);
  // Should return warning in response
}
```

**BUG-008: Tool Registry Partial Registration**
```typescript
// Always unregister old version first
register(tool: MicroTool): void {
  // ... validation ...
  
  // IMPORTANT: Clean old version completely
  this.unregister(tool.id);
  
  // Then register new (if it fails, old is cleaned)
  this.tools.set(tool.id, tool);
  // ... rest of registration
}
```

**BUG-009: Command Index Duplicate Results**
```typescript
// Use Set for deduplication
const resultMap = new Map<string, CommandRecord>();

for (const variant of variants) {
  const hits = index.search(variant);
  for (const hit of hits) {
    if (!resultMap.has(hit.commandId)) {
      resultMap.set(hit.commandId, hit);
    }
    if (resultMap.size >= limit) break;
  }
  if (resultMap.size >= limit) break;
}

return Array.from(resultMap.values()).slice(0, limit);
```

---

## Validation Checklist

After applying all fixes:

- [ ] Start server: `npm start` - should complete without initialization errors
- [ ] Test health: `curl http://localhost:8787/health` - returns 200
- [ ] Test chat: `curl -X POST http://localhost:8787/ai/chat -d '{...}'` - responds properly
- [ ] Memory test: Monitor /proc/meminfo or Task Manager for 10 minutes - should be stable
- [ ] Error handling: Break a module and try request - should return error response, not crash
- [ ] JSON parsing: Send malformed ACTIONS_JSON - should handle gracefully
- [ ] Router health: `curl http://localhost:8787/ai/router/health` - returns valid JSON in all states

---

## Rollout Strategy

1. **Test Environment:** Apply all fixes to test server, run for 24 hours
2. **Staging:** Deploy to staging, run full test suite + load test
3. **Production:** Deploy during low-traffic window, monitor error logs for 2 hours
4. **Rollback Plan:** Keep previous version available, monitor for new errors

---

## Additional Recommendations

### Add Monitoring
```typescript
// Track initialization health
setInterval(() => {
  const health = {
    timestamp: new Date().toISOString(),
    commandIndexReady: getCommandIndex() !== null,
    tmDevicesReady: getTmDevicesIndex() !== null,
    ragIndexesReady: getRagIndexes() !== null,
    templateIndexReady: getTemplateIndex() !== null,
    memoryUsage: process.memoryUsage(),
  };
  
  console.log('[HEALTH]', JSON.stringify(health));
}, 60000);  // Every minute
```

### Add Comprehensive Logging
```typescript
// Wrap critical operations
async function withTiming(name: string, fn: () => Promise<any>) {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[${name}] ✅ Completed in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.error(`[${name}] ❌ Failed after ${Date.now() - start}ms:`, error);
    throw error;
  }
}

// Usage:
await withTiming('CommandIndex.init', () => initCommandIndex());
```

---

## Files to Modify

1. `src/server.ts` - Lines: 185-207, 76-98, ~225
2. `src/core/semanticSearch.ts` - Lines: 62-85
3. `src/core/toolLoop.ts` - Lines: 155-190
4. (Optional) Add monitoring/logging utilities

**Estimated Implementation Time:** 2-3 hours  
**Testing Time:** 2-4 hours  
**Total:** Half-day effort
