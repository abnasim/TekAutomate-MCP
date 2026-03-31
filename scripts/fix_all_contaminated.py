#!/usr/bin/env python3
"""
Comprehensive fix for contaminated SCPI commands in JSON files.
Cross-references against PDF source data cached as JSON.
"""

import json
import re
import os
import shutil
import sys
from collections import defaultdict

# ─── Configuration ───────────────────────────────────────────────────────────

PDF_CONFIGS = [
    {
        "cache": "/tmp/mso_pdf_cache.json",
        "json": "/home/user/TekAutomate/public/commands/mso_2_4_5_6_7.json",
        "label": "MSO 4/5/6",
        "cmd_start_page": 157,  # First page with actual command definitions
    },
    {
        "cache": "/tmp/5k7k_pdf_cache.json",
        "json": "/home/user/TekAutomate/public/commands/MSO_DPO_5k_7k_70K.json",
        "label": "DPO 5K/7K/70K",
        "cmd_start_page": 116,
    },
]

# ─── Phase 1: Build PDF command index ────────────────────────────────────────

# Regex for SCPI command headers
HEADER_RE = re.compile(
    r'^([A-Z\*][A-Za-z<>:_\d{}|]+(?:\?)?)\s*'
    r'(?:\(Query [Oo]nly\)|\(No Query Form\))?\s*$'
)

SECTION_LABELS = {
    'group', 'syntax', 'arguments', 'examples', 'returns',
    'related commands', 'related', 'description'
}

FALSE_POSITIVE_LABELS = {
    'group', 'syntax', 'arguments', 'examples', 'returns',
    'related commands', 'description', 'note', 'notes',
    'conditions', 'restrictions'
}

def is_false_positive(line):
    """Check if a line that matches the header regex is actually a false positive."""
    stripped = line.strip()
    if len(stripped) < 4:
        return True
    if '|' in stripped and '{' not in stripped:
        return True
    low = stripped.lower().rstrip('?').rstrip()
    if low in FALSE_POSITIVE_LABELS:
        return True
    if low in ('commands listed in alphabetical order', 'command groups'):
        return True
    # Page numbers
    if re.match(r'^\d+$', stripped):
        return True
    # Single words that are section labels
    if low in ('group', 'syntax', 'arguments', 'examples', 'returns', 'related'):
        return True
    # Very short fragments that are likely continuation text
    if len(stripped) < 4:
        return True
    return False


def detect_header(line):
    """Detect if a line is a command header. Returns (header, query_only, no_query) or None."""
    stripped = line.strip()
    if not stripped:
        return None

    m = HEADER_RE.match(stripped)
    if not m:
        return None

    header = m.group(1)
    if is_false_positive(stripped):
        return None

    query_only = bool(re.search(r'\(Query [Oo]nly\)', stripped))
    no_query = bool(re.search(r'\(No Query Form\)', stripped))

    return header, query_only, no_query


def normalize_header(h):
    """Normalize a header for lookup: uppercase, strip trailing ?"""
    return h.upper().rstrip('?')


