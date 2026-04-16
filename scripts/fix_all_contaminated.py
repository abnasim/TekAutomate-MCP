#!/usr/bin/env python3
"""
Comprehensive fix for contaminated SCPI commands in JSON files.
Cross-references against PDF source data cached as JSON.
"""

import json
import re
import os
import shutil
from collections import defaultdict

# ─── Configuration ───────────────────────────────────────────────────────────

PDF_CONFIGS = [
    {
        "cache": "/tmp/mso_pdf_cache.json",
        "json": "/home/user/TekAutomate/public/commands/mso_2_4_5_6_7.json",
        "label": "MSO 4/5/6",
        "cmd_start_page": 157,
    },
    {
        "cache": "/tmp/5k7k_pdf_cache.json",
        "json": "/home/user/TekAutomate/public/commands/MSO_DPO_5k_7k_70K.json",
        "label": "DPO 5K/7K/70K",
        "cmd_start_page": 116,
    },
]

# ─── Phase 1: Build PDF command index ────────────────────────────────────────

def is_valid_scpi_header(line, following_text=""):
    """
    Validate whether a line is genuinely an SCPI command header.
    Uses both format validation and context (following text should have Group/Syntax).
    """
    stripped = line.strip()
    if not stripped:
        return None

    # Must match basic SCPI pattern:
    # *CMD or Word:Word:Word pattern with optional ? and (Query Only)/(No Query Form)
    m = re.match(
        r'^(\*[A-Z]{2,4}\??'                          # *RST, *IDN?, etc.
        r'|[A-Z][A-Za-z]+(?:<[xyn]>)?'                # First word like ACQuire, CH<x>
        r'(?:_[A-Z][A-Za-z<>\d]*)*'                    # optional _D<x> style suffixes
        r'(?::[A-Z][A-Za-z<>\d_]*(?:<[xyn]>)?)*'      # :SubCommand:SubCommand
        r'\??)'                                         # optional trailing ?
        r'\s*(\(Query [Oo]nly\)|\(No Query Form\))?\s*$',
        stripped
    )
    if not m:
        return None

    header = m.group(1)
    qualifier = m.group(2) or ""

    # Length checks
    if len(header) < 3:
        return None
    # Very long headers are suspicious
    if len(header) > 120:
        return None

    # Must not be a section label or page header
    base = header.rstrip('?').split(':')[0]
    base_low = base.lower()
    if base_low in ('group', 'syntax', 'arguments', 'examples', 'returns',
                     'related', 'conditions', 'restrictions', 'note', 'notes',
                     'description', 'type', 'commands', 'command'):
        return None

    # Must not contain { } | without being in <x> template format - those are argument lines
    if '{' in header or '}' in header or '|' in header:
        return None

    # Skip lines that are just numbers
    if re.match(r'^\d+$', stripped):
        return None

    # Skip page headers
    if 'Commands listed in alphabetical order' in stripped:
        return None

    # Reject headers that are really concatenated sentences (no spaces, lots of lowercase)
    # Valid SCPI segments have mixed case like ACQuire, MEASUrement but NOT
    # "Thisqueryreturnsthe..." or "PACKETdisplaysagroupof..."
    # Check: if the first segment (before :) has more than ~20 chars of lowercase in a row
    first_seg = header.rstrip('?').split(':')[0]
    lowercase_runs = re.findall(r'[a-z]{6,}', first_seg)
    if lowercase_runs:
        longest = max(len(r) for r in lowercase_runs)
        # Real SCPI: "MEASUrement" has max 7 lowercase. Sentence fragments have way more.
        if longest > 12:
            return None

    # Also reject if any segment contains digits mixed with lowercase in sentence-like patterns
    # Real: MEAS<x>, Power<x>. Not real: "2116-06-15T14"
    for seg in header.rstrip('?').split(':'):
        # Reject segments that are mostly lowercase (>70% lowercase for segments > 8 chars)
        if len(seg) > 8:
            lc_count = sum(1 for c in seg if c.islower())
            if lc_count / len(seg) > 0.7:
                return None

    # Context check: the text following this header should contain section labels
    # (Group, Syntax, Arguments, Returns, Related Commands) within ~50 lines
    context_window = following_text[:3000]
    has_section = bool(re.search(
        r'(?:^|\n)\s*(?:Group|Syntax|Arguments|Returns|Related Commands)\s',
        context_window
    ))
    # For inline format (5k7k): "Group Acquisition", "Syntax ACQuire..."
    has_inline = bool(re.search(
        r'(?:Group\s+[A-Z]|Syntax\s+[A-Z\*]|Arguments\s+[<A-Z]|Returns\s+[<A-Z\d])',
        context_window
    ))

    if not (has_section or has_inline):
        if not header.startswith('*'):
            return None

    query_only = 'Query' in qualifier
    no_query = 'No Query' in qualifier

    return header, query_only, no_query


