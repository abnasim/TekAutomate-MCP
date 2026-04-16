"""
Parse SignalVu-PC Programmer Manual PDF and produce a clean rsa.json.

Groups all commands under the 15 functional root nodes from Table 8:
  IEEE_Common, ABORt, CALCulate, DISPlay, FETCh, INITiate, INPut,
  MMEMory, OUTPut, READ, SENSe, SOURce, STATus, SYSTem, TRACe,
  TRIGger, UNIT

Usage:
  python scripts/parse_rsa_pdf.py
"""

import json
import re
import pdfplumber

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"
OUT = r"public\commands\rsa.json"

# ─── Functional group definitions ────────────────────────────────────────────
# Map uppercase root prefix → canonical group key + human label

ROOT_MAP = {
    # IEEE 488.2 common commands start with *
    '*':            ('IEEE_Common',  'IEEE Common Commands'),
    # Functional groups from Table 8
    'ABORT':        ('ABORt',        'Abort Commands'),
    'CALCULATE':    ('CALCulate',    'Calculate Commands'),
    'CALC':         ('CALCulate',    'Calculate Commands'),
    'CALIBRATION':  ('CALibration',  'Calibration Commands'),
    'CALI':         ('CALibration',  'Calibration Commands'),
    'DISPLAY':      ('DISPlay',      'Display Commands'),
    'DISP':         ('DISPlay',      'Display Commands'),
    'FETCH':        ('FETCh',        'Fetch Commands'),
    'FETC':         ('FETCh',        'Fetch Commands'),
    'INITIATE':     ('INITiate',     'Initiate Commands'),
    'INIT':         ('INITiate',     'Initiate Commands'),
    'INPUT':        ('INPut',        'Input Commands'),
    'INP':          ('INPut',        'Input Commands'),
    'MMEMORY':      ('MMEMory',      'Mass Memory Commands'),
    'MMEM':         ('MMEMory',      'Mass Memory Commands'),
    'OUTPUT':       ('OUTPut',       'Output Commands'),
    'OUTP':         ('OUTPut',       'Output Commands'),
    'READ':         ('READ',         'Read Commands'),
    'SENSE':        ('SENSe',        'Sense Commands'),
    'SENS':         ('SENSe',        'Sense Commands'),
    'SOURCE':       ('SOURce',       'Source Commands'),
    'SOUR':         ('SOURce',       'Source Commands'),
    'STATUS':       ('STATus',       'Status Commands'),
    'STAT':         ('STATus',       'Status Commands'),
    'SYSTEM':       ('SYSTem',       'System Commands'),
    'SYST':         ('SYSTem',       'System Commands'),
    'TRACE':        ('TRACe',        'Trace Commands'),
    'TRAC':         ('TRACe',        'Trace Commands'),
    'TRIGGER':      ('TRIGger',      'Trigger Commands'),
    'TRIG':         ('TRIGger',      'Trigger Commands'),
    'UNIT':         ('UNIT',         'Unit Commands'),
}