def parse_command_block(text, header_info):
    """Parse a command text block into structured data."""
    header, query_only, no_query = header_info

    # Determine command type
    if query_only or header.endswith('?'):
        cmd_type = "query"
    elif no_query:
        cmd_type = "set"
    else:
        cmd_type = "both"

    # Split into lines
    lines = text.split('\n')

    # Parse sections - handle both "label on own line" and "label inline" formats
    sections = {}
    current_section = 'description'
    sections[current_section] = []

    # Section label patterns - both standalone and inline
    section_re = re.compile(
        r'^(Group|Syntax|Arguments|Examples|Returns|Related Commands|Conditions|Restrictions)\s*(.*)',
        re.IGNORECASE
    )

    for line in lines:
        # Skip page headers
        if line.strip() == 'Commands listed in alphabetical order':
            continue
        if re.match(r'^\d+\s+(4/5/6 Series|MSO/DPO)', line.strip()):
            continue

        m = section_re.match(line.strip())
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

    # Clean up each section
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

    # Description
    desc_lines = sections.get('description', [])
    desc = '\n'.join(desc_lines).strip()
    # Remove the header itself from the start of description
    if desc.upper().startswith(header.upper().rstrip('?')):
        desc = desc[len(header.rstrip('?')):].strip()
    # Remove (Query Only) / (No Query Form) prefix
    desc = re.sub(r'^\(Query [Oo]nly\)\s*', '', desc)
    desc = re.sub(r'^\(No Query Form\)\s*', '', desc)
    result['description'] = desc.strip()

    # Group
    group_lines = sections.get('group', [])
    result['group'] = ' '.join(g.strip() for g in group_lines).strip()

    # Syntax
    syntax_lines = sections.get('syntax', [])
    syntax_text = '\n'.join(syntax_lines).strip()
    # Split into set and query forms
    base = header.rstrip('?')
    for sline in syntax_text.split('\n'):
        sline = sline.strip()
        if not sline:
            continue
        if sline.endswith('?') or sline.upper().endswith('?'):
            result['syntax_query'] = sline
        elif re.match(r'^[A-Z\*]', sline):
            if not result['syntax_set']:
                result['syntax_set'] = sline
            elif sline.endswith('?'):
                result['syntax_query'] = sline

    # If there's a combined syntax line with both set and query
    if not result['syntax_query'] and result['syntax_set']:
        # Check if the set line contains both
        parts = result['syntax_set'].split('\n')
        for p in parts:
            if p.strip().endswith('?'):
                result['syntax_query'] = p.strip()

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
    print(f"Building PDF index for {label} from {cache_path}")
    print(f"Starting from page {start_page}")

    with open(cache_path) as f:
        pages = json.load(f)

    total_pages = max(int(k) for k in pages.keys())
    print(f"Total pages in cache: {total_pages + 1}")

    # Collect all command headers and their positions
    command_positions = []  # (page, line_idx, header_info)

    for pg in range(start_page, total_pages + 1):
        page_text = pages.get(str(pg), '')
        lines = page_text.split('\n')
        for i, line in enumerate(lines):
            info = detect_header(line)
            if info:
                command_positions.append((pg, i, info))

    print(f"Found {len(command_positions)} command headers in PDF")

    # For each command, extract the text block until the next command header
    index = {}
    for idx, (pg, line_idx, header_info) in enumerate(command_positions):
        header = header_info[0]

        # Get text from current position to next command header
        page_text = pages.get(str(pg), '')
        lines = page_text.split('\n')

        # Start from after the header line
        block_lines = []

        # Add lines from current page after header
        for i in range(line_idx + 1, len(lines)):
            block_lines.append(lines[i])

        # Determine where to stop: look for next header
        # Check if next command is on same page
        if idx + 1 < len(command_positions):
            next_pg, next_line_idx, _ = command_positions[idx + 1]
            if next_pg == pg:
                # Next header is on same page, trim block_lines
                # We collected from line_idx+1, so the next header would be at
                # next_line_idx - (line_idx+1) in our block
                trim_at = next_line_idx - (line_idx + 1)
                block_lines = block_lines[:trim_at]
            else:
                # Next header is on a different page
                # Add pages in between and trim at next header
                for extra_pg in range(pg + 1, next_pg + 1):
                    extra_text = pages.get(str(extra_pg), '')
                    extra_lines = extra_text.split('\n')
                    if extra_pg == next_pg:
                        # Only add up to the next header
                        block_lines.extend(extra_lines[:next_line_idx])
                    else:
                        block_lines.extend(extra_lines)
        else:
            # Last command - add next 2 pages
            for extra_pg in range(pg + 1, min(pg + 3, total_pages + 1)):
                extra_text = pages.get(str(extra_pg), '')
                block_lines.extend(extra_text.split('\n'))

        block_text = '\n'.join(block_lines)
        parsed = parse_command_block(block_text, header_info)
        norm = normalize_header(header)
        index[norm] = parsed

    print(f"Indexed {len(index)} unique commands")
    return index


# ─── Phase 2: Fix JSON commands ─────────────────────────────────────────────

