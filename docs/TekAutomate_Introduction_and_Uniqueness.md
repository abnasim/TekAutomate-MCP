# TekAutomate — Introduction and What Makes It Unique

**Purpose:** Introduction to the tool, its features, and what sets it apart. For internal use and legal/reporting context.

---

## What Is TekAutomate?

TekAutomate is an automation authoring environment for **Tektronix and Keithley** test and measurement instruments. Users build workflows that control oscilloscopes, power supplies, SMUs, DMMs, arbitrary function generators, and related hardware (including TekExpress). The tool then **exports runnable Python scripts** that use the correct drivers and connection settings, so teams can automate tests without writing Python or SCPI by hand.

---

## How It Works

Users create automation in one of two ways:

- **Steps Builder** — A linear, step-based interface: add steps (connect, SCPI write/query, wait, save waveform, custom Python, etc.) in order, with device binding and parameters.
- **Blockly Builder** — A block-based workflow editor: drag-and-drop blocks for the same actions (connect, SCPI, loops, variables, multi-device), with blocks representing commands and control flow.

Workflows can be **converted both ways** between Steps Builder and Blockly Builder (import from Steps into Blockly, or export from Blockly to Steps), so teams can choose the style that fits and keep one workflow.

When the workflow is ready, the user **exports to Python**. The generated script uses the right connection type (TCP/IP, Socket, USB, GPIB), the right backend per device (see below), and proper cleanup and error handling.

---

## Key Features

- **Multi-device workflows** — One workflow can reference multiple instruments (e.g., scope, PSU, DMM). Each step or block is bound to a device; generated Python uses separate connections and variables per device (e.g., `scope`, `psu`, `dmm`).
- **Multiple backends** — The tool generates Python that uses the appropriate driver per instrument:
  - **PyVISA** — Standard SCPI over VISA (TCP/IP, USB, GPIB, Socket).
  - **tm_devices** — Tektronix/Keithley Python framework (high-level APIs, validation).
  - **TekHSI** — Tektronix high-speed interface (e.g., waveform transfer).
  - **VXI-11** — Direct TCP/IP control without VISA (e.g., Linux).
- **Hybrid (mixed-backend) operation** — Hybrid is not a fifth backend. It is a **mode** where the same workflow uses **more than one backend** (e.g., SCPI via PyVISA and waveform capture via TekHSI). The tool routes each command type to the correct backend in the generated code.
- **Bidirectional Steps ↔ Blockly** — Convert existing step-based workflows into blocks and back, so content is not locked to one editor.
- **Export to runnable Python** — One-click export to a Python script that runs with the chosen backends, device variables, and structure (connections, try/except, cleanup).
- **Command libraries** — Built-in browseable command sets (SCPI, tm_devices-style commands, TekExpress, etc.) so users can discover and insert commands without memorizing manuals.
- **TekAcademy** — In-app guidance (connection setup, backend choice, workflows, best practices) so help is inside the tool.
- **Optional AI-assisted workflow** — Workflows (e.g., Blockly XML) can be copied into a custom GPT for verification, enhancement, or conversion; the result can be re-imported into the tool.

---

## What Makes TekAutomate Unique

- **Single authoring environment for Tektronix and Keithley** that supports multiple backends and hybrid (mixed-backend) use in one workflow, with export to a single runnable Python script.
- **Two authoring modes that stay in sync:** step-based (Steps Builder) and block-based (Blockly Builder), with conversion both ways so the same workflow can be edited in either form.
- **Block-based authoring in T&M instrument automation** — Blockly (open-source, by Google) is widely used in education and other domains, but **not** in professional test and measurement instrument automation for Tektronix/Keithley. TekAutomate applies a block-based, drag-and-drop workflow builder to this space: users build automation by connecting blocks (connect, SCPI write/query, loops, variables, device context) and export to Python. The novelty is the **application and integration** (block-based authoring + T&M + multi-backend + Python export + in-app Academy + optional GPT round-trip), not the Blockly library itself. Any patent considerations would focus on this **combination and system**, not on Blockly.
- **Multi-backend and hybrid in the same workflow** — Choosing and mixing PyVISA, tm_devices, TekHSI, and VXI-11 per device or per command type, with correct routing in generated code, is built into the tool rather than left to the user.
- **Integrated TekAcademy** — Guidance (connection, backends, workflows) lives inside the same application used to build and export automation.
- **TekExpress modeled as SCPI-over-socket** in the same framework, with generated PyVISA SOCKET code instead of raw socket scripting.

---

## Technical Snapshot

- **Delivery:** Web app (e.g., http://dev.tek.com/TekAutomate); can be packaged as a desktop application via Electron.
- **Stack:** React, TypeScript, Blockly, CodeMirror. Python is generated on the client; no separate code-generation server.
- **Connection types:** TCP/IP (VXI-11), Socket, USB, GPIB, with per-device backend and optional hybrid mode in generated Python.

---

## Who It’s For and Typical Uses

- **Users:** Test and validation engineers, R&D engineers, researchers, educators, and application/support engineers who need to automate Tektronix and Keithley instruments without hand-writing Python or SCPI.
- **Typical scenarios:** Repetitive test sequences, multi-instrument setups (e.g., scope + PSU + DMM/SMU), FastFrame or FastAcq with analysis, TekExpress-related workflows, training and demos, and sharing workflows (e.g., XML/JSON) while regenerating Python as needed.

---

## One-Sentence Summary

TekAutomate is an automation authoring environment for Tektronix and Keithley instruments that offers Steps Builder and Blockly Builder (with bidirectional conversion), supports multiple backends and hybrid (mixed-backend) operation, exports runnable Python, includes integrated TekAcademy, and optionally works with an AI-assisted round-trip via a custom GPT—with block-based authoring applied in the T&M instrument automation space for the first time in this form.

---

*Document focuses on TekAutomate’s features and uniqueness. Terminology: Steps Builder and Blockly Builder only; hybrid is a mixture of backends, not a backend.*
