#!/usr/bin/env python3
"""
Spot fix v2: Targeted cleanup of known contamination in SCPI JSON files.

This script:
1. Scans _manualEntry.syntax (dict) for foreign query/set fields
2. Scans _manualEntry.code[] for bad examples (nested codeExamples.scpi.code)
3. Scans top-level syntax[] and examples[] for foreign/bad entries
4. Extracts orphaned commands from PDFs and adds them as new entries
5. Reports everything clearly
"""
import json, re, sys, os, shutil
from pathlib import Path
from collections import defaultdict

# ─── Helpers ───

def get_base(scpi: str) -> str:
    """Get the base SCPI path without args, ?, or placeholders."""
    return scpi.split()[0].split("{")[0].rstrip("?").strip().upper()

def is_foreign_to(entry_scpi: str, host_base: str) -> bool:
    """Check if a syntax entry is foreign to the host command."""
    entry_base = get_base(entry_scpi)
    if not entry_base or not host_base:
        return False
    if host_base.startswith("*"):
        # Star commands: anything with a colon is foreign
        return ":" in entry_base
    # Normal commands: foreign if it doesn't start with the host path
    return not entry_base.startswith(host_base)

BAD_STARTS = [
    "this command", "this query", "sets or", "the command", "the query",
    "indicating", "return ", "queries", "available", "turns the",
    "returns the", "when ", "each ", "before ", "use ", "if ", "in order",
    "although", "for most", "the following", "table continued", "default setup",
    "status ", "event ", "command error", "execution error", "device error",
    "internal warning", "no event", "output queue", "enable registers",
    "records whether", "reading the", "the instrument", "the acquisition",
    "the controller", "the program", "the same", "the search", "the *",
    "handle a", "here are", "the standard", "the service", "the event",
    "the status", "ieee", "ascii", "backus", "controller", "equivalent-time",
    "real-time sampling", "serial poll", "teksecure", "various commands",
    "you can", "sending", "setting the", "/* ", "while ", "wait for",
    "reference waveforms", "example of", "x x x x", "bus config",
    "coupling,", "display:", "display:waveview", "measurement view",
    "might return", "8 channels for", "pulse statistics",
]

def is_bad_example(code: str) -> bool:
    """Check if a code/scpi string is bad (English text, not actual SCPI)."""
    if not code or not isinstance(code, str):
        return False
    code = code.strip()
    if len(code) < 4:
        return True
    low = code.lower()
    # Starts with known English patterns
    for prefix in BAD_STARTS:
        if low.startswith(prefix):
            return True
    # Starts with lowercase
    if code[0].islower():
        return True
    # No colon and doesn't start with * — probably not SCPI
    if ":" not in code and not code.startswith("*") and not code.startswith("DESE") and not code.startswith("ALIAS"):
        # Some valid commands don't have colons (AUTOSET, HEADER, etc.)
        # But most English text also doesn't have colons
        # Check if it looks like a known no-colon command
        first_word = code.split()[0].upper()
        known_no_colon = {"AUTOSET", "HEADER", "VERBOSE", "LOCK", "UNLOCK", "REM", "NEWPASS", "PASSWORD", "DVM", "TRIGGER", "DATA", "CURVE"}
        if first_word not in known_no_colon:
            return True
    # Measurement values: "23.45 dB.", "-29.1 dBm.", "5.0 us."
    if re.match(r'^-?[\d.]+\s*(dB|dBm|V|mV|Hz|kHz|MHz|GHz|us|ms|ns|ps|s|K|%)\b', code):
        return True
    return False

