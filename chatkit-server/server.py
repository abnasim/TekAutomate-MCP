"""
TekAutomate Self-Hosted ChatKit Server

Runs alongside the MCP server on Railway. Gives us:
- stream_widget for Apply Flow cards (no raw JSON in chat)
- HiddenContextItem for ACTIONS_JSON data
- Full control over thread rendering
- Client tool execution (send_scpi, capture_screenshot)

Architecture:
  ChatKit UI (browser) ←→ This server (Railway) ←→ OpenAI APIs
                                    ↕
                            MCP Server (Railway) — SCPI knowledge tools
"""

import json
import os
import re
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from openai_chatkit import (
    ChatKitServer,
    Event,
    ThreadMetadata,
    UserMessageItem,
    ClientToolCallOutputItem,
    HiddenContextItem,
    stream_agent_response,
    stream_widget,
    SQLiteStore,
)
from openai_chatkit.widgets import Card, Col, Row, Text, Title, Badge, Button, Divider, Spacer, Icon

from openai.agents import Agent, Runner, hostedMcpTool, RunContextWrapper

load_dotenv()

# ── Config ──
MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "https://tekautomate-mcp-production.up.railway.app/mcp")
PORT = int(os.environ.get("PORT", 8800))

# ── Agent prompt (same as docs/agent-builder-prompt.md) ──
AGENT_INSTRUCTIONS = """# TekAutomate AI Chat Assistant
You are a senior Tektronix test automation engineer inside TekAutomate.
Help the user reason about instruments, measurements, debugging, setup strategy, tm_devices usage, SCPI concepts, and practical lab decisions.

## Your MCP Tools — USE THESE, never guess
You have direct access to TekAutomate's SCPI knowledge base via MCP tools.
ALWAYS use these for SCPI command lookup. Do NOT guess from memory.

### Direct tools (simple flat schemas):
- **search_scpi** — fuzzy search by feature/keyword
- **smart_scpi_lookup** — natural language question
- **get_command_by_header** — exact lookup when you know the header
- **browse_scpi_commands** — 3-level drill-down
- **verify_scpi_commands** — validate commands before returning
- **get_template_examples** — find workflow templates

### Power gateway:
- **tek_router** — build workflows, materialize commands, save/learn shortcuts

## Tool Priority
1. search_scpi / browse_scpi_commands — FIRST
2. get_command_by_header — exact syntax + valid values
3. verify_scpi_commands — ALWAYS verify before returning
4. tek_router — for build/materialize/save

## Response style
- Conversational, concise, practical. Engineer to engineer.
- Use **bold** for emphasis and `code` for SCPI commands.
- End with clear next step: "Want me to build this?" or "Which approach?"

## Build requests
- Short outline of what the flow does, then "say **build it**".
- Build immediately when clear. Max 1 clarifying question.

## ACTIONS_JSON
When building a flow, output ACTIONS_JSON as a JSON object with:
- summary, findings, suggestedFixes, actions array
- Use insert_step_after with groups for existing flows
- Use replace_flow for empty flows
- Always verify commands before including them
- Do NOT wrap in markdown code fences — output raw JSON only after "ACTIONS_JSON:"

## Flow Structure
- connect at start, disconnect at end (unless inserting into existing flow)
- Group related steps: Trigger Setup, Measurement, Results, Save
- Use *OPC? to wait for operations, not sleep
- error_check after critical sequences

## Valid Step Types
connect, disconnect, write, query, set_and_query, sleep, comment, python,
save_waveform, save_screenshot, error_check, group, recall, tm_device_command

## Command Language
- Canonical mnemonics: CH1, B1, MATH1, MEAS1 — never CHAN1, BUS1
- SCPI: colon-separated headers, space before args, no colon before star commands
"""


# ── MCP Tools ──
mcp_tools = hostedMcpTool(
    server_label="TekAutomateMCP",
    server_url=MCP_SERVER_URL,
    allowed_tools=[
        "tek_router",
        "search_scpi",
        "smart_scpi_lookup",
        "get_command_by_header",
        "verify_scpi_commands",
        "browse_scpi_commands",
        "get_template_examples",
    ],
    require_approval="never",
)


# ── Agent context ──
class AgentContext:
    def __init__(self, thread: ThreadMetadata, store: Any, request_context: Any = None):
        self.thread = thread
        self.store = store
        self.request_context = request_context
        self.client_tool_call = None


# ── ACTIONS_JSON detection + widget rendering ──
ACTIONS_JSON_RE = re.compile(r'ACTIONS_JSON:\s*(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*?\][\s\S]*?\})')