def normalize_header(h):
    """Normalize a header for lookup: uppercase, strip trailing ?"""
    return h.upper().rstrip('?')


def parse_command_block(text, header_info):
    """Parse a command text block into structured data."""
    header, query_only, no_query = header_info

    if query_only or header.endswith('?'):
        cmd_type = "query"
    elif no_query:
        cmd_type = "set"
    else:
        cmd_type = "both"

    lines = text.split('\n')
    sections = {}
    current_section = 'description'
    sections[current_section] = []

    # Section label: standalone or inline with content
    section_re = re.compile(
        r'^(Group|Syntax|Arguments|Examples|Returns|Related Commands|Conditions|Restrictions)\s*(.*)',
        re.IGNORECASE
    )

    for line in lines:
        stripped = line.strip()
        if stripped == 'Commands listed in alphabetical order':
            continue
        if re.match(r'^\d+\s+(4/5/6 Series|MSO/DPO)', stripped):
            continue

        m = section_re.match(stripped)
        if m:
            label = m.group(1).lower()
            remainder = m.group(2).strip()
            if label == 'related commands':
                label = 'related'
            current_section = label
            if current_section not in sections:
                sections[current_section] = []
            if remainder:
                sections[current_section].append(remainder)
        else:
            if current_section not in sections:
                sections[current_section] = []
            sections[current_section].append(line)

    result = {
        'header': header,
        'commandType': cmd_type,
        'description': '',
        'group': '',
        'syntax_set': '',
        'syntax_query': '',
        'arguments': '',
        'examples_raw': '',
        'returns': '',
        'related': '',
    }

    # Description: strip header echo and qualifiers
    desc_lines = sections.get('description', [])
    desc = '\n'.join(desc_lines).strip()
    if desc.upper().startswith(header.upper().rstrip('?')):
        desc = desc[len(header.rstrip('?')):].strip()
    desc = re.sub(r'^\(Query [Oo]nly\)\s*', '', desc)
    desc = re.sub(r'^\(No Query Form\)\s*', '', desc)
    result['description'] = desc.strip()

    # Group
    group_lines = sections.get('group', [])
    result['group'] = ' '.join(g.strip() for g in group_lines).strip()

    # Syntax
    syntax_lines = sections.get('syntax', [])
    syntax_text = '\n'.join(syntax_lines).strip()
    for sline in syntax_text.split('\n'):
        sline = sline.strip()
        if not sline:
            continue
        if sline.endswith('?'):
            result['syntax_query'] = sline
        elif re.match(r'^[A-Z\*]', sline):
            if not result['syntax_set']:
                result['syntax_set'] = sline

    # Arguments
    arg_lines = sections.get('arguments', [])
    result['arguments'] = '\n'.join(arg_lines).strip()

    # Examples
    example_lines = sections.get('examples', [])
    result['examples_raw'] = '\n'.join(example_lines).strip()

    # Returns
    return_lines = sections.get('returns', [])
    result['returns'] = '\n'.join(return_lines).strip()

    # Related
    related_lines = sections.get('related', [])
    result['related'] = '\n'.join(related_lines).strip()

    return result


