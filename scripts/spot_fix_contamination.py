#!/usr/bin/env python3
"""
spot_fix_contamination.py - Surgical cleanup of contaminated SCPI JSON files.

3-step spot fix:
  Step 1: Identify all contamination (foreign syntax, bad examples)
  Step 2: Extract orphaned commands from PDFs
  Step 3: Apply fixes (remove duplicates/junk, remove bad examples, add orphans)

Handles:
  - mso_2_4_5_6_7.json  (with 4-5-6_MSO_Programmer PDF)
  - MSO_DPO_5k_7k_70K.json (with 7-Series-DPO-Programmer PDF)
  - rsa.json (bad examples only, no PDF)
"""

import json
import re
import shutil
import os
import sys
from pathlib import Path
from collections import defaultdict

try:
    import pdfplumber
except ImportError:
    print("ERROR: pdfplumber not installed. Run: pip install pdfplumber")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = Path("/home/user/TekAutomate")
CMD_DIR = BASE / "public" / "commands"
DOCS_DIR = BASE / "docs"

FILES_CONFIG = {
    "mso_2_4_5_6_7.json": {
        "pdf": DOCS_DIR / "4-5-6_MSO_Programmer_077189801_RevA.pdf",
        "do_pdf_extraction": True,
    },
    "MSO_DPO_5k_7k_70K.json": {
        "pdf": DOCS_DIR / "7-Series-DPO-Programmer_077186000 (1).pdf",
        "do_pdf_extraction": True,
    },
    "rsa.json": {
        "pdf": None,
        "do_pdf_extraction": False,
    },
}

# ---------------------------------------------------------------------------
# Bad-example detection
# ---------------------------------------------------------------------------
BAD_STARTS = [
    "This command", "This query", "Sets or", "The command", "indicating",
    "return :", "Queries", "Available", "Turns the", "Returns the",
    "When ", "Each ", "Before ", "Use ", "If ", "In order", "Although",
    "For most", "The following", "Table continued",
]

GLOSSARY_STARTS = [
    "ASCII", "IEEE", "Backus-Naur", "Controller", "Equivalent-Time",
    "Real-Time sampling", "Status Registers", "Event Queue", "Output Queue",
    "Enable Registers", "Command Error", "Device Error", "Execution Error",
]

MEASUREMENT_RE = re.compile(r'^-?\d+\.?\d*\s+\w+\.?$')


def is_bad_example(code: str, host_scpi_base: str) -> bool:
    """Return True if the example scpi/code string is contamination."""
    if not code or not isinstance(code, str):
        return True
    code = code.strip()
    if len(code) < 4:
        return True
    if not code:
        return True
    # Starts with English prose
    for p in BAD_STARTS:
        if code.startswith(p):
            return True
    # Starts with lowercase
    if code[0].islower():
        return True
    # Comment syntax
    if code.startswith("/*"):
        return True
    # Glossary / reference text
    for g in GLOSSARY_STARTS:
        if code.startswith(g):
            return True
    # Measurement value without command
    if MEASUREMENT_RE.match(code):
        return True
    # No colon AND doesn't start with * — but only if it doesn't match the host command's root
    if ":" not in code and not code.startswith("*"):
        ex_base = code.split()[0].split("?")[0].upper()
        if ex_base != host_scpi_base:
            return True
    return False


def get_scpi_base(scpi: str) -> str:
    """Get the uppercase root token of an SCPI string, sans ? and args."""
    if not scpi:
        return ""
    return scpi.rstrip("?").split()[0].upper()


# ---------------------------------------------------------------------------
# Foreign-syntax detection
# ---------------------------------------------------------------------------
SCPI_CMD_RE = re.compile(r'^[A-Za-z*][\w<>{}:]+$')