def parse_pdf_examples(examples_raw, header):
    """Parse raw example text into structured examples list."""
    if not examples_raw.strip():
        return []

    examples = []
    base_upper = header.upper().rstrip('?').split(':')[0]

    # Split examples by SCPI command patterns
    # Examples typically look like: "COMMAND:PATH value description"
    # or "COMMAND:PATH? might return ..."
    lines = examples_raw.strip().split('\n')
    current_scpi = None
    current_desc = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Check if line starts with an SCPI command (all caps with colons)
        m = re.match(r'^([A-Z\*][A-Z:_\d<>]+(?:\?)?(?:\s+\S.*?)?)\s+((?:sets|queries|might|returns|turns|enables|disables|creates|this|specifies|indicates|is|clears|removes|adds|assigns|places|selects|displays|aborts|resets|initiates|saves|loads|starts|stops|configures|defines).*)', line, re.IGNORECASE)
        if m:
            # Save previous example
            if current_scpi is not None:
                examples.append({
                    'scpi': current_scpi,
                    'description': ' '.join(current_desc).strip()
                })
            current_scpi = m.group(1).strip()
            current_desc = [m.group(2).strip()]
        elif re.match(r'^[A-Z\*][A-Z:_\d<>]+', line) and not re.match(r'^[A-Z]{1,3}\s', line):
            # Starts with SCPI-like command
            if current_scpi is not None:
                examples.append({
                    'scpi': current_scpi,
                    'description': ' '.join(current_desc).strip()
                })
            # Might be "COMMAND value" with description on next line or same line
            current_scpi = line
            current_desc = []
        else:
            # Continuation of previous description
            if current_scpi is not None:
                current_desc.append(line)
            else:
                # First example without clear SCPI prefix, treat whole thing as one
                current_scpi = line
                current_desc = []

    if current_scpi is not None:
        examples.append({
            'scpi': current_scpi,
            'description': ' '.join(current_desc).strip()
        })

    return examples


def first_sentence(text):
    """Extract the first sentence from text."""
    if not text:
        return ''
    # Remove leading whitespace/newlines
    text = text.strip()
    # Find first sentence ending
    m = re.search(r'[.!?](?:\s|$)', text)
    if m:
        return text[:m.end()].strip()
    # No sentence ending found - take first line if short enough
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
        # Check if it's the same command
        cmd_prefix = cmd_scpi.upper().split(':')[0]
        desc_prefix = desc.split(':')[0]
        if desc_prefix != cmd_prefix:
            return True
        # Even same prefix - check if it's a ? form used as description
        # e.g., description = "POWer:POWer<x>:SOA:SAVemask:FOLDer?"
        if re.match(r'^[A-Z][A-Za-z<>:_\d{}]+\??\s*$', desc.split('\n')[0]):
            return True
    return False


def is_contaminated_example(examples, cmd_scpi):
    """Check if examples are contaminated (contain foreign command headers)."""
    if not examples:
        return False
    cmd_base = cmd_scpi.upper().rstrip('?').split(':')[0]
    for ex in examples:
        scpi = ex.get('scpi', '')
        if not scpi:
            continue
        # Check if example SCPI starts with a completely different command tree
        ex_base = scpi.upper().split(':')[0].split(' ')[0].rstrip('?')
        if ex_base and cmd_base and ex_base != cmd_base and ex_base != '*' + cmd_base:
            # It's a different command family
            if not scpi.startswith('*'):  # *RST etc. are fine in any context
                return True
        # Check if "scpi" field contains English text instead of SCPI
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
        # Check if syntax contains a foreign SCPI header
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
            # Check if it's English text instead of SCPI
            if re.match(r'^[a-z]', ex) or ex.startswith('This ') or ex.startswith('indicating'):
                return True
        elif isinstance(ex, dict):
            scpi = ex.get('scpi', '') or ex.get('code', '')
            if re.match(r'^[a-z]', scpi) or scpi.startswith('This ') or scpi.startswith('indicating'):
                return True
    return False


def build_new_command(header, pdf_data, group_name):
    """Build a new command JSON structure from PDF data."""
    scpi = pdf_data['header']
    desc = pdf_data['description'] or f"Command {scpi}"
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
            syntax_list.append(scpi if scpi.endswith('?') else scpi + '?')
            syntax_dict['query'] = syntax_list[0]
        else:
            syntax_list.append(scpi)
            syntax_dict['set'] = scpi

    # Build name from header
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
            "manualReference": {
                "section": group_name
            },
            "notes": []
        }
    }


