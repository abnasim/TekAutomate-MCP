# MCP Workflow Apply Plan

## Goal
Move TekAutomate to a text-first AI workflow where:

1. Chat stays conversational and clean.
2. The AI sees current workflow and selected-step context.
3. The AI proposes exact workflow changes in plain `ACTIONS_JSON`.
4. TekAutomate shows its own `Apply to Flow` UI outside ChatKit.
5. MCP validates and normalizes proposed actions before the frontend mutates the workflow.

This keeps tool calls low, reduces agent confusion, and gives us a reusable path for future live-control agents and Electron packaging.

---

## Core Principles

- Keep the tool surface small.
- Prefer one smart MCP tool over many overlapping tools.
- Keep AI tool calls to 1-3 calls for clear build/edit requests.
- Keep chat prose first and machine payload second.
- Keep the frontend responsible for UI.
- Keep MCP responsible for validation, translation, and normalization.

---

## Final Tool Model

### Client tools that stay in the frontend

#### `get_current_workflow`
Purpose:
- Give the AI the current workflow state.
- Include selected step so the AI can target a single step, a group, or the whole flow.

Returns:
- `stepCount`
- `steps`
- `selectedStep`
- `validationErrors`
- `backend`
- `modelFamily`
- `deviceDriver`
- `isEmpty`

Notes:
- This should always provide selected step id when available.
- This is the main context tool for edit/fix/improve requests.

#### `get_instrument_info`
Purpose:
- Give the AI current instrument context only when needed.

Returns:
- `connected`
- `executorUrl`
- `visaResource`
- `backend`
- `modelFamily`
- `deviceDriver`
- `liveMode`

Notes:
- Use only when instrument family or live-mode context matters.

---

## New MCP Tools

We only add **2** new MCP tools.

### 1. `build_or_edit_workflow`

Purpose:
- One high-level proposal tool for:
  - build new flow
  - edit current flow
  - improve current flow
  - fix one step
  - fix a selected group
  - replace or extend the whole flow when appropriate

Input:

```json
{
  "request": "Build a frequency and amplitude measurement workflow for CH1.",
  "currentWorkflow": {
    "stepCount": 4,
    "steps": [],
    "selectedStep": "step_3",
    "validationErrors": [],
    "backend": "pyvisa",
    "modelFamily": "mso_5_series",
    "deviceDriver": "tekscope"
  },
  "instrumentInfo": {
    "connected": true,
    "backend": "pyvisa",
    "modelFamily": "mso_5_series"
  }
}
```

Output:

```json
{
  "summary": "Adds CH1 frequency and amplitude measurements and reads both after a single acquisition.",
  "findings": [
    "Uses a basic edge trigger on CH1.",
    "Selected step was used as an insertion anchor."
  ],
  "suggestedFixes": [],
  "actions": [
    {
      "type": "insert_step_after",
      "targetStepId": "step_3",
      "newStep": {
        "type": "group",
        "label": "CH1 Measurements",
        "params": {},
        "collapsed": false,
        "children": []
      }
    }
  ]
}
```

Behavior:
- If request clearly targets a selected step, prefer exact step-level edits.
- If request clearly targets the whole flow, return whole-flow actions.
- Internally use router/build/verify logic so the AI does not need to chain multiple search tools.
- Return fully normalized action schema for the frontend.

Why this tool exists:
- It replaces a long AI-side chain of search/build/verify decisions.
- It reduces tool chatter and keeps the agent fast.

---

### 2. `prepare_flow_actions`

Purpose:
- Safety gate before apply.
- Validate, normalize, and translate proposed actions using the current workflow.

Input:

```json
{
  "summary": "Adds a screenshot save step after measurement readout.",
  "actions": [
    {
      "type": "insert_step_after",
      "targetStepId": "step_8",
      "newStep": {
        "type": "save_screenshot",
        "label": "Save screenshot",
        "params": {
          "filename": "capture.png"
        }
      }
    }
  ],
  "currentWorkflow": {
    "stepCount": 10,
    "steps": [],
    "selectedStep": "step_8",
    "validationErrors": [],
    "backend": "pyvisa"
  }
}
```

Output:

```json
{
  "ok": true,
  "summary": "Adds a screenshot save step after measurement readout.",
  "warnings": [],
  "errors": [],
  "actions": [
    {
      "type": "insert_step_after",
      "targetStepId": "step_8",
      "newStep": {
        "type": "save_screenshot",
        "label": "Save screenshot",
        "params": {
          "filename": "capture.png"
        }
      }
    }
  ]
}
```

Behavior:
- Normalize variant schemas into one frontend-friendly schema.
- Resolve simple inconsistencies like `newStep` vs `payload.newStep`.
- Reject invalid or unsafe mutations cleanly.
- Return warnings when the apply is valid but non-ideal.

Why this tool exists:
- It prevents the frontend from blindly trusting raw model output.
- It centralizes apply safety in MCP.

---

## AI Usage Rules

### For clear build/edit requests
The AI should make at most:

1. `get_current_workflow` if existing flow context matters
2. `get_instrument_info` only if instrument/model context matters
3. `build_or_edit_workflow`

That is the preferred path.

### The AI should not
- Narrate long internal reasoning.
- Chain `search_scpi` + `smart_scpi_lookup` + `browse` + `verify` for one straightforward request.
- Rebuild the entire flow when a selected-step edit is enough.
- Apply raw action proposals directly.