def build_pdf_index(cache_path, start_page, label):
    """Build a command index from PDF cache."""
    print(f"\n{'='*60}")
    print(f"Building PDF index for {label}")
    print(f"Starting from page {start_page}")

    with open(cache_path) as f:
        pages = json.load(f)

    total_pages = max(int(k) for k in pages.keys())
    print(f"Total pages in cache: {total_pages + 1}")

    # Build combined text per page for context checking
    all_text = {}
    for pg in range(start_page, total_pages + 1):
        all_text[pg] = pages.get(str(pg), '')

    # Find all command headers with context validation
    command_positions = []

    for pg in range(start_page, total_pages + 1):
        page_text = all_text[pg]
        lines = page_text.split('\n')
        for i, line in enumerate(lines):
            # Build following text for context check
            following_lines = lines[i+1:]
            # Also include next page
            if pg + 1 <= total_pages:
                following_lines += all_text.get(pg + 1, '').split('\n')
            following_text = '\n'.join(following_lines)

            info = is_valid_scpi_header(line, following_text)
            if info:
                command_positions.append((pg, i, info))

    print(f"Found {len(command_positions)} validated command headers")

    # Extract text blocks and parse
    index = {}
    for idx, (pg, line_idx, header_info) in enumerate(command_positions):
        header = header_info[0]
        page_text = all_text[pg]
        lines = page_text.split('\n')

        block_lines = list(lines[line_idx + 1:])

        if idx + 1 < len(command_positions):
            next_pg, next_line_idx, _ = command_positions[idx + 1]
            if next_pg == pg:
                trim_at = next_line_idx - (line_idx + 1)
                block_lines = block_lines[:trim_at]
            else:
                for extra_pg in range(pg + 1, next_pg + 1):
                    extra_text = all_text.get(extra_pg, '')
                    extra_lines = extra_text.split('\n')
                    if extra_pg == next_pg:
                        block_lines.extend(extra_lines[:next_line_idx])
                    else:
                        block_lines.extend(extra_lines)
        else:
            for extra_pg in range(pg + 1, min(pg + 3, total_pages + 1)):
                block_lines.extend(all_text.get(extra_pg, '').split('\n'))

        block_text = '\n'.join(block_lines)
        parsed = parse_command_block(block_text, header_info)
        norm = normalize_header(header)

        # Additional validation: reject if description is empty AND no group
        if not parsed['description'] and not parsed['group']:
            continue

        index[norm] = parsed

    print(f"Indexed {len(index)} unique commands")

    # Show some stats on what we found
    with_desc = sum(1 for v in index.values() if v['description'])
    with_group = sum(1 for v in index.values() if v['group'])
    with_examples = sum(1 for v in index.values() if v['examples_raw'])
    print(f"  With description: {with_desc}")
    print(f"  With group: {with_group}")
    print(f"  With examples: {with_examples}")

    return index


# ─── Phase 2: Fix JSON commands ─────────────────────────────────────────────

def parse_pdf_examples(examples_raw, header):
    """Parse raw example text into structured examples list."""
    if not examples_raw.strip():
        return []

    examples = []
    lines = examples_raw.strip().split('\n')
    current_scpi = None
    current_desc = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Pattern: "SCPI:COMMAND args verb-starting-description..."
        m = re.match(
            r'^([A-Z\*][A-Z:_\d<>?]+(?:\s+[^\s].*?)?)\s+'
            r'((?:sets|queries|might|returns|turns|enables|disables|creates|this|'
            r'specifies|indicates|is|clears|removes|adds|assigns|places|selects|'
            r'displays|aborts|resets|initiates|saves|loads|starts|stops|configures|'
            r'defines|establishes|would|should|could|the|that).*)',
            line, re.IGNORECASE
        )
        if m:
            if current_scpi is not None:
                examples.append({
                    'scpi': current_scpi,
                    'description': ' '.join(current_desc).strip()
                })
            current_scpi = m.group(1).strip()
            current_desc = [m.group(2).strip()]
        elif re.match(r'^[A-Z\*][A-Z:_\d<>]+', line) and not re.match(r'^[A-Z]{1,3}\s', line):
            if current_scpi is not None:
                examples.append({
                    'scpi': current_scpi,
                    'description': ' '.join(current_desc).strip()
                })
            current_scpi = line
            current_desc = []
        else:
            if current_scpi is not None:
                current_desc.append(line)
            else:
                current_scpi = line
                current_desc = []

    if current_scpi is not None:
        examples.append({
            'scpi': current_scpi,
            'description': ' '.join(current_desc).strip()
        })

    return examples


