---
name: scope-search
description: Search the SCPI command database
---

Search for SCPI commands matching the user's query:

1. Use `search_scpi` with the user's query for fast keyword matching
2. If results are too broad, use `browse_scpi_commands` to drill down by group
3. For exact syntax, use `get_command_by_header` on a specific header
4. Present results clearly: header, type (set/query/both), and short description

This is a read-only search — no commands are sent to any instrument.