### AI response format
For build/edit/fix requests:

1. 1-2 short conversational sentences.
2. Plain one-line:

```text
ACTIONS_JSON: {"summary":"...","findings":[],"suggestedFixes":[],"actions":[...]}
```

No HTML.
No `<details>`.
No code fence if avoidable.

---

## Frontend Plan

### Chat rendering
Keep ChatKit text-first.

Do not require widgets for normal workflow proposals.

### Parsed action card
TekAutomate renders its own card outside ChatKit with:
- summary
- findings count
- suggestion count
- change count
- `Apply to Flow`
- `Hide`

### Apply button behavior
When user clicks `Apply to Flow`:

1. Send parsed `summary + actions + currentWorkflow` to `prepare_flow_actions`
2. Receive normalized actions
3. Apply normalized actions with existing frontend apply logic
4. Show success or warning state

### Auto-apply behavior
Auto-apply uses the exact same path:

1. parse
2. `prepare_flow_actions`
3. apply returned actions

This avoids a split between manual and automatic behavior.

---

## Prompt and Instruction Updates

The prompt must change along with the MCP/apply pipeline. Otherwise the agent will
keep behaving like a research assistant instead of a fast workflow builder/editor.

### Prompt goals
- Keep responses text-first and human-readable.
- Minimize tool calls.
- Avoid narrated internal reasoning.
- Prefer one smart workflow tool over multiple SCPI search calls.
- Make selected-step editing explicit.
- Treat MCP as the validation/normalization layer before apply.

### Add these behavior rules
- For clear build/edit/fix requests, do not explain your search process.
- Use one high-level workflow build/edit tool when possible.
- Do not narrate uncertainty unless blocked.
- If a proposal is good enough to apply, return it immediately.
- Keep prose before `ACTIONS_JSON:` to 1-2 short sentences.
- Never describe internal tool-selection reasoning.
- Only call `get_current_workflow` when current flow structure matters.
- Only call `get_instrument_info` when instrument/model context matters.
- Prefer targeted edits to the selected step when the user is clearly editing local context.

### Remove or weaken these behaviors
- Long “Thinking...” / narrated planning behavior for simple requests
- Multi-tool SCPI research for straightforward build requests
- Over-verification in the visible answer path
- Widget-first behavior for normal workflow suggestions

### Preferred agent flow for build/edit requests
1. If needed, call `get_current_workflow`
2. If needed, call `get_instrument_info`
3. Call `build_or_edit_workflow`
4. Return:
   - 1-2 short conversational sentences
   - plain `ACTIONS_JSON: {...}`

### Prompt examples to encode

#### Good behavior
- “Build a frequency and amplitude measurement workflow for CH1.”
  - maybe `get_current_workflow`
  - call `build_or_edit_workflow`
  - return short prose + `ACTIONS_JSON`

- “Fix this selected step.”
  - call `get_current_workflow`
  - call `build_or_edit_workflow`
  - return targeted actions for the selected step

#### Bad behavior
- chaining `search_scpi` + `smart_scpi_lookup` + `browse` + `verify` for a simple build
- narrating internal tool choice or uncertainty for 20-30 seconds
- returning widget/schema-shaped output for ordinary text replies

### Files to update
- Agent Builder instructions
- MCP system prompt files where workflow-building behavior is described
- Any local frontend/system prompt text that still pushes widget-first output

---

## Selected Step Semantics

Selected step is important and should remain first-class.

### Rules
- If the user asks to fix "this step", "selected step", or something clearly local, use `selectedStep`.
- If the user asks to insert after current context, prefer `insert_step_after` anchored to `selectedStep`.
- If the user asks to refactor the whole flow, allow whole-flow actions.

### MCP behavior
`build_or_edit_workflow` and `prepare_flow_actions` should both see:
- full current workflow
- selected step id

This lets MCP enforce:
- exact step edits
- exact insert positions
- safe whole-flow changes

---

## Why This Architecture Is Better

- Fewer tools
- Lower tool-call count
- Less AI confusion
- Faster response time
- Cleaner chat
- Safer applies
- Reusable for future live-agent work
- Easy to keep in Electron later because UI and apply pipeline stay app-owned

---

## Rollout Order

### Phase 1
- Finalize prompt and text-first response format
- Stop relying on widgets for normal flow proposals
- Keep current TekAutomate-owned parsed action card
- Update prompts/instructions so the agent uses the minimal-tool workflow path

### Phase 2
- Implement `build_or_edit_workflow`
- Route clear build/edit requests through it

### Phase 3
- Implement `prepare_flow_actions`
- Route all manual apply and auto-apply through it

### Phase 4
- Tighten prompt instructions:
  - no narrated reasoning
  - max 2-3 tool calls
  - use current workflow and selected step intelligently

### Phase 5
- Optionally add apply-confirmation context back into chat
- Optionally add richer MCP-side summaries or warnings

---

## Success Criteria

- Normal advice questions remain natural and text-first
- Clear build/edit requests do not take 20-30 seconds of narrated reasoning
- AI usually uses 1-3 tool calls
- Step-targeted edits are accurate
- `Apply to Flow` always goes through MCP normalization
- Auto-apply and manual apply share the same validation path
- ChatKit is used as conversation UI, not as the source of truth for structured flow behavior