def first_sentence(text):
    """Extract first sentence from text."""
    if not text:
        return ''
    text = text.strip()
    m = re.search(r'[.!?](?:\s|$)', text)
    if m:
        return text[:m.end()].strip()
    first_line = text.split('\n')[0].strip()
    if len(first_line) < 200:
        return first_line
    return first_line[:200] + '...'


def is_contaminated_description(desc, cmd_scpi):
    """Check if a description is contaminated."""
    if not desc:
        return True
    if len(desc) < 10:
        return True
    # Description starts with a different SCPI command header
    if re.match(r'^[A-Z][A-Za-z]+:[A-Z]', desc):
        cmd_prefix = cmd_scpi.upper().split(':')[0]
        desc_prefix = desc.split(':')[0].upper()
        if desc_prefix != cmd_prefix:
            return True
        # Same prefix but the description IS just a command header (e.g. "POWer:POWer<x>:SOA?")
        first_line = desc.split('\n')[0].strip()
        if re.match(r'^[A-Z][A-Za-z<>:_\d{}]+\??\s*$', first_line):
            return True
    return False


def is_contaminated_example(examples, cmd_scpi):
    """Check if examples are contaminated."""
    if not examples:
        return False
    cmd_base = cmd_scpi.upper().rstrip('?').split(':')[0]
    for ex in examples:
        scpi = ex.get('scpi', '')
        if not scpi:
            continue
        ex_base = scpi.upper().split(':')[0].split(' ')[0].rstrip('?')
        if ex_base and cmd_base and ex_base != cmd_base and not scpi.startswith('*'):
            return True
        if re.match(r'^[a-z]', scpi) or scpi.startswith('This ') or scpi.startswith('indicating'):
            return True
    return False


def is_contaminated_syntax(syntax_dict, cmd_scpi):
    """Check if syntax fields are contaminated."""
    if not syntax_dict or not isinstance(syntax_dict, dict):
        return False
    cmd_base = cmd_scpi.upper().rstrip('?').split(':')[0]
    for key in ('set', 'query'):
        val = syntax_dict.get(key, '')
        if not val:
            continue
        val_base = val.upper().split(':')[0].split(' ')[0].rstrip('?')
        if val_base and cmd_base and val_base != cmd_base:
            return True
    return False


def is_contaminated_manual_examples(examples, cmd_scpi):
    """Check if _manualEntry examples/code are contaminated."""
    if not examples:
        return False
    for ex in examples:
        if isinstance(ex, str):
            if re.match(r'^[a-z]', ex) or ex.startswith('This ') or ex.startswith('indicating'):
                return True
        elif isinstance(ex, dict):
            scpi = ex.get('scpi', '') or ex.get('code', '')
            if re.match(r'^[a-z]', str(scpi)) or str(scpi).startswith('This ') or str(scpi).startswith('indicating'):
                return True
    return False