def parse_actions_json(text: str) -> dict | None:
    """Extract ACTIONS_JSON from agent response text."""
    match = ACTIONS_JSON_RE.search(text)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def build_apply_flow_widget(actions_data: dict) -> Card:
    """Build the Apply Flow widget card from parsed ACTIONS_JSON."""
    summary = actions_data.get("summary", "Flow ready to apply")
    findings = actions_data.get("findings", [])
    actions = actions_data.get("actions", [])

    # Count total steps across all actions
    step_count = 0
    step_previews = []
    for action in actions:
        new_step = action.get("newStep") or action.get("payload", {}).get("flow", {}).get("steps", [{}])[0] or {}
        children = new_step.get("children", [])
        if children:
            for child in children[:8]:  # Cap preview at 8
                step_type = child.get("type", "step")
                label = child.get("label", step_type)
                step_previews.append({"type": step_type, "label": label})
            step_count += len(children)
        elif new_step.get("type"):
            step_previews.append({"type": new_step["type"], "label": new_step.get("label", new_step["type"])})
            step_count += 1
        # For replace_flow, count all steps
        if action.get("type") == "replace_flow":
            flow_steps = action.get("payload", {}).get("flow", {}).get("steps", [])
            step_count = len(flow_steps)
            step_previews = [
                {"type": s.get("type", "step"), "label": s.get("label", s.get("type", "step"))}
                for s in flow_steps[:8]
            ]

    # Build widget children
    children = [
        Row(children=[
            Title(id="summary", value=summary[:80]),
            Spacer(),
            Badge(id="count", label=f"{step_count} step{'s' if step_count != 1 else ''}", color="info"),
        ]),
    ]

    # Step list
    if step_previews:
        step_rows = []
        for sp in step_previews:
            step_rows.append(
                Row(children=[
                    Badge(id=f"type-{sp['label']}", label=sp["type"], color="info"),
                    Text(id=f"label-{sp['label']}", value=sp["label"], size="sm"),
                ], gap=2, align="center")
            )
        children.append(Divider())
        children.append(Col(children=step_rows, gap=2))

    # Findings
    if findings:
        finding_rows = [
            Row(children=[
                Icon(name="info", color="warning"),
                Text(id=f"finding-{i}", value=f[:100], size="sm", color="secondary"),
            ], gap=2, align="center")
            for i, f in enumerate(findings[:3])
        ]
        children.append(Divider())
        children.append(Col(children=[
            Row(children=[
                Icon(name="info", color="warning"),
                Text(id="findings-label", value="Findings", size="sm", color="warning", weight="semibold"),
            ], gap=2, align="center"),
            *finding_rows,
        ], gap=2))

    return Card(
        size="sm",
        confirm={"label": "Apply to Flow", "action": {"type": "flow.apply", "payload": {"actions": actions, "summary": summary}}},
        cancel={"label": "Dismiss", "action": {"type": "flow.dismiss"}},
        children=children,
    )


# ── ChatKit Server ──
class TekAutomateChatKitServer(ChatKitServer):
    def __init__(self, data_store):
        super().__init__(data_store)

    # The agent definition
    builder_agent = Agent(
        model="gpt-4.1",
        name="TekAuotmate_Builder",
        instructions=AGENT_INSTRUCTIONS,
        tools=[mcp_tools],
        model_settings={
            "reasoning": {"effort": "high", "summary": "auto"},
            "store": True,
        },
    )

    async def respond(
        self,
        thread: ThreadMetadata,
        input: UserMessageItem | ClientToolCallOutputItem,
        context: Any,
    ) -> AsyncIterator[Event]:
        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        # Run the agent
        result = Runner.run_streamed(
            self.builder_agent,
            input,
            context=agent_context,
        )

        # Collect the full response text to check for ACTIONS_JSON
        full_text = ""
        events = []
        async for event in stream_agent_response(agent_context, result):
            events.append(event)
            # Try to extract text from events
            if hasattr(event, "data") and isinstance(event.data, dict):
                text = event.data.get("text", "")
                if text:
                    full_text += text

        # Yield all agent response events
        for event in events:
            yield event

        # Check if response contains ACTIONS_JSON — render widget
        actions_data = parse_actions_json(full_text)
        if actions_data and actions_data.get("actions"):
            widget = build_apply_flow_widget(actions_data)
            async for event in stream_widget(
                thread,
                widget,
                generate_id=lambda item_type: self.store.generate_item_id(item_type, thread, context),
            ):
                yield event

            # Also inject the raw actions as hidden context for the thread
            yield HiddenContextItem(
                data={"actions_json": actions_data},
                metadata={"type": "actions_json", "summary": actions_data.get("summary", "")},
            )


# ── FastAPI app ──
app = FastAPI(title="TekAutomate ChatKit Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

data_store = SQLiteStore()
server = TekAutomateChatKitServer(data_store)


@app.post("/chatkit")
async def chatkit_endpoint(request: Request):
    body = await request.body()
    result = await server.process(body, {})
    if hasattr(result, "__aiter__"):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json if hasattr(result, "json") else str(result), media_type="application/json")


@app.get("/health")
async def health():
    return {"ok": True, "service": "tekautomate-chatkit-server"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