def classify_foreign_syntax(syntax_list: list, host_base: str, is_star: bool,
                            all_headers_upper: set):
    """
    Check syntax entries beyond the first for foreign contamination.
    Returns (duplicates, orphans, junk) — each is a list of (index, entry_str).
    """
    duplicates = []
    orphans = []
    junk = []

    if not syntax_list or len(syntax_list) <= 1:
        return duplicates, orphans, junk

    for idx in range(1, len(syntax_list)):
        entry = syntax_list[idx]
        if not entry or not isinstance(entry, str):
            junk.append((idx, entry))
            continue
        entry_stripped = entry.strip()
        if not entry_stripped:
            junk.append((idx, entry_stripped))
            continue

        # Extract the command root from the syntax entry
        entry_cmd = entry_stripped.split()[0].rstrip("?").upper()
        # Remove trailing ? for comparison
        entry_cmd_no_q = entry_cmd.rstrip("?")

        is_foreign = False
        if is_star:
            if ":" in entry_cmd:
                is_foreign = True
        else:
            if not entry_cmd_no_q.startswith(host_base):
                is_foreign = True

        if not is_foreign:
            continue

        # Is it a real SCPI command path (has colons, starts with letter)?
        # Reject entries ending with colon (incomplete/truncated paths)
        if (SCPI_CMD_RE.match(entry_cmd_no_q) and ":" in entry_cmd_no_q
                and not entry_cmd_no_q.endswith(":")):
            if entry_cmd_no_q in all_headers_upper:
                duplicates.append((idx, entry_stripped))
            else:
                orphans.append((idx, entry_stripped))
        else:
            junk.append((idx, entry_stripped))

    return duplicates, orphans, junk


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------
def build_pdf_index(pdf_path: str, orphan_cmds: set = None) -> dict:
    """
    Build an index mapping uppercase SCPI command headers to page numbers.
    Uses pre-cached PDF text from /tmp/*_pdf_cache.json for speed.
    """
    # Use pre-cached PDF text if available
    import os
    if "4-5-6" in pdf_path or "mso" in pdf_path.lower():
        cache_path = "/tmp/mso_pdf_cache.json"
    else:
        cache_path = "/tmp/dpo_pdf_cache.json"

    use_cache = os.path.exists(cache_path)
    if use_cache:
        with open(cache_path, "r") as f:
            pages_text = json.load(f)
        total_pages = max(int(k) for k in pages_text.keys()) + 1
        build_pdf_index._cache = pages_text
        build_pdf_index._cache_path = cache_path
    else:
        pdf = pdfplumber.open(pdf_path)
        total_pages = len(pdf.pages)

    # Find the start of the command definitions section
    # (typically starts around page 100-160 with "Commands listed in alphabetical order")
    def _get_page(n):
        if use_cache:
            return pages_text.get(str(n), "")
        return pdf.pages[n].extract_text() or ""

    start_page = 0
    for i in range(50, min(200, total_pages)):
        text = _get_page(i)
        if "Commands listed in alphabetical order" in text and "ACQuire" in text:
            start_page = i
            break

    if start_page == 0:
        start_page = 80

    cmd_header_re = re.compile(
        r'^([A-Z*][A-Za-z<>:_\d{}*]+(?:\?)?)\s*(?:\([^)]*\))?\s*$',
        re.MULTILINE
    )

    index = {}
    print(f"    Scanning pages {start_page}-{total_pages-1} {'(from cache)' if use_cache else ''}...")

    for page_num in range(start_page, total_pages):
        text = _get_page(page_num)
        if not text:
            continue
        for m in cmd_header_re.finditer(text):
            header = m.group(1).strip()
            key = header.upper().rstrip("?")
            if key and ":" in key and len(key) > 3:
                if key not in index:
                    index[key] = []
                index[key].append(page_num)

    if not use_cache:
        pdf.close()
    return index