def build_new_command(header, pdf_data, group_name):
    """Build a new command JSON structure from PDF data."""
    scpi = pdf_data['header']
    desc = pdf_data['description'] or ''
    # Clean up description: remove leading page numbers, manual titles
    desc = re.sub(r'^\d+\s*$', '', desc, flags=re.MULTILINE).strip()
    desc = re.sub(r'^.*Series MSO Programmer Manual.*$', '', desc, flags=re.MULTILINE).strip()
    desc = re.sub(r'^.*MSO/DPO\d+.*$', '', desc, flags=re.MULTILINE).strip()
    desc = re.sub(r'^.*DPO\d+.*DSA\d+.*$', '', desc, flags=re.MULTILINE).strip()
    desc = re.sub(r'^.*Digital Oscilloscopes.*$', '', desc, flags=re.MULTILINE).strip()
    desc = re.sub(r'^Commands listed in alphabetical order\s*', '', desc).strip()
    desc = re.sub(r'^\d+-\d+\s+', '', desc).strip()  # Remove page refs like "2-1168 "
    if not desc or len(desc) < 5:
        desc = f"Sets or queries the {scpi} setting."
    short_desc = first_sentence(desc)
    cmd_type = pdf_data['commandType']

    examples = parse_pdf_examples(pdf_data['examples_raw'], header)

    syntax_list = []
    syntax_dict = {}
    if pdf_data['syntax_set']:
        syntax_list.append(pdf_data['syntax_set'])
        syntax_dict['set'] = pdf_data['syntax_set']
    if pdf_data['syntax_query']:
        syntax_list.append(pdf_data['syntax_query'])
        syntax_dict['query'] = pdf_data['syntax_query']
    if not syntax_list:
        if cmd_type == 'query':
            s = scpi if scpi.endswith('?') else scpi + '?'
            syntax_list.append(s)
            syntax_dict['query'] = s
        else:
            syntax_list.append(scpi)
            syntax_dict['set'] = scpi

    parts = scpi.rstrip('?').split(':')
    name = parts[-1] if parts else scpi

    return {
        "scpi": scpi,
        "description": desc,
        "conditions": None,
        "group": group_name,
        "syntax": syntax_list,
        "relatedCommands": pdf_data['related'] if pdf_data['related'] else None,
        "arguments": pdf_data['arguments'] if pdf_data['arguments'] else None,
        "examples": examples,
        "returns": pdf_data['returns'] if pdf_data['returns'] else None,
        "shortDescription": short_desc,
        "notes": [],
        "name": name,
        "params": [],
        "example": examples[0]['scpi'].upper() if examples else scpi.upper(),
        "_manualEntry": {
            "command": scpi,
            "header": scpi.rstrip('?'),
            "mnemonics": [scpi],
            "commandType": cmd_type,
            "description": desc,
            "shortDescription": short_desc,
            "arguments": pdf_data['arguments'] if pdf_data['arguments'] else None,
            "examples": examples,
            "relatedCommands": pdf_data['related'].split('\n') if pdf_data['related'] else [],
            "commandGroup": group_name,
            "syntax": syntax_dict,
            "manualReference": {"section": group_name},
            "notes": []
        }
    }