def fix_json_file(json_path, pdf_index, label):
    """Fix all contaminated commands in a JSON file."""
    print(f"\n{'='*60}")
    print(f"Fixing {label}: {json_path}")

    with open(json_path) as f:
        data = json.load(f)

    stats = {
        'descriptions_fixed': 0,
        'short_descriptions_fixed': 0,
        'examples_fixed': 0,
        'types_fixed': 0,
        'syntax_fixed': 0,
        'manual_examples_fixed': 0,
        'new_commands_added': 0,
        'commands_checked': 0,
        'pdf_matches': 0,
    }

    # Build set of existing commands (normalized)
    existing_commands = set()
    for gname, gdata in data['groups'].items():
        for cmd in gdata['commands']:
            norm = normalize_header(cmd['scpi'])
            existing_commands.add(norm)

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

            # a. Fix description
            if is_contaminated_description(cmd.get('description', ''), scpi):
                if pdf['description']:
                    old_desc = cmd.get('description', '')[:80]
                    cmd['description'] = pdf['description']
                    stats['descriptions_fixed'] += 1
                    if stats['descriptions_fixed'] <= 3:
                        print(f"  Fixed description: {scpi}")
                        print(f"    Old: {old_desc}")
                        print(f"    New: {pdf['description'][:80]}")

            # Also fix _manualEntry description
            me = cmd.get('_manualEntry', {})
            if me and is_contaminated_description(me.get('description', ''), scpi):
                if pdf['description']:
                    me['description'] = pdf['description']

            # b. Fix shortDescription
            new_short = first_sentence(cmd.get('description', ''))
            if new_short and cmd.get('shortDescription', '') != new_short:
                old_short = cmd.get('shortDescription', '')
                if is_contaminated_description(old_short, scpi) or len(old_short or '') < 10:
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
                    cmd['example'] = new_examples[0]['scpi'].upper() if new_examples else scpi.upper()
                    stats['examples_fixed'] += 1
                    if stats['examples_fixed'] <= 3:
                        print(f"  Fixed examples: {scpi}")

            # d. Fix commandType
            me = cmd.get('_manualEntry', {})
            if me:
                current_type = me.get('commandType', '')
                if scpi.endswith('?') and current_type in ('set', 'both'):
                    me['commandType'] = 'query'
                    stats['types_fixed'] += 1
                elif pdf['commandType'] == 'set' and current_type == 'both':
                    me['commandType'] = 'set'
                    stats['types_fixed'] += 1
                elif pdf['commandType'] == 'query' and current_type in ('set', 'both'):
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
                    if stats['syntax_fixed'] <= 3:
                        print(f"  Fixed syntax: {scpi}")

            # f. Fix _manualEntry.code / _manualEntry.examples containing English
            if me:
                for key in ('code', 'examples'):
                    if is_contaminated_manual_examples(me.get(key, []), scpi):
                        new_examples = parse_pdf_examples(pdf['examples_raw'], scpi)
                        if new_examples:
                            me[key] = new_examples
                            stats['manual_examples_fixed'] += 1

    # Add missing commands from PDF
    # Build group mapping
    group_map = {}  # lowercase group name -> json group key
    for gname, gdata in data['groups'].items():
        group_map[gdata['name'].lower()] = gname
        group_map[gname.lower()] = gname

    # Also build common aliases
    group_aliases = {
        'acquisition': 'Acquisition',
        'horizontal': 'Horizontal',
        'vertical': 'Vertical',
        'trigger': 'Trigger',
        'display': 'Display',
        'measurement': 'Measurement',
        'math': 'Math',
        'cursor': 'Cursor',
        'bus': 'Bus',
        'search': 'Search',
        'afg': 'AFG',
        'calibration': 'Calibration',
        'save and recall': 'Save and Recall',
        'miscellaneous': 'Miscellaneous',
        'status and error': 'Status and Error',
        'alias': 'Alias',
        'power': 'Power',
        'mask': 'Mask',
        'dvm': 'DVM',
        'histogram': 'Histogram',
        'hardcopy': 'Hardcopy',
        'ethernet': 'Ethernet',
        'waveform transfer': 'Waveform Transfer',
        'zoom': 'Zoom',
        'act on event': 'Act On Event',
        'callout': 'Callout',
        'plot': 'Plot',
        'digital': 'Digital',
        'recall': 'Save and Recall',
        'save/recall': 'Save and Recall',
    }

    missing_count = 0
    added_count = 0
    missing_groups = defaultdict(int)

    for norm, pdf in pdf_index.items():
        if norm in existing_commands:
            continue

        missing_count += 1
        pdf_group = pdf.get('group', '').strip()
        pdf_group_lower = pdf_group.lower() if pdf_group else ''

        # Find matching JSON group
        target_group = None
        if pdf_group_lower in group_map:
            target_group = group_map[pdf_group_lower]
        elif pdf_group_lower in group_aliases:
            alias = group_aliases[pdf_group_lower]
            if alias in data['groups']:
                target_group = alias
            elif alias.lower() in group_map:
                target_group = group_map[alias.lower()]

        # Try to infer group from command prefix
        if not target_group:
            header = pdf['header']
            prefix = header.split(':')[0].upper()
            prefix_map = {
                'ACQUIRE': 'Acquisition', 'HORIZONTAL': 'Horizontal',
                'TRIGGER': 'Trigger', 'DISPLAY': 'Display',
                'MEASUREMENT': 'Measurement', 'MATH': 'Math',
                'CURSOR': 'Cursor', 'BUS': 'Bus', 'SEARCH': 'Search',
                'AFG': 'AFG', 'CALIBRATION': 'Calibration',
                'POWER': 'Power', 'CH': 'Vertical', 'CHANNEL': 'Vertical',
                'DVM': 'DVM', 'MASK': 'Mask', 'HISTOGRAM': 'Histogram',
                'ETHERNET': 'Ethernet', 'ZOOM': 'Zoom',
                'SAVE': 'Save and Recall', 'RECALL': 'Save and Recall',
                'HARDCOPY': 'Hardcopy', 'ALIAS': 'Alias',
                'DATA': 'Waveform Transfer', 'WFMOUTPRE': 'Waveform Transfer',
                'WFMINPRE': 'Waveform Transfer', 'CURVE': 'Waveform Transfer',
                'WAVFRM': 'Waveform Transfer',
            }
            mapped = prefix_map.get(prefix, '')
            if mapped and mapped in data['groups']:
                target_group = mapped

        if not target_group:
            # Put in Miscellaneous as fallback
            if 'Miscellaneous' in data['groups']:
                target_group = 'Miscellaneous'
            else:
                missing_groups[pdf_group] += 1
                continue

        # Build and add new command
        new_cmd = build_new_command(norm, pdf, target_group)
        data['groups'][target_group]['commands'].append(new_cmd)
        existing_commands.add(norm)
        added_count += 1

    stats['new_commands_added'] = added_count

    if missing_groups:
        print(f"\n  Could not map {sum(missing_groups.values())} commands to groups:")
        for g, c in sorted(missing_groups.items(), key=lambda x: -x[1])[:10]:
            print(f"    '{g}': {c} commands")

    print(f"\n  Missing from JSON but in PDF: {missing_count}")
    print(f"  Successfully added: {added_count}")

    return data, stats