def extract_commands_from_pdf(pdf_path: str, orphan_cmds: list, pdf_index: dict) -> dict:
    """
    Extract multiple command definitions from the PDF in a single pass.
    Returns dict: cmd_upper -> command dict (or None if not found).
    """
    results = {}

    # Figure out which pages we need to read
    pages_needed = {}  # page_num -> list of cmd_uppers that need this page
    cmd_to_pages = {}

    for cmd_upper in orphan_cmds:
        pages_to_check = pdf_index.get(cmd_upper, [])
        if not pages_to_check:
            # Try case-insensitive search through index
            for key, pages in pdf_index.items():
                if key.upper() == cmd_upper:
                    pages_to_check = pages
                    break
        if not pages_to_check:
            results[cmd_upper] = None
            continue

        cmd_to_pages[cmd_upper] = pages_to_check
        for pn in pages_to_check:
            for p in range(pn, pn + 3):  # Also need next 2 pages
                if p not in pages_needed:
                    pages_needed[p] = []
                pages_needed[p].append(cmd_upper)

    if not cmd_to_pages:
        return results

    # Read all needed pages — use cache if available
    page_text_cache = {}
    cached_text = getattr(build_pdf_index, '_cache', None)

    if cached_text:
        for pn in sorted(pages_needed.keys()):
            page_text_cache[pn] = cached_text.get(str(pn), "")
    else:
        pdf = pdfplumber.open(pdf_path)
        total_pages = len(pdf.pages)
        for pn in sorted(pages_needed.keys()):
            if pn < total_pages:
                page_text_cache[pn] = pdf.pages[pn].extract_text() or ""
        pdf.close()

    # Now extract each command
    for cmd_upper, pages_to_check in cmd_to_pages.items():
        result = None
        for page_num in pages_to_check:
            text_parts = []
            for p in range(page_num, page_num + 3):
                if p in page_text_cache:
                    text_parts.append(page_text_cache[p])
            full_text = "\n".join(text_parts)

            # Build case-insensitive pattern for the command header
            escaped = re.escape(cmd_upper)
            pattern_str = ""
            for ch in escaped:
                if ch.isalpha():
                    pattern_str += f"[{ch.upper()}{ch.lower()}]"
                else:
                    pattern_str += ch

            header_pattern = re.compile(
                r'(' + pattern_str + r'(?:\?)?)\s*(?:\([^)]*\))?\s*\n',
                re.MULTILINE
            )

            for hm in header_pattern.finditer(full_text):
                actual_header = hm.group(1).strip()
                start_pos = hm.end()

                # Next command header must contain a colon (SCPI) or start with *
                next_cmd = re.search(
                    r'\n([A-Z*][A-Za-z<>:_\d{}*]*[:*][A-Za-z<>:_\d{}*]+(?:\?)?)\s*(?:\([^)]*\))?\s*\n',
                    full_text[start_pos:]
                )
                if next_cmd:
                    end_pos = start_pos + next_cmd.start()
                else:
                    end_pos = len(full_text)

                block = full_text[start_pos:end_pos]
                result = parse_command_block(actual_header, block)
                if result:
                    break

            if result:
                break

        results[cmd_upper] = result

    return results