def fix_json_file(json_path, pdf_index, label):
    """Fix all contaminated commands in a JSON file."""
    print(f"\n{'='*60}")
    print(f"Fixing {label}: {json_path}")

    with open(json_path) as f:
        data = json.load(f)

    stats = defaultdict(int)

    # Build set of existing commands (normalized)
    existing_commands = set()
    for gname, gdata in data['groups'].items():
        for cmd in gdata['commands']:
            existing_commands.add(normalize_header(cmd['scpi']))

    print(f"Existing commands in JSON: {len(existing_commands)}")
    print(f"Commands in PDF index: {len(pdf_index)}")

    # Fix existing commands
    for gname, gdata in data['groups'].items():
        for cmd in gdata['commands']:
            stats['commands_checked'] += 1
            scpi = cmd['scpi']
            norm = normalize_header(scpi)

            if norm not in pdf_index:
                continue

            stats['pdf_matches'] += 1
            pdf = pdf_index[norm]
            me = cmd.get('_manualEntry', {}) or {}

            # a. Fix description
            if is_contaminated_description(cmd.get('description', ''), scpi):
                if pdf['description'] and len(pdf['description']) >= 10:
                    cmd['description'] = pdf['description']
                    stats['descriptions_fixed'] += 1

            if me and is_contaminated_description(me.get('description', ''), scpi):
                if pdf['description'] and len(pdf['description']) >= 10:
                    me['description'] = pdf['description']

            # b. Fix shortDescription
            new_short = first_sentence(cmd.get('description', ''))
            if new_short and len(new_short) >= 10:
                old_short = cmd.get('shortDescription', '') or ''
                if is_contaminated_description(old_short, scpi) or len(old_short) < 10:
                    cmd['shortDescription'] = new_short
                    if me:
                        me['shortDescription'] = new_short
                    stats['short_descriptions_fixed'] += 1

            # c. Fix examples
            if is_contaminated_example(cmd.get('examples', []), scpi):
                new_examples = parse_pdf_examples(pdf['examples_raw'], scpi)
                if new_examples:
                    cmd['examples'] = new_examples
                    if me:
                        me['examples'] = new_examples
                    cmd['example'] = new_examples[0]['scpi'].upper()
                    stats['examples_fixed'] += 1

            # d. Fix commandType
            if me:
                current_type = me.get('commandType', '')
                expected = pdf['commandType']
                if scpi.endswith('?') and current_type in ('set', 'both'):
                    me['commandType'] = 'query'
                    stats['types_fixed'] += 1
                elif expected == 'set' and current_type == 'both':
                    me['commandType'] = 'set'
                    stats['types_fixed'] += 1
                elif expected == 'query' and current_type in ('set', 'both'):
                    me['commandType'] = 'query'
                    stats['types_fixed'] += 1

            # e. Fix _manualEntry.syntax
            if me and is_contaminated_syntax(me.get('syntax', {}), scpi):
                new_syntax = {}
                if pdf['syntax_set']:
                    new_syntax['set'] = pdf['syntax_set']
                if pdf['syntax_query']:
                    new_syntax['query'] = pdf['syntax_query']
                if new_syntax:
                    me['syntax'] = new_syntax
                    stats['syntax_fixed'] += 1

            # f. Fix _manualEntry.code / examples with English text
            if me:
                for key in ('code', 'examples'):
                    if is_contaminated_manual_examples(me.get(key, []), scpi):
                        new_examples = parse_pdf_examples(pdf['examples_raw'], scpi)
                        if new_examples:
                            me[key] = new_examples
                            stats['manual_examples_fixed'] += 1

    # ─── Add missing commands ────────────────────────────────────────────

    # Build group mapping (case-insensitive)
    group_map = {}
    for gname, gdata in data['groups'].items():
        group_map[gname.lower()] = gname
        group_map[gdata['name'].lower()] = gname

    # Extended aliases
    extra_aliases = {
        'acquisition': 'Acquisition', 'horizontal': 'Horizontal',
        'vertical': 'Vertical', 'trigger': 'Trigger', 'display': 'Display',
        'measurement': 'Measurement', 'math': 'Math', 'cursor': 'Cursor',
        'bus': 'Bus', 'search': 'Search', 'afg': 'AFG',
        'calibration': 'Calibration', 'save and recall': 'Save and Recall',
        'miscellaneous': 'Miscellaneous', 'status and error': 'Status and Error',
        'alias': 'Alias', 'power': 'Power', 'mask': 'Mask', 'dvm': 'DVM',
        'histogram': 'Histogram', 'hardcopy': 'Hardcopy',
        'ethernet': 'Ethernet', 'waveform transfer': 'Waveform Transfer',
        'zoom': 'Zoom', 'act on event': 'Act On Event',
        'callout': 'Callout', 'plot': 'Plot', 'digital': 'Digital',
    }

    prefix_to_group = {
        'ACQUIRE': 'Acquisition', 'ACTONEV': 'Act On Event',
        'HORIZONTAL': 'Horizontal', 'TRIGGER': 'Trigger',
        'DISPLAY': 'Display', 'MEASUREMENT': 'Measurement',
        'MATH': 'Math', 'CURSOR': 'Cursor', 'BUS': 'Bus',
        'SEARCH': 'Search', 'AFG': 'AFG', 'CALIBRATE': 'Calibration',
        'POWER': 'Power', 'CH': 'Vertical', 'DVM': 'DVM',
        'MASK': 'Mask', 'HISTOGRAM': 'Histogram', 'ETHERNET': 'Ethernet',
        'ZOOM': 'Zoom', 'SAVE': 'Save and Recall', 'RECALL': 'Save and Recall',
        'RECAL': 'Save and Recall', 'HARDCOPY': 'Hardcopy', 'ALIAS': 'Alias',
        'DATA': 'Waveform Transfer', 'WFMOUTPRE': 'Waveform Transfer',
        'WFMINPRE': 'Waveform Transfer', 'CURVE': 'Waveform Transfer',
        'WAVFRM': 'Waveform Transfer', 'CURVESTREAM': 'Waveform Transfer',
        'PLOT': 'Plot', 'CALLOUT': 'Callout', 'EYEMASK': 'Mask',
        'SAVEON': 'Save and Recall', 'SELECT': 'Vertical',
        'VISUAL': 'Display', 'REF': 'Save and Recall',
        'FILESYSTEM': 'Save and Recall', 'DIGGRP': 'Digital',
        'COUNTER': 'Miscellaneous', 'LIMIT': 'Miscellaneous',
        'ERRORDETECTOR': 'Miscellaneous', 'EMAIL': 'Miscellaneous',
        'EXPORT': 'Save and Recall', 'ALLOCATE': 'Miscellaneous',
        'MARK': 'Miscellaneous', 'SETHOLD': 'Trigger',
        'SETUP': 'Save and Recall', 'TEST': 'Miscellaneous',
        'FORMAT': 'Miscellaneous', 'APPLICATION': 'Miscellaneous',
    }

    added_count = 0
    skipped_groups = defaultdict(int)

    # Pre-compute known first segments for validation
    known_firsts = set()
    for g in data['groups'].values():
        for c in g['commands']:
            known_firsts.add(c['scpi'].split(':')[0].upper().rstrip('?'))

    for norm, pdf in pdf_index.items():
        if norm in existing_commands:
            continue

        # Additional validation for new commands
        header = pdf['header']
        first_seg = header.rstrip('?').split(':')[0]

        # Reject if first segment looks like a sentence (very long lowercase run)
        if re.search(r'[a-z]{13,}', first_seg):
            continue

        # All segments must start with an uppercase letter or < or digit
        segments = header.rstrip('?').split(':')
        if any(not seg or (not seg[0].isupper() and seg[0] not in '<') for seg in segments):
            continue

        # Reject if any segment contains embedded common English words
        is_sentence_frag = False
        for seg in segments:
            if re.search(r'(?:and|the|for|that|this|with|from|which|have|when|into)[A-Z]', seg):
                is_sentence_frag = True
                break
        if is_sentence_frag:
            continue

        # Reject if the description starts with a lowercase word continuation
        # (sign of a page-boundary header truncation)
        desc_text = (pdf.get('description', '') or '').strip()
        if desc_text and re.match(r'^[a-z]', desc_text):
            continue

        # Reject if description starts with 1-2 char uppercase completion fragment
        # (sign of page-break header truncation like FAMILYCO -> De This command...)
        if desc_text and re.match(r'^[A-Z][a-z]{0,2}\s', desc_text):
            first_word = desc_text.split()[0] if desc_text.split() else ''
            if len(first_word) <= 3 and first_word not in ('ON', 'OFF', 'DC', 'AC', 'OR', 'AND',
                                                            'NOT', 'ALL', 'SET', 'NO', 'The', 'This',
                                                            'An', 'A', 'If', 'It', 'Is', 'In', 'To',
                                                            'Use', 'See', 'For', 'Has', 'Can', 'May',
                                                            'Get', 'Put', 'Run', 'Any', 'One', 'Two',
                                                            'New', 'Old', 'Add', 'End', 'Bus', 'Bit',
                                                            'Low', 'Mid', 'Max', 'Min', 'Yes',
                                                            'Hex', 'Bin', 'Dec', 'Oct', 'Key', 'Ref'):
                continue

        # First segment must be a known SCPI root
        first_seg_upper = first_seg.upper()
        if first_seg_upper not in known_firsts and not header.startswith('*'):
            continue

        # Reject if description is garbage (just a page number)
        desc = pdf.get('description', '') or ''
        if desc and re.match(r'^\d+$', desc.strip()):
            continue

        pdf_group = (pdf.get('group', '') or '').strip().lower()

        # Find target group
        target_group = None
        if pdf_group in group_map:
            target_group = group_map[pdf_group]
        elif pdf_group in extra_aliases and extra_aliases[pdf_group] in data['groups']:
            target_group = extra_aliases[pdf_group]

        if not target_group:
            prefix = pdf['header'].split(':')[0].upper().rstrip('?')
            for pref, grp in prefix_to_group.items():
                if prefix.startswith(pref) or prefix == pref:
                    if grp in data['groups']:
                        target_group = grp
                        break

        if not target_group:
            if 'Miscellaneous' in data['groups']:
                target_group = 'Miscellaneous'
            else:
                skipped_groups[pdf_group] += 1
                continue

        new_cmd = build_new_command(norm, pdf, target_group)
        data['groups'][target_group]['commands'].append(new_cmd)
        existing_commands.add(norm)
        added_count += 1

    stats['new_commands_added'] = added_count

    if skipped_groups:
        print(f"  Could not map {sum(skipped_groups.values())} commands:")
        for g, c in sorted(skipped_groups.items(), key=lambda x: -x[1])[:5]:
            print(f"    '{g}': {c}")

    print(f"  New commands added: {added_count}")

    return data, stats