GROUP_COLORS = {
    'IEEE_Common':  'bg-gray-100 text-gray-700',
    'ABORt':        'bg-red-100 text-red-700',
    'CALCulate':    'bg-blue-100 text-blue-700',
    'CALibration':  'bg-stone-100 text-stone-700',
    'DISPlay':      'bg-purple-100 text-purple-700',
    'FETCh':        'bg-green-100 text-green-700',
    'INITiate':     'bg-yellow-100 text-yellow-700',
    'INPut':        'bg-orange-100 text-orange-700',
    'MMEMory':      'bg-pink-100 text-pink-700',
    'OUTPut':       'bg-teal-100 text-teal-700',
    'READ':         'bg-cyan-100 text-cyan-700',
    'SENSe':        'bg-indigo-100 text-indigo-700',
    'SOURce':       'bg-lime-100 text-lime-700',
    'STATus':       'bg-amber-100 text-amber-700',
    'SYSTem':       'bg-violet-100 text-violet-700',
    'TRACe':        'bg-rose-100 text-rose-700',
    'TRIGger':      'bg-emerald-100 text-emerald-700',
    'UNIT':         'bg-sky-100 text-sky-700',
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def normalize_desc(raw: str) -> str:
    """Clean up a description string — preserve English word spacing."""
    s = raw.strip().replace('\n', ' ')
    s = re.sub(r'\s{2,}', ' ', s)
    s = s.strip('.,;')
    return s


def normalize_cmd(raw: str) -> str:
    """Clean up a raw SCPI command string from the PDF."""
    # Remove surrounding whitespace and newlines
    s = raw.strip().replace('\n', ' ')
    # Collapse multiple spaces
    s = re.sub(r'\s{2,}', ' ', s)
    # Remove spaces around colons: "OUTLier: HIGHer" → "OUTLier:HIGHer"
    s = re.sub(r'\s*:\s*', ':', s)
    # Fix PDF line-break artifacts where a SCPI mnemonic was split mid-word.
    # Rule 1: ALL-CAPS before space → broken mnemonic, join.
    # e.g. "GRID:ST ATe" → "GRID:STATe", "DELete TXGain" left alone (ends lowercase)
    s = re.sub(r'([A-Z]+) ([A-Za-z])', lambda m: m.group(1) + m.group(2), s)
    # Rule 2: lowercase-to-lowercase across space → broken word, join.
    # e.g. "REFeren ce" → "REFerEnce", "GRATicu le" → "GRATicule"
    # but "DELete TXGain" has lowercase-to-uppercase → left alone.
    s = re.sub(r'([a-z]) ([a-z])', lambda m: m.group(1) + m.group(2), s)
    # Rule 3: remove spaces inside/around pipe in choice braces: {A| B|C} → {A|B|C}
    s = re.sub(r'\|\s+', '|', s)
    s = re.sub(r'\s+\|', '|', s)
    # Rule 4: remove spaces before '[' (optional bracket in SCPI path)
    # e.g. "AVTime [:MEASview<y>]" → "AVTime[:MEASview<y>]"
    s = re.sub(r'\s+\[', '[', s)
    # Remove stray trailing/leading punctuation that isn't part of SCPI
    s = s.strip('.,;')
    return s


def get_root_upper(scpi: str) -> str:
    """Extract the uppercase root token from a SCPI command string."""
    s = scpi.strip()
    # Strip leading optional brackets: [ or {
    s = re.sub(r'^[\[\{]+', '', s)
    # Handle * prefix for IEEE commands
    if s.startswith('*'):
        return '*'
    # Take the first node (up to first : or space)
    match = re.match(r'([A-Za-z0-9_]+)', s)
    if not match:
        return ''
    return match.group(1).upper()


def map_group(scpi: str):
    """Return (group_key, group_label) for this SCPI command, or None if unknown."""
    root = get_root_upper(scpi)
    if not root:
        return None
    # Try exact match first, then prefix match
    if root in ROOT_MAP:
        return ROOT_MAP[root]
    # Try 4-char prefix
    if root[:4] in ROOT_MAP:
        return ROOT_MAP[root[:4]]
    return None


def is_query(scpi: str) -> bool:
    """True if this is a query-only command (ends with ?)."""
    s = scpi.rstrip()
    return s.endswith('?') and not s.endswith('(?)')


def command_type(scpi: str, desc: str) -> str:
    """Determine command type: 'write', 'query', or 'both'."""
    has_query_suffix = scpi.rstrip().endswith('?')
    # (?) means it can be both
    has_optional_query = '(?)' in scpi
    desc_l = desc.lower()
    returns_only = desc_l.startswith('returns') or desc_l.startswith('queries') or desc_l.startswith('query')
    sets_or_queries = 'sets or queries' in desc_l or 'set or quer' in desc_l

    if has_optional_query or sets_or_queries:
        return 'both'
    if has_query_suffix or returns_only:
        return 'query'
    return 'write'


def extract_params(scpi: str, desc: str, cmd_type: str):
    """
    Build a parameter list for this command.
    Returns list of param dicts.
    """
    params = []
    # Strip ? for analysis
    base = re.sub(r'\?$', '', scpi.strip())

    # Find <x>, <y> numeric index placeholders — these are instrument mnemonics, not user params
    # They become part of the SCPI template (e.g. MARKer<x> → user picks 1,2,3,4)
    # We expose them as a numeric param named 'x' (or 'y')
    has_x = '<x>' in base.lower()
    has_y = '<y>' in base.lower() or 'measview<y>' in base.lower()

    if has_x:
        params.append({
            'name': 'x',
            'type': 'numeric',
            'min': 1,
            'max': 4,
            'default': 1,
        })
    if has_y:
        params.append({
            'name': 'y',
            'type': 'numeric',
            'min': 1,
            'max': 8,
            'default': 1,
        })

    # If command is write or both, try to detect a value parameter
    if cmd_type in ('write', 'both'):
        desc_l = desc.lower()
        # Check if the command takes a value based on description
        has_value = ('sets or queries' in desc_l or 'set or quer' in desc_l or
                     'enables or disables' in desc_l or 'determines whether' in desc_l or
                     'specif' in desc_l)

        # Also check if the command string has a trailing node that suggests a settable value
        # e.g. FREQUENCY:CENTER (not just MAXIMUM or DELETE which are actions)
        action_words = {'maximum', 'minimum', 'add', 'delete', 'reset', 'clear', 'preset',
                        'preset', 'load', 'save', 'store', 'update', 'start', 'stop',
                        'abort', 'force', 'immediate', 'new', 'open', 'calibrate', 'reanalyze',
                        'select', 'deselect', 'show', 'hide'}
        last_node = re.split(r'[:\s]', base.rstrip())[-1].lower().rstrip('?')
        is_action = last_node in action_words

        if has_value and not is_action:
            # Try to detect boolean from description
            if 'enable' in desc_l or 'disable' in desc_l or 'on or off' in desc_l:
                params.append({'name': 'value', 'type': 'boolean', 'options': ['ON', 'OFF'], 'default': 'ON'})
            elif 'auto' in last_node:
                params.append({'name': 'value', 'type': 'boolean', 'options': ['ON', 'OFF'], 'default': 'ON'})
            elif any(w in desc_l for w in ('frequency', 'bandwidth', 'span', 'level', 'power', 'voltage',
                                            'time', 'count', 'length', 'number', 'rate', 'ratio',
                                            'threshold', 'offset', 'interval', 'step', 'tolerance',
                                            'center', 'gain', 'attenuation', 'percent')):
                params.append({'name': 'value', 'type': 'numeric', 'default': 0})
            else:
                params.append({'name': 'value', 'type': 'text', 'default': 'TEST'})

    return params


def build_scpi_template(scpi: str) -> str:
    """Convert raw PDF SCPI to a usable template string."""
    s = scpi.strip()
    # Remove trailing ? for write form
    s_base = re.sub(r'\?$', '', s)
    # Normalize <x> and <y> as they are (keep them, resolveScpi handles them)
    # Remove optional brackets around command portions like [:SEQuence]
    # but keep optional param brackets like [:Y] at the end which indicate optional query
    # Replace {value} / {level} / {param} style curly params — keep as {param_name}
    return s_base.strip()


def is_valid_scpi(cmd: str) -> bool:
    """Basic sanity check that this looks like a real SCPI command."""
    if not cmd:
        return False
    # Must start with letter, *, or optional bracket
    if not re.match(r'^[\[{*A-Za-z]', cmd):
        return False
    # Must contain at least one alphabetic character
    if not re.search(r'[A-Za-z]', cmd):
        return False
    # Reject likely garbage: purely lowercase prose, very long lines with spaces
    # A SCPI command should have colons or be a short single token
    words = cmd.split()
    if len(words) > 3:
        return False
    # Reject if it looks like prose (has common English words at start)
    prose_starts = {'the', 'this', 'note', 'table', 'use', 'for', 'see', 'if', 'when', 'all',
                    'you', 'to', 'a', 'an', 'command', 'commands', 'example', 'examples',
                    'parameter', 'parameters', 'syntax', 'description', 'not', 'only', 'are',
                    'where', 'these', 'sets', 'returns', 'queries', 'obsolete', 'replacement',
                    'header', 'function', 'subcommand', 'continued', 'writing', 'important'}
    first_word = words[0].lower().rstrip(':')
    if first_word in prose_starts:
        return False
    return True


def is_subgroup_header(cmd: str, desc: str) -> bool:
    """True if this row is a subgroup header, not an actual command."""
    cmd_l = cmd.lower()
    desc_l = desc.lower()
    if 'subgroup' in cmd_l or 'subgroup' in desc_l:
        return True
    if 'command group' in cmd_l:
        return True
    # Catch "subcommandgroup" and "subcommand group" (space may already be removed)
    if 'subcommand' in cmd_l:
        return True
    if cmd.strip() in ('Command', 'Header', 'Commands') and desc.strip() == 'Description':
        return True
    return False


def is_group_intro(scpi: str) -> bool:
    """True if SCPI is a bare root word (group intro line, not a real command)."""
    # A real SCPI command must contain a colon, start with *, or be a short action word
    # that maps to a known single-token command (like ABORt)
    s = scpi.strip().rstrip('?')
    # No colon means it's either a group intro or a single-token command
    if ':' not in s and not s.startswith('*'):
        # Allow known single-token commands
        root = get_root_upper(s)
        # Only ABORt is a valid single-token command per the manual
        if root == 'ABORT':
            return False
        return True
    return False


def looks_like_scpi_command(text: str) -> bool:
    """Returns True if the text looks like a SCPI replacement/obsolete command."""
    # If description IS itself a SCPI command path, this row is from obsolete table
    return bool(re.match(r'^[A-Z][A-Za-z]+:[A-Za-z]', text.strip()))


# ─── Main parsing ────────────────────────────────────────────────────────────

def parse_pdf(pdf_path: str) -> dict:
    """Parse the PDF and return a groups dict."""
    # groups[group_key] = {'name': str, 'description': str, 'commands': []}
    groups: dict[str, dict] = {}
    seen_scpi: set[str] = set()  # dedup by normalized SCPI
    total_commands = 0
    skipped = 0

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        print(f"Scanning {total_pages} pages...")

        for page_idx, page in enumerate(pdf.pages):
            if page_idx % 100 == 0:
                print(f"  Page {page_idx + 1}/{total_pages}...")

            tables = page.extract_tables()
            for table in tables:
                if not table or len(table) < 2:
                    continue

                # Check column count
                if len(table[0]) < 2:
                    continue

                # Check header — accept "Command", "Commands", "Header" in first column
                header = [str(c or '').strip().lower() for c in table[0][:2]]
                first_col = header[0]
                if first_col not in ('command', 'commands', 'header'):
                    continue
                # Skip obsolete commands tables (header: "obsolete commands | replacement commands")
                if 'obsolete' in first_col:
                    continue
                if len(table[0]) >= 2 and 'replacement' in str(table[0][1] or '').lower():
                    continue

                for row in table[1:]:
                    if len(row) < 2:
                        continue
                    raw_cmd = str(row[0] or '').strip()
                    raw_desc = str(row[1] or '').strip()

                    # Clean up
                    cmd = normalize_cmd(raw_cmd)
                    desc = normalize_desc(raw_desc)

                    if not cmd or not desc:
                        continue

                    # Skip subgroup headers
                    if is_subgroup_header(cmd, desc):
                        skipped += 1
                        continue

                    # Skip group intro rows (bare root word like "CALCulate", "DISPlay")
                    if is_group_intro(cmd):
                        skipped += 1
                        continue

                    # Skip rows from obsolete tables where description IS a SCPI command
                    if looks_like_scpi_command(desc):
                        skipped += 1
                        continue

                    # Basic SCPI validity check
                    if not is_valid_scpi(cmd):
                        skipped += 1
                        continue

                    # Determine functional group
                    group_info = map_group(cmd)
                    if group_info is None:
                        skipped += 1
                        continue

                    group_key, group_label = group_info

                    # Deduplicate by normalized SCPI (case-insensitive)
                    norm = cmd.upper().replace(' ', '')
                    if norm in seen_scpi:
                        continue
                    seen_scpi.add(norm)

                    # Build command entry
                    scpi_template = build_scpi_template(cmd)
                    cmd_type = command_type(cmd, desc)
                    params = extract_params(cmd, desc, cmd_type)

                    # Build human name from last SCPI node
                    last_node = re.split(r'[:\s]', scpi_template.rstrip())[-1]
                    last_node = re.sub(r'[<>\[\]{}?]', '', last_node)
                    # Build full path label for name
                    root_stripped = re.sub(r'^[\[\{]*[A-Za-z]+[\]\}]*:', '', scpi_template, count=1)
                    name = f"{last_node} ({group_key})"

                    entry = {
                        'name': name,
                        'scpi': scpi_template,
                        'description': desc,
                        '_manualEntry': {
                            'commandType': cmd_type,
                        },
                        'params': params,
                    }

                    if group_key not in groups:
                        groups[group_key] = {
                            'name': group_label,
                            'description': f"{group_label} for RSA Series / SignalVu-PC",
                            'color': GROUP_COLORS.get(group_key, 'bg-gray-100 text-gray-700'),
                            'commands': [],
                        }
                    groups[group_key]['commands'].append(entry)
                    total_commands += 1

    print(f"\nDone. Extracted {total_commands} unique commands across {len(groups)} groups.")
    print(f"Skipped {skipped} non-command rows.")
    print("\nGroup summary:")
    for k, g in sorted(groups.items(), key=lambda x: -len(x[1]['commands'])):
        print(f"  {k:20s}: {len(g['commands']):4d} commands")

    return groups


def main():
    print("Parsing RSA PDF...")
    groups = parse_pdf(PDF)

    total = sum(len(g['commands']) for g in groups.values())

    output = {
        'metadata': {
            'name': 'RSA Series / SignalVu-PC',
            'description': 'Real-Time Spectrum Analyzer SCPI commands — parsed from SignalVu-PC Programmer Manual (077-0721-22)',
            'instruments': ['RSA306B', 'RSA306', 'RSA500A', 'RSA600A', 'SignalVu-PC'],
            'version': '2.0',
            'source': 'SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf',
            'totalGroups': len(groups),
            'totalCommands': total,
        },
        'groups': groups,
    }

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\nWrote {OUT}")
    print(f"Total: {len(groups)} groups, {total} commands")


if __name__ == '__main__':
    main()