def parse_command_block(header: str, block: str) -> dict | None:
    """Parse a command definition block from PDF text into a command dict."""
    sections = {}
    current_section = "description"
    sections[current_section] = []

    section_names = ["Group", "Syntax", "Arguments", "Examples", "Returns",
                     "Related Commands", "Conditions"]

    for line in block.split("\n"):
        stripped = line.strip()
        # Check if this line is a section header
        matched_section = None
        for sn in section_names:
            if stripped == sn:
                matched_section = sn.lower().replace(" ", "_")
                break
        if matched_section:
            current_section = matched_section
            sections[current_section] = []
        else:
            if current_section in sections:
                sections[current_section].append(line)
            else:
                sections[current_section] = [line]

    # Clean up sections
    desc_text = "\n".join(sections.get("description", [])).strip()
    # Group text: take only the first non-empty line (ignore page footers/headers)
    group_text = ""
    for gl in sections.get("group", []):
        gl_stripped = gl.strip()
        if gl_stripped and not re.match(r'^\d+$', gl_stripped) and "Programmer Manual" not in gl_stripped and "Commands listed" not in gl_stripped:
            group_text = gl_stripped
            break
    syntax_lines = [l.strip() for l in sections.get("syntax", []) if l.strip()]
    args_text = "\n".join(sections.get("arguments", [])).strip()
    examples_lines = [l.strip() for l in sections.get("examples", []) if l.strip()]
    returns_text = "\n".join(sections.get("returns", [])).strip()
    conditions_text = "\n".join(sections.get("conditions", [])).strip()

    if not desc_text and not syntax_lines:
        return None

    # Filter out page footers and noise from syntax
    syntax_clean = []
    for s in syntax_lines:
        # Skip page numbers, footers
        if re.match(r'^\d+$', s):
            continue
        if "Programmer Manual" in s or "Commands listed" in s:
            continue
        syntax_clean.append(s)

    # Determine command type
    has_set = False
    has_query = False
    for s in syntax_clean:
        if s.rstrip().endswith("?"):
            has_query = True
        elif "{" in s or "<" in s or not s.rstrip().endswith("?"):
            has_set = True

    if has_set and has_query:
        cmd_type = "both"
    elif has_query:
        cmd_type = "query"
    else:
        cmd_type = "set"

    # Parse examples
    examples = []
    for ex_line in examples_lines:
        if re.match(r'^\d+$', ex_line) or "Programmer Manual" in ex_line or "Commands listed" in ex_line:
            continue
        # Example format: "COMMAND:PATH value description text"
        # Split on first space after the SCPI command
        parts = ex_line.split(" ", 1)
        if len(parts) >= 1 and (":" in parts[0] or parts[0].startswith("*")):
            # Rejoin and try to split at the description
            # Pattern: SCPI_COMMAND [args] description
            ex_match = re.match(r'^([A-Z*][\w:<>]+(?:\?)?(?:\s+\S+)?)\s+(.*)', ex_line, re.IGNORECASE)
            if ex_match:
                examples.append({
                    "scpi": ex_match.group(1).strip(),
                    "description": ex_match.group(2).strip(),
                })
            else:
                examples.append({
                    "scpi": ex_line.strip(),
                    "description": "",
                })

    # Build the name from header
    name_parts = header.split(":")
    name = name_parts[-1].rstrip("?") if name_parts else header

    # Build short description
    short_desc = desc_text.split(".")[0] + "." if desc_text else ""
    if len(short_desc) > 200:
        short_desc = short_desc[:197] + "..."

    cmd = {
        "scpi": header,
        "name": name,
        "description": desc_text,
        "shortDescription": short_desc,
        "group": group_text if group_text else "Miscellaneous",
        "syntax": syntax_clean,
        "arguments": args_text if args_text else None,
        "params": [],
        "examples": examples,
        "relatedCommands": [],
        "conditions": conditions_text if conditions_text else None,
        "returns": returns_text if returns_text else None,
        "notes": [],
        "example": examples[0]["scpi"] if examples else "",
        "commandType": cmd_type,
        "hasQuery": has_query,
        "hasSet": has_set,
        "_manualEntry": {
            "command": header,
            "header": header.split(":")[0],
            "mnemonics": header.rstrip("?").split(":"),
            "commandType": cmd_type,
            "hasQuery": has_query,
            "hasSet": has_set,
            "description": desc_text,
            "shortDescription": short_desc,
            "arguments": args_text if args_text else None,
            "examples": [
                {
                    "scpi": ex["scpi"],
                    "description": ex["description"],
                    "codeExamples": {"scpi": {"code": ex["scpi"]}},
                }
                for ex in examples
            ],
            "relatedCommands": [],
            "commandGroup": group_text if group_text else "Miscellaneous",
            "syntax": {},
            "manualReference": {"section": group_text if group_text else ""},
            "notes": [],
        },
    }

    # Build _manualEntry.syntax dict
    me_syntax = {}
    for s in syntax_clean:
        if s.rstrip().endswith("?"):
            me_syntax["query"] = s
        else:
            me_syntax["set"] = s
    cmd["_manualEntry"]["syntax"] = me_syntax

    return cmd


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------
def process_file(json_filename: str, config: dict):
    """Process a single JSON file: identify, extract, and fix contamination."""
    json_path = CMD_DIR / json_filename
    if not json_path.exists():
        print(f"  SKIP: {json_path} does not exist")
        return

    print(f"\n{'='*70}")
    print(f"Processing: {json_filename}")
    print(f"{'='*70}")

    # Load JSON
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    groups = data.get("groups", {})

    # Build set of all existing command headers (uppercase, sans ?)
    all_headers_upper = set()
    all_commands = []
    for gname, gdata in groups.items():
        for cmd in gdata.get("commands", []):
            scpi = cmd.get("scpi", "")
            header = scpi.rstrip("?").split()[0].upper() if scpi else ""
            if header:
                all_headers_upper.add(header)
            all_commands.append((gname, cmd))

    initial_count = len(all_commands)
    print(f"  Initial command count: {initial_count}")

    # -----------------------------------------------------------------------
    # Step 1: Identify contamination
    # -----------------------------------------------------------------------
    print(f"\n  --- Step 1: Identify contamination ---")

    total_dup_syntax = 0
    total_orphan_syntax = 0
    total_junk_syntax = 0
    total_bad_examples = 0
    total_bad_me_examples = 0

    # Track orphan commands to extract
    orphan_commands = {}  # cmd_upper -> list of (host_scpi, syntax_entry)

    # Track all fixes to apply
    fixes = []  # list of (gname, cmd_index, fix_type, details)

    for gname, gdata in groups.items():
        for ci, cmd in enumerate(gdata.get("commands", [])):
            scpi = cmd.get("scpi", "")
            host_base = get_scpi_base(scpi)
            is_star = host_base.startswith("*")

            # 1a: Foreign syntax in top-level syntax array
            syntax = cmd.get("syntax", [])
            # Only process list syntax; dict syntax (RSA) doesn't have foreign entries
            if isinstance(syntax, list):
                dupes, orphans, junks = classify_foreign_syntax(
                    syntax, host_base, is_star, all_headers_upper
                )
            else:
                dupes, orphans, junks = [], [], []
            total_dup_syntax += len(dupes)
            total_orphan_syntax += len(orphans)
            total_junk_syntax += len(junks)

            for _, entry in orphans:
                cmd_key = entry.split()[0].rstrip("?").upper()
                if cmd_key not in orphan_commands:
                    orphan_commands[cmd_key] = []
                orphan_commands[cmd_key].append((scpi, entry))

            if dupes or orphans or junks:
                indices_to_remove = sorted(
                    [i for i, _ in dupes] + [i for i, _ in orphans] + [i for i, _ in junks],
                    reverse=True
                )
                fixes.append((gname, ci, "remove_syntax", indices_to_remove))

            # 1a also: _manualEntry.syntax (dict with 'set'/'query' keys for MSO/DPO)
            me = cmd.get("_manualEntry", {})
            me_syntax = me.get("syntax", {}) if me else {}
            # _manualEntry.syntax is a dict, not a list — contamination is less likely
            # but we should still check if it references a different command

            # 1b: Bad examples in top-level examples array
            examples = cmd.get("examples") or []
            bad_example_indices = []
            for ei, ex in enumerate(examples):
                code = ex.get("scpi", "") or ex.get("code", "") or ""
                if is_bad_example(code, host_base):
                    bad_example_indices.append(ei)
                    total_bad_examples += 1

            if bad_example_indices:
                fixes.append((gname, ci, "remove_bad_examples", sorted(bad_example_indices, reverse=True)))

            # 1b also: _manualEntry.examples
            me_examples = (me.get("examples") or []) if me else []
            bad_me_indices = []
            for ei, ex in enumerate(me_examples):
                # _manualEntry examples have 'codeExamples.scpi.code' or 'scpi' field
                code = ""
                if isinstance(ex, dict):
                    code = ex.get("scpi", "")
                    if not code:
                        ce = ex.get("codeExamples", {})
                        if isinstance(ce, dict):
                            scpi_obj = ce.get("scpi", {})
                            if isinstance(scpi_obj, dict):
                                code = scpi_obj.get("code", "")
                if is_bad_example(code, host_base):
                    bad_me_indices.append(ei)
                    total_bad_me_examples += 1

            if bad_me_indices:
                fixes.append((gname, ci, "remove_bad_me_examples", sorted(bad_me_indices, reverse=True)))

    print(f"  Duplicate foreign syntax entries: {total_dup_syntax}")
    print(f"  Orphan foreign syntax entries:    {total_orphan_syntax}")
    print(f"  Junk syntax entries:              {total_junk_syntax}")
    print(f"  Bad top-level examples:           {total_bad_examples}")
    print(f"  Bad _manualEntry examples:        {total_bad_me_examples}")
    print(f"  Unique orphan commands to extract: {len(orphan_commands)}")

    # -----------------------------------------------------------------------
    # Step 2: Extract orphaned commands from PDF
    # -----------------------------------------------------------------------
    new_commands = {}  # group_name -> list of command dicts
    not_found = []

    if config["do_pdf_extraction"] and orphan_commands:
        print(f"\n  --- Step 2: Extract orphaned commands from PDF ---")
        pdf_path = str(config["pdf"])
        print(f"  Building PDF index from: {pdf_path}")
        pdf_index = build_pdf_index(pdf_path)
        print(f"  PDF index contains {len(pdf_index)} command headers")

        # Filter valid orphan commands
        valid_orphans = []
        for cmd_upper in sorted(orphan_commands.keys()):
            if cmd_upper.endswith(":") or len(cmd_upper) < 4:
                not_found.append(cmd_upper)
            else:
                valid_orphans.append(cmd_upper)

        # Batch-extract all orphans from PDF in one pass
        print(f"  Extracting {len(valid_orphans)} orphan commands from PDF...")
        pdf_results = extract_commands_from_pdf(pdf_path, valid_orphans, pdf_index)

        extracted = 0
        for cmd_upper in valid_orphans:
            cmd_data = pdf_results.get(cmd_upper)
            if cmd_data:
                group = cmd_data.get("group", "Miscellaneous")
                # Check if this group exists; if not, try to match by prefix
                if group not in groups:
                    best_group = find_best_group(cmd_upper, groups)
                    if best_group:
                        group = best_group
                        cmd_data["group"] = group
                        cmd_data["_manualEntry"]["commandGroup"] = group

                if group not in new_commands:
                    new_commands[group] = []
                new_commands[group].append(cmd_data)
                extracted += 1
            else:
                not_found.append(cmd_upper)

        print(f"  Extracted from PDF: {extracted}")
        print(f"  Not found in PDF:   {len(not_found)}")

        if not_found:
            print(f"\n  WARNING: These orphan commands were not found in the PDF:")
            for nf in sorted(not_found):
                print(f"    - {nf}")
    elif not config["do_pdf_extraction"]:
        print(f"\n  --- Step 2: SKIPPED (no PDF for this file) ---")

    # -----------------------------------------------------------------------
    # Step 3: Apply fixes
    # -----------------------------------------------------------------------
    print(f"\n  --- Step 3: Apply fixes ---")

    # Create backup
    bak_path = str(json_path) + ".bak"
    if not os.path.exists(bak_path):
        shutil.copy2(json_path, bak_path)
        print(f"  Backup created: {bak_path}")
    else:
        print(f"  Backup already exists: {bak_path}")

    # Apply fixes (process in reverse order within each command to preserve indices)
    syntax_removed = 0
    examples_removed = 0
    me_examples_removed = 0

    # Group fixes by (gname, cmd_index)
    fix_map = defaultdict(list)
    for gname, ci, fix_type, details in fixes:
        fix_map[(gname, ci)].append((fix_type, details))

    for (gname, ci), fix_list in fix_map.items():
        cmd = groups[gname]["commands"][ci]
        for fix_type, details in fix_list:
            if fix_type == "remove_syntax":
                syntax = cmd.get("syntax", [])
                for idx in details:  # already sorted reverse
                    if idx < len(syntax):
                        syntax.pop(idx)
                        syntax_removed += 1
                # Also remove empty strings
                cmd["syntax"] = [s for s in syntax if s and (not isinstance(s, str) or s.strip())]

            elif fix_type == "remove_bad_examples":
                examples = cmd.get("examples", [])
                for idx in details:
                    if idx < len(examples):
                        examples.pop(idx)
                        examples_removed += 1
                cmd["examples"] = examples

            elif fix_type == "remove_bad_me_examples":
                me = cmd.get("_manualEntry", {})
                if me:
                    me_examples = me.get("examples", [])
                    for idx in details:
                        if idx < len(me_examples):
                            me_examples.pop(idx)
                            me_examples_removed += 1
                    me["examples"] = me_examples

    print(f"  Foreign/junk syntax entries removed:  {syntax_removed}")
    print(f"  Bad top-level examples removed:       {examples_removed}")
    print(f"  Bad _manualEntry examples removed:    {me_examples_removed}")

    # 3c: Add new orphaned commands to their groups
    commands_added = 0
    if new_commands:
        for group_name, cmds in new_commands.items():
            if group_name not in groups:
                groups[group_name] = {
                    "name": group_name,
                    "description": f"{group_name} commands",
                    "commands": [],
                }
            for cmd_data in cmds:
                # Check for duplicates (idempotency)
                existing = any(
                    c.get("scpi", "").upper().rstrip("?") == cmd_data["scpi"].upper().rstrip("?")
                    for c in groups[group_name]["commands"]
                )
                if not existing:
                    groups[group_name]["commands"].append(cmd_data)
                    commands_added += 1

        print(f"  New commands added: {commands_added}")

        if commands_added > 0:
            print(f"\n  New commands by group:")
            for group_name, cmds in sorted(new_commands.items()):
                added_cmds = [c for c in cmds]  # All were checked for dups above
                if added_cmds:
                    print(f"    {group_name}:")
                    for c in added_cmds:
                        print(f"      + {c['scpi']} ({c['commandType']})")

    # Write the modified JSON
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    # -----------------------------------------------------------------------
    # Verification
    # -----------------------------------------------------------------------
    print(f"\n  --- Verification ---")

    # Reload and verify
    with open(json_path, "r", encoding="utf-8") as f:
        try:
            verify_data = json.load(f)
            print(f"  JSON is valid: YES")
        except json.JSONDecodeError as e:
            print(f"  JSON is valid: NO - {e}")
            return

    # Count commands
    final_count = 0
    for gdata in verify_data.get("groups", {}).values():
        final_count += len(gdata.get("commands", []))
    print(f"  Command count: {initial_count} -> {final_count} (delta: {final_count - initial_count:+d})")

    if commands_added > 0 and final_count <= initial_count:
        print(f"  WARNING: Expected command count to increase!")

    # Check for remaining foreign syntax
    remaining_foreign = 0
    verify_headers = set()
    for gdata in verify_data.get("groups", {}).values():
        for cmd in gdata.get("commands", []):
            scpi = cmd.get("scpi", "")
            h = scpi.rstrip("?").split()[0].upper() if scpi else ""
            if h:
                verify_headers.add(h)

    for gdata in verify_data.get("groups", {}).values():
        for cmd in gdata.get("commands", []):
            scpi = cmd.get("scpi", "")
            host_base = get_scpi_base(scpi)
            is_star = host_base.startswith("*")
            syntax = cmd.get("syntax", [])
            if isinstance(syntax, list):
                dupes, orphans, junks = classify_foreign_syntax(
                    syntax, host_base, is_star, verify_headers
                )
                remaining_foreign += len(dupes) + len(orphans) + len(junks)

    print(f"  Remaining foreign syntax: {remaining_foreign}")
    if remaining_foreign > 0:
        print(f"  NOTE: Some foreign syntax may remain if entries couldn't be classified")


def find_best_group(cmd_upper: str, groups: dict) -> str | None:
    """Find the best matching group for a command based on SCPI prefix."""
    parts = cmd_upper.split(":")
    if not parts:
        return None

    # Try matching the first part of the command to existing command groups
    prefix = parts[0].upper()

    # Map common prefixes to groups
    prefix_to_group = {}
    for gname, gdata in groups.items():
        for cmd in gdata.get("commands", []):
            scpi = cmd.get("scpi", "")
            if scpi:
                cmd_prefix = scpi.split(":")[0].upper().rstrip("?")
                if cmd_prefix:
                    prefix_to_group[cmd_prefix] = gname

    return prefix_to_group.get(prefix)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("SCPI JSON Spot Fix - Contamination Cleanup")
    print("=" * 70)

    for json_file, config in FILES_CONFIG.items():
        process_file(json_file, config)

    print(f"\n{'='*70}")
    print("DONE - All files processed.")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