def main():
    all_stats = {}

    for config in PDF_CONFIGS:
        label = config['label']
        cache_path = config['cache']
        json_path = config['json']
        start_page = config['cmd_start_page']

        if not os.path.exists(cache_path) or not os.path.exists(json_path):
            print(f"WARNING: Missing files for {label}")
            continue

        # Phase 1
        pdf_index = build_pdf_index(cache_path, start_page, label)

        # Phase 2
        fixed_data, stats = fix_json_file(json_path, pdf_index, label)

        # Phase 3: Save
        backup_path = json_path + '.bak3'
        print(f"  Creating backup: {backup_path}")
        shutil.copy2(json_path, backup_path)

        print(f"  Writing: {json_path}")
        with open(json_path, 'w') as f:
            json.dump(fixed_data, f, indent=2, ensure_ascii=False)

        # Verify
        with open(json_path) as f:
            verified = json.load(f)
        total_cmds = sum(len(g['commands']) for g in verified['groups'].values())
        print(f"  Verified: valid JSON, {total_cmds} total commands")

        all_stats[label] = dict(stats)

    # Report
    print(f"\n{'='*60}")
    print("FINAL REPORT")
    print(f"{'='*60}")

    total_changes = 0
    for label, stats in all_stats.items():
        print(f"\n{label}:")
        for key in ['commands_checked', 'pdf_matches', 'descriptions_fixed',
                     'short_descriptions_fixed', 'examples_fixed', 'types_fixed',
                     'syntax_fixed', 'manual_examples_fixed', 'new_commands_added']:
            print(f"  {key:30s}: {stats.get(key, 0)}")
        file_total = sum(v for k, v in stats.items()
                        if k not in ('commands_checked', 'pdf_matches'))
        print(f"  {'TOTAL CHANGES':30s}: {file_total}")
        total_changes += file_total

    print(f"\nGRAND TOTAL CHANGES: {total_changes}")


if __name__ == '__main__':
    main()