def extract_code_from_me_entry(entry) -> str:
    """Extract the actual code string from a _manualEntry code/examples entry."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        # Try direct scpi/code fields
        for key in ["scpi", "code"]:
            if key in entry and isinstance(entry[key], str):
                return entry[key]
        # Try nested codeExamples.scpi.code
        ce = entry.get("codeExamples", {})
        if isinstance(ce, dict):
            scpi_obj = ce.get("scpi", {})
            if isinstance(scpi_obj, dict):
                return scpi_obj.get("code", "")
            if isinstance(scpi_obj, str):
                return scpi_obj
    return ""


# ─── Main processing ───

def process_file(json_path: str, pdf_cache_path: str = None):
    print(f"\n{'='*70}")
    print(f"Processing: {os.path.basename(json_path)}")
    print(f"{'='*70}")

    with open(json_path, "r") as f:
        data = json.load(f)

    groups = data.get("groups", {})

    # Build set of all existing command headers
    all_headers = set()
    for g in groups.values():
        for cmd in g.get("commands", []):
            h = get_base(cmd.get("header", cmd.get("scpi", "")))
            if h:
                all_headers.add(h)

    initial_count = sum(len(g.get("commands", [])) for g in groups.values())
    print(f"  Commands: {initial_count}")

    # ─── Scan for contamination ───
    foreign_me_syntax = []      # (group, cmd_idx, field, foreign_scpi)
    bad_me_code = []            # (group, cmd_idx, entry_idx)
    bad_top_examples = []       # (group, cmd_idx, entry_idx)
    foreign_top_syntax = []     # (group, cmd_idx, entry_idx, foreign_scpi)
    junk_top_syntax = []        # (group, cmd_idx, entry_idx)
    orphan_cmds = {}            # base -> [(host, foreign_scpi)]

    for gname, gdata in groups.items():
        for ci, cmd in enumerate(gdata.get("commands", [])):
            scpi = cmd.get("header", cmd.get("scpi", ""))
            host_base = get_base(scpi)

            # ── _manualEntry.syntax (dict) ──
            me = cmd.get("_manualEntry", {}) or {}
            me_syntax = me.get("syntax", {})
            if isinstance(me_syntax, dict):
                for field in ["set", "query"]:
                    val = me_syntax.get(field, "")
                    if val and is_foreign_to(val, host_base):
                        foreign_me_syntax.append((gname, ci, field, val))
                        fb = get_base(val)
                        if fb and fb not in all_headers:
                            if fb not in orphan_cmds:
                                orphan_cmds[fb] = []
                            orphan_cmds[fb].append((scpi, val))
            elif isinstance(me_syntax, list):
                for si, syn in enumerate(me_syntax):
                    if isinstance(syn, str) and syn.strip() and is_foreign_to(syn, host_base):
                        foreign_me_syntax.append((gname, ci, f"list[{si}]", syn))
                        fb = get_base(syn)
                        if fb and fb not in all_headers:
                            if fb not in orphan_cmds:
                                orphan_cmds[fb] = []
                            orphan_cmds[fb].append((scpi, syn))

            # ── _manualEntry.code[] ──
            me_code = me.get("code", me.get("examples", []))
            if isinstance(me_code, list):
                for ei, entry in enumerate(me_code):
                    code_str = extract_code_from_me_entry(entry)
                    if is_bad_example(code_str):
                        bad_me_code.append((gname, ci, ei))

            # ── top-level syntax[] ──
            syntax = cmd.get("syntax", [])
            if isinstance(syntax, list):
                for si, syn in enumerate(syntax):
                    if not isinstance(syn, str) or not syn.strip():
                        junk_top_syntax.append((gname, ci, si))
                        continue
                    if si > 0 and is_foreign_to(syn, host_base):
                        foreign_top_syntax.append((gname, ci, si, syn))
                        fb = get_base(syn)
                        if fb and fb not in all_headers:
                            if fb not in orphan_cmds:
                                orphan_cmds[fb] = []
                            orphan_cmds[fb].append((scpi, syn))

            # ── top-level examples[] ──
            examples = cmd.get("examples", [])
            if isinstance(examples, list):
                for ei, ex in enumerate(examples):
                    code_str = ""
                    if isinstance(ex, dict):
                        code_str = ex.get("scpi", ex.get("code", ""))
                    elif isinstance(ex, str):
                        code_str = ex
                    if is_bad_example(code_str):
                        bad_top_examples.append((gname, ci, ei))

    print(f"\n  Contamination found:")
    print(f"    Foreign _manualEntry.syntax entries: {len(foreign_me_syntax)}")
    print(f"    Bad _manualEntry.code entries:       {len(bad_me_code)}")
    print(f"    Foreign top-level syntax entries:    {len(foreign_top_syntax)}")
    print(f"    Junk top-level syntax entries:       {len(junk_top_syntax)}")
    print(f"    Bad top-level examples:              {len(bad_top_examples)}")
    print(f"    Orphaned commands (not in JSON):     {len(orphan_cmds)}")

    if foreign_me_syntax:
        print(f"\n  Sample foreign _manualEntry.syntax:")
        for gn, ci, field, fscpi in foreign_me_syntax[:10]:
            cmd = groups[gn]["commands"][ci]
            print(f"    {cmd.get('header','?')} [{field}] -> {fscpi[:80]}")

    if orphan_cmds:
        print(f"\n  Orphaned commands (first 20):")
        for base, sources in list(orphan_cmds.items())[:20]:
            print(f"    {base} (from {sources[0][0]})")

    if bad_me_code:
        print(f"\n  Sample bad _manualEntry.code (first 10):")
        for gn, ci, ei in bad_me_code[:10]:
            cmd = groups[gn]["commands"][ci]
            me = cmd.get("_manualEntry", {}) or {}
            me_code = me.get("code", me.get("examples", []))
            code_str = extract_code_from_me_entry(me_code[ei]) if ei < len(me_code) else "?"
            print(f"    {cmd.get('header','?')} [{ei}]: {code_str[:80]}")

    # ─── Step 2: Extract orphaned commands from PDF ───
    new_commands = {}  # base -> command dict
    if orphan_cmds and pdf_cache_path and os.path.exists(pdf_cache_path):
        print(f"\n  --- Extracting orphaned commands from PDF cache ---")
        with open(pdf_cache_path, "r") as f:
            pages_text = json.load(f)

        # Build a simple index: which pages mention each orphan command
        for orphan_base in orphan_cmds:
            # Search for the mixed-case version in the PDF
            found_on = []
            for page_str, text in pages_text.items():
                # Look for the command as a standalone heading line
                if orphan_base.replace("<X>", "<x>") in text or orphan_base in text.upper():
                    found_on.append(int(page_str))
            if found_on:
                # Extract from the first page where it appears
                page_num = found_on[0]
                text = pages_text.get(str(page_num), "")
                next_text = pages_text.get(str(page_num + 1), "")
                full_text = text + "\n" + next_text

                # Try to find a description line after the header
                lines = full_text.split("\n")
                desc = ""
                for i, line in enumerate(lines):
                    if orphan_base in line.upper().replace(" ", ""):
                        # Next non-empty line is likely the description
                        for j in range(i+1, min(i+5, len(lines))):
                            if lines[j].strip() and not lines[j].strip().startswith(("Syntax", "Group", "Arguments", "Returns", "Examples")):
                                desc = lines[j].strip()
                                break
                        break

                new_commands[orphan_base] = {
                    "name": orphan_base.replace(":", " ").replace("<x>", "").replace("<X>", "").title().strip(),
                    "scpi": orphan_base,
                    "header": orphan_base,
                    "commandType": "query" if orphan_base.endswith("?") else "both",
                    "shortDescription": desc[:200] if desc else f"SCPI command {orphan_base}",
                    "description": desc or f"SCPI command {orphan_base}. Extracted from PDF during contamination cleanup.",
                    "syntax": [orphan_base],
                    "examples": [],
                    "arguments": [],
                }
                # Use the original mixed-case from the source data
                for _, orig_scpi in orphan_cmds[orphan_base]:
                    orig_base = orig_scpi.split()[0].rstrip("?").strip()
                    if orig_base:
                        new_commands[orphan_base]["scpi"] = orig_base
                        new_commands[orphan_base]["header"] = orig_base
                        new_commands[orphan_base]["syntax"] = [orig_scpi.strip()]
                        break

        print(f"    Extracted from PDF: {len(new_commands)}")
        print(f"    Not found in PDF:   {len(orphan_cmds) - len(new_commands)}")

        if len(orphan_cmds) - len(new_commands) > 0:
            missing = set(orphan_cmds.keys()) - set(new_commands.keys())
            print(f"    Missing (first 10): {list(missing)[:10]}")
    elif orphan_cmds:
        print(f"\n  WARNING: No PDF cache available. {len(orphan_cmds)} orphaned commands not extracted.")

    # ─── Step 3: Apply fixes ───
    print(f"\n  --- Applying fixes ---")

    # Backup
    bak_path = json_path + ".bak2"
    if not os.path.exists(bak_path):
        shutil.copy2(json_path, bak_path)
        print(f"  Backup: {bak_path}")

    # 3a: Fix _manualEntry.syntax foreign entries
    me_syntax_fixed = 0
    for gname, ci, field, fscpi in foreign_me_syntax:
        cmd = groups[gname]["commands"][ci]
        me = cmd.get("_manualEntry", {}) or {}
        me_syntax = me.get("syntax", {})
        if isinstance(me_syntax, dict) and field in ("set", "query"):
            me_syntax[field] = ""  # Clear the foreign entry
            me_syntax_fixed += 1
        elif isinstance(me_syntax, list) and field.startswith("list["):
            idx = int(field.split("[")[1].rstrip("]"))
            if idx < len(me_syntax):
                me_syntax[idx] = None  # Mark for removal
                me_syntax_fixed += 1
        # Clean up None entries from lists
        if isinstance(me_syntax, list):
            me["syntax"] = [s for s in me_syntax if s is not None]
    print(f"    _manualEntry.syntax foreign entries cleared: {me_syntax_fixed}")

    # 3b: Remove bad _manualEntry.code entries (process in reverse order)
    me_code_removed = 0
    # Group by (gname, ci) and process each command once
    by_cmd = defaultdict(list)
    for gname, ci, ei in bad_me_code:
        by_cmd[(gname, ci)].append(ei)

    for (gname, ci), indices in by_cmd.items():
        cmd = groups[gname]["commands"][ci]
        me = cmd.get("_manualEntry", {}) or {}
        code_field = "code" if "code" in me else "examples"
        me_code_list = me.get(code_field, [])
        if isinstance(me_code_list, list):
            for idx in sorted(set(indices), reverse=True):
                if idx < len(me_code_list):
                    me_code_list.pop(idx)
                    me_code_removed += 1
    print(f"    Bad _manualEntry.code entries removed: {me_code_removed}")

    # 3c: Remove foreign/junk top-level syntax entries
    syntax_removed = 0
    by_cmd2 = defaultdict(list)
    for gname, ci, si, _ in foreign_top_syntax:
        by_cmd2[(gname, ci)].append(si)
    for gname, ci, si in junk_top_syntax:
        by_cmd2[(gname, ci)].append(si)

    for (gname, ci), indices in by_cmd2.items():
        cmd = groups[gname]["commands"][ci]
        syntax = cmd.get("syntax", [])
        if isinstance(syntax, list):
            for idx in sorted(set(indices), reverse=True):
                if idx < len(syntax):
                    syntax.pop(idx)
                    syntax_removed += 1
    print(f"    Top-level foreign/junk syntax removed: {syntax_removed}")

    # 3d: Remove bad top-level examples
    examples_removed = 0
    by_cmd3 = defaultdict(list)
    for gname, ci, ei in bad_top_examples:
        by_cmd3[(gname, ci)].append(ei)

    for (gname, ci), indices in by_cmd3.items():
        cmd = groups[gname]["commands"][ci]
        examples = cmd.get("examples", [])
        if isinstance(examples, list):
            for idx in sorted(set(indices), reverse=True):
                if idx < len(examples):
                    examples.pop(idx)
                    examples_removed += 1
    print(f"    Bad top-level examples removed: {examples_removed}")

    # 3e: Add new orphaned commands to correct groups
    added = 0
    if new_commands:
        for base, cmd_data in new_commands.items():
            # Determine group from SCPI prefix
            root = cmd_data["scpi"].split(":")[0].upper()
            # Try to find matching group
            target_group = None
            for gname in groups:
                if gname.upper() == root or root.startswith(gname.upper()[:4]):
                    target_group = gname
                    break
            # Match by checking existing commands in each group
            if not target_group:
                cmd_prefix = ":".join(cmd_data["scpi"].split(":")[:2]).upper()
                for gname, gdata in groups.items():
                    for existing_cmd in gdata.get("commands", [])[:5]:
                        existing_prefix = ":".join(existing_cmd.get("scpi", "").split(":")[:2]).upper()
                        if existing_prefix and existing_prefix == cmd_prefix:
                            target_group = gname
                            break
                    if target_group:
                        break
            if not target_group:
                target_group = "Miscellaneous"
                if target_group not in groups:
                    target_group = list(groups.keys())[-1]  # Last group as fallback

            groups[target_group]["commands"].append(cmd_data)
            added += 1

        print(f"    New orphaned commands added: {added}")

    # ─── Write ───
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    final_count = sum(len(g.get("commands", [])) for g in groups.values())
    print(f"\n  Results:")
    print(f"    Commands: {initial_count} -> {final_count} (delta: +{final_count - initial_count})")
    print(f"    Total entries cleaned: {me_syntax_fixed + me_code_removed + syntax_removed + examples_removed}")
    print(f"    New commands added: {added}")

    # ─── Verify JSON ───
    with open(json_path, "r") as f:
        verify = json.load(f)
    verify_count = sum(len(g.get("commands", [])) for g in verify.get("groups", {}).values())
    print(f"    JSON valid: YES")
    print(f"    Verified command count: {verify_count}")


# ─── Entry point ───
if __name__ == "__main__":
    base = Path(__file__).parent.parent

    configs = [
        (
            str(base / "public/commands/mso_2_4_5_6_7.json"),
            "/tmp/mso_pdf_cache.json",
        ),
        (
            str(base / "public/commands/MSO_DPO_5k_7k_70K.json"),
            "/tmp/dpo_pdf_cache.json",
        ),
        (
            str(base / "public/commands/rsa.json"),
            None,  # No PDF for RSA
        ),
    ]

    print("=" * 70)
    print("SCPI JSON Spot Fix v2 — Targeted Contamination Cleanup")
    print("=" * 70)

    for json_path, pdf_cache in configs:
        if os.path.exists(json_path):
            process_file(json_path, pdf_cache)
        else:
            print(f"\n  SKIP: {json_path} not found")

    print(f"\n{'='*70}")
    print("DONE")
    print(f"{'='*70}")