def main():
    all_stats = {}

    for config in PDF_CONFIGS:
        label = config['label']
        cache_path = config['cache']
        json_path = config['json']
        start_page = config['cmd_start_page']

        if not os.path.exists(cache_path):
            print(f"WARNING: Cache file not found: {cache_path}")
            continue
        if not os.path.exists(json_path):
            print(f"WARNING: JSON file not found: {json_path}")
            continue

        # Phase 1: Build PDF index
        pdf_index = build_pdf_index(cache_path, start_page, label)

        # Phase 2: Fix JSON
        fixed_data, stats = fix_json_file(json_path, pdf_index, label)

        # Phase 3: Save
        backup_path = json_path + '.bak3'
        print(f"\n  Creating backup: {backup_path}")
        shutil.copy2(json_path, backup_path)

        print(f"  Writing fixed JSON: {json_path}")
        with open(json_path, 'w') as f:
            json.dump(fixed_data, f, indent=2, ensure_ascii=False)

        # Verify JSON is valid
        try:
            with open(json_path) as f:
                verified = json.load(f)
            total_cmds = sum(len(g['commands']) for g in verified['groups'].values())
            print(f"  Verified: valid JSON with {total_cmds} total commands")
        except json.JSONDecodeError as e:
            print(f"  ERROR: JSON validation failed: {e}")

        all_stats[label] = stats

    # Final report
    print(f"\n{'='*60}")
    print("FINAL REPORT")
    print(f"{'='*60}")

    total_changes = 0
    for label, stats in all_stats.items():
        print(f"\n{label}:")
        print(f"  Commands checked:        {stats['commands_checked']}")
        print(f"  PDF matches found:       {stats['pdf_matches']}")
        print(f"  Descriptions fixed:      {stats['descriptions_fixed']}")
        print(f"  Short descriptions fixed: {stats['short_descriptions_fixed']}")
        print(f"  Examples fixed:          {stats['examples_fixed']}")
        print(f"  Command types fixed:     {stats['types_fixed']}")
        print(f"  Syntax fixed:            {stats['syntax_fixed']}")
        print(f"  Manual examples fixed:   {stats['manual_examples_fixed']}")
        print(f"  New commands added:      {stats['new_commands_added']}")
        file_total = sum(v for k, v in stats.items()
                        if k not in ('commands_checked', 'pdf_matches'))
        print(f"  Total changes:           {file_total}")
        total_changes += file_total

    print(f"\nGRAND TOTAL CHANGES: {total_changes}")


if __name__ == '__main__':
    main()
