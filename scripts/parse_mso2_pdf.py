#!/usr/bin/env python3
"""
parse_mso2_pdf.py
-----------------
Parses the full 2-Series MSO Programmer Manual PDF and extracts every command
into the same JSON schema used by mso_2_4_5_6_7.json.

Merges with the existing mso2.json (already 934 commands from the source JSON
filter) — PDF entries for commands already present will OVERRIDE/update them;
PDF entries for new commands will be ADDED.

Usage:
    python scripts/parse_mso2_pdf.py [path_to_pdf]

Default PDF path: C:/Users/u650455/Downloads/2-Series-MSO-Programmer_077177606.pdf
Output: C:/Users/u650455/Desktop/Tek_Automator/mso2.json  (overwritten with full set)
"""

import json, re, sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("ERROR: pdfplumber not installed. Run: python -m pip install pdfplumber")

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).resolve().parent.parent
PDF_PATH   = Path(r"C:\Users\u650455\Downloads\2-Series-MSO-Programmer_077177606.pdf")
if len(sys.argv) > 1:
    PDF_PATH = Path(sys.argv[1])

OUTPUT_JSON = ROOT.parent / "mso2.json"

# Pages in the PDF that contain the alphabetical command reference
# (0-indexed). Adjust if manual revision changes pagination.
CMD_START_PAGE = 94   # page 95 (0-indexed = 94)
CMD_END_PAGE   = 796  # page 797

# ─────────────────────────────────────────────────────────────────────────────
# Section labels that appear as "field markers" inside a command block
# ─────────────────────────────────────────────────────────────────────────────
FIELD_MARKERS = [
    "Group", "Syntax", "RelatedCommands", "Arguments",
    "Examples", "Returns", "Conditions", "Notes",
]
FIELD_RE = re.compile(
    r'^(' + '|'.join(FIELD_MARKERS) + r')\s+(.*)',
    re.DOTALL
)

# A command header line looks like:  CH<x>:BANdwidth  or  TRIGger:A:EDGE:SLOpe
# SCPI uses mixed-case where lowercase letters are optional in abbreviation:
#   TRIGger  ACQuire  BANdwidth  etc.
# It may end with optional annotation like "(Query Only)" or "(No Query Form)"
CMD_HEADER_RE = re.compile(
    r'^([A-Z][A-Za-z0-9_\-]*(?:[:<>][A-Za-z0-9_<>.,\-]*)*\??)'  # SCPI header (mixed-case)
    r'(\s*\([^)]+\))?'                                            # optional (Query Only)
    r'\s*$'
)

NOISE_LINES = re.compile(
    r'^(Commands listed in alphabetical order'
    r'|2-?Series\s?MSO\s?Programmer\s?Manual'
    r'|2\s+Series\s+MSO'
    r'|\d+-\d+'           # page footers like "2-183"
    r'|Index-\d+'
    r'|www\.tektronix'
    r'|<<<PAGE>>>'
    r')$',
    re.IGNORECASE
)

# Matches any fragment that looks like a manual page footer (to strip from field values)
PAGE_FOOTER_RE = re.compile(
    r'\s*2-?\s*Series\s*MSO\s*Programmer\s*Manual\s*[\d\-]*'
    r'|\s*\d+-\d+\s*2-?\s*Series\s*MSO'
    r'|\s*[\d]+-[\d]+\s*$',
    re.IGNORECASE
)

# ─────────────────────────────────────────────────────────────────────────────


def is_cmd_header(line: str) -> bool:
    """Return True if line looks like a stand-alone SCPI command header."""
    line = line.strip()
    if not line:
        return False
    if NOISE_LINES.match(line):
        return False
    # Must start with uppercase letter
    if not line[0].isupper():
        return False
    m = CMD_HEADER_RE.match(line)
    if not m:
        return False
    # Must contain at least one colon OR be an all-caps word (e.g. *CLS)
    hdr = m.group(1)
    if ':' not in hdr and not hdr.startswith('*') and not re.match(r'^[A-Z]{2,}$', hdr):
        return False
    return True


def normalise_scpi(s: str) -> str:
    return re.sub(r'\s+', '', s.strip().lower().rstrip('?'))


def extract_text_pages(pdf, start: int, end: int) -> list[str]:
    """Extract text from each page in range, return list of page strings."""
    pages = []
    for i in range(start, min(end + 1, len(pdf.pages))):
        txt = pdf.pages[i].extract_text() or ''
        pages.append(txt)
    return pages


def parse_commands(pages: list[str]) -> list[dict]:
    """Parse all command blocks from the combined page text."""
    # Join all pages with a clear page boundary marker
    combined = '\n<<<PAGE>>>\n'.join(pages)

    # Split into lines
    lines = combined.splitlines()

    commands = []
    current_cmd = None
    current_field = None
    field_buf = []

    def flush_field():
        nonlocal current_field, field_buf
        if current_cmd is not None and current_field:
            val = ' '.join(field_buf).strip()
            # Strip page footer fragments that bled into field text
            val = PAGE_FOOTER_RE.sub('', val).strip()
            # Clean up runs of whitespace
            val = re.sub(r'\s{2,}', ' ', val)
            current_cmd[current_field.lower()] = val
        current_field = None
        field_buf = []

    def flush_cmd():
        nonlocal current_cmd
        flush_field()
        if current_cmd:
            commands.append(current_cmd)
        current_cmd = None

    desc_buf = []

    for raw_line in lines:
        line = raw_line.strip()

        # Skip noise
        if not line or line == '<<<PAGE>>>' or NOISE_LINES.match(line):
            continue

        if current_cmd is None:
            # ── No active command yet: only look for a command header ──────────
            if is_cmd_header(line):
                hdr_clean = re.sub(r'\s*\([^)]+\)\s*$', '', line).strip()
                current_cmd = {
                    'scpi': hdr_clean,
                    'name': hdr_clean,
                    'description': '',
                    'shortDescription': '',
                    'group': '',
                    'syntax': '',
                    'arguments': '',
                    'returns': '',
                    'examples': '',
                    'relatedCommands': '',
                    'conditions': '',
                    'notes': '',
                    'params': [],
                    'example': '',
                    '_manualEntry': {'header': hdr_clean, 'source': 'MSO2 PDF'},
                }
                current_field = None
                field_buf = []
                desc_buf = []
            # else: preamble / TOC text, skip
            continue

        # ── Active command ───────────────────────────────────────────────────
        # Only suppress header detection in Syntax and RelatedCommands fields:
        # - Syntax lists bare query forms like "CH<x>:BANdwidth?" which look like headers
        # - RelatedCommands lists bare SCPI names like "CH<x>:SCAle"
        # Examples/Arguments/Returns always have extra text so CMD_HEADER_RE won't false-match
        inside_syntax_like = current_field in ('Syntax', 'RelatedCommands')

        # Try field-marker transition (always allowed while in an active command)
        fm = FIELD_RE.match(line)
        if fm:
            flush_field()
            current_field = fm.group(1)
            rest = fm.group(2).strip()
            field_buf = [rest] if rest else []
            continue

        # Try new command header — but suppress inside Syntax-like fields
        # to avoid treating "CH<x>:BANdwidth?" (query form in Syntax) as a new cmd
        if not inside_syntax_like and is_cmd_header(line):
            # Flush current command
            if desc_buf:
                current_cmd['description'] = re.sub(
                    r'\s{2,}', ' ', ' '.join(desc_buf).strip()
                )
                desc_buf = []
            flush_cmd()

            hdr_clean = re.sub(r'\s*\([^)]+\)\s*$', '', line).strip()
            current_cmd = {
                'scpi': hdr_clean,
                'name': hdr_clean,
                'description': '',
                'shortDescription': '',
                'group': '',
                'syntax': '',
                'arguments': '',
                'returns': '',
                'examples': '',
                'relatedCommands': '',
                'conditions': '',
                'notes': '',
                'params': [],
                'example': '',
                '_manualEntry': {'header': hdr_clean, 'source': 'MSO2 PDF'},
            }
            current_field = None
            field_buf = []
            desc_buf = []
            continue

        # Accumulate into current field or description buffer
        if current_field:
            field_buf.append(line)
        else:
            desc_buf.append(line)

    # Flush last command
    if current_cmd is not None:
        if desc_buf:
            current_cmd['description'] = re.sub(
                r'\s{2,}', ' ', ' '.join(desc_buf).strip()
            )
        flush_cmd()

    return commands


_GROUP_CLEAN_RE = re.compile(
    r'(\s*\d[\dSeriesMSOProgrammrManualguidek\-]+.*$'   # anything starting with a digit chunk
    r'|\s*[A-Z]\w*SeriesMSO.*$'                          # anything starting with "2SeriesMSO..."
    r'|\s*Programmer.*$'                                  # trailing "ProgrammerManual..."
    r')',
    re.IGNORECASE
)


_GROUP_STRIP_RE = re.compile(
    r'(?:Programmer.*|Manual.*|\d+SeriesMSO.*|\s+\d[\d\-]+.*|[\d]+\s*$)',
    re.IGNORECASE
)


def assign_group(cmd: dict) -> str:
    """Use 'group' field from parsed data or derive from SCPI prefix."""
    g = cmd.get('group', '').strip()
    # Strip page-footer fragments aggressively:
    #   "BusProgrammerManual"  → "Bus"
    #   "Search and Mark 2SeriesMSOProgrammerManual 2-547" → "Search and Mark"
    #   "Vertical 2-193" → "Vertical"
    g_clean = _GROUP_STRIP_RE.sub('', g).strip()
    if g_clean and len(g_clean) < 50 and re.match(r'^[A-Za-z]', g_clean):
        return g_clean
    scpi = cmd.get('scpi', '')
    prefix = scpi.split(':')[0].upper()
    GROUP_MAP = {
        'ACQ': 'Acquisition', 'ACQUIRE': 'Acquisition',
        'AFG': 'AFG',
        'ALIAS': 'Alias',
        'ALLEV': 'Status and Error', 'ESR': 'Status and Error',
        'CLS': 'Status and Error', 'DESE': 'Status and Error',
        'BATTERY': 'Battery',
        'BUS': 'Bus',
        'CAL': 'Calibration',
        'CALLOUT': 'Callout', 'CALLOUTS': 'Callout',
        'CH': 'Vertical',
        'CONFIGURATION': 'Miscellaneous',
        'CURVE': 'Waveform Transfer', 'CURVESTREAM': 'Waveform Transfer',
        'WFMOUTPRE': 'Waveform Transfer', 'WFMPRE': 'Waveform Transfer',
        'CURSOR': 'Cursor',
        'DATA': 'Waveform Transfer',
        'DATE': 'Miscellaneous',
        'DCH': 'Digital',
        'DISPLAY': 'Display', 'DIS': 'Display',
        'ETHERNET': 'Ethernet',
        'FILESYSTEM': 'File System', 'FILES': 'File System',
        'HEADER': 'Miscellaneous',
        'HORIZONTAL': 'Horizontal',
        'IDN': 'Miscellaneous',
        'LIC': 'Miscellaneous',
        'MASK': 'Mask',
        'MATH': 'Math',
        'MEASUREMENT': 'Measurement', 'MEAS': 'Measurement',
        'PG': 'Pattern Generator',
        'PLOT': 'Plot',
        'POWER': 'Power',
        'REF': 'Save and Recall',
        'RECALL': 'Save and Recall', 'SAV': 'Save and Recall', 'SAVE': 'Save and Recall',
        'SCOPEAPP': 'Miscellaneous',
        'SEARCH': 'Search and Mark',
        'SELECT': 'Miscellaneous',
        'TRIGGER': 'Trigger', 'TRIG': 'Trigger',
        'VERTICAL': 'Vertical',
        'ZOOM': 'Zoom',
    }
    for pfx, grp in GROUP_MAP.items():
        if prefix.startswith(pfx):
            return grp
    return 'Miscellaneous'


def build_json(commands: list[dict]) -> dict:
    groups: dict[str, dict] = {}
    for cmd in commands:
        g = assign_group(cmd)
        cmd['group'] = g
        if g not in groups:
            groups[g] = {'name': g, 'description': '', 'commands': []}
        groups[g]['commands'].append(cmd)

    return {
        'version': '2.0',
        'manual': 'MSO2 Series Programmer Manual',
        'metadata': {
            'total_commands': len(commands),
            'total_groups': len(groups),
            'source': 'parsed from MSO2 PDF 077177606',
        },
        'groups': groups,
    }


def merge_with_existing(pdf_data: dict, existing_path: Path) -> dict:
    """
    Merge PDF-parsed commands into existing mso2.json.
    PDF entries win (override) for any command also in existing JSON.
    New commands from PDF are added.
    Commands in existing JSON NOT in PDF are KEPT.
    """
    if not existing_path.exists():
        return pdf_data

    with open(existing_path, encoding='utf-8', errors='replace') as f:
        existing = json.load(f)

    # Index existing by normalised scpi
    existing_idx: dict[str, dict] = {}
    for grp in existing.get('groups', {}).values():
        for cmd in grp.get('commands', []):
            key = normalise_scpi(cmd.get('scpi', '') or cmd.get('name', ''))
            existing_idx[key] = cmd

    # Index PDF commands
    pdf_idx: dict[str, dict] = {}
    for grp in pdf_data.get('groups', {}).values():
        for cmd in grp.get('commands', []):
            key = normalise_scpi(cmd.get('scpi', ''))
            pdf_idx[key] = cmd

    print(f"Existing JSON: {len(existing_idx)} commands")
    print(f"PDF parsed:   {len(pdf_idx)} commands")

    # Merge: PDF overrides existing for matching keys; keep existing-only entries
    merged_keys = set(existing_idx.keys()) | set(pdf_idx.keys())
    all_cmds = []
    overridden = 0
    new_from_pdf = 0
    kept_from_existing = 0

    def is_rich(cmd: dict) -> bool:
        """A command entry is 'rich' if it has at least a description or syntax."""
        return bool(cmd.get('description', '').strip() or cmd.get('syntax', '').strip())

    for key in merged_keys:
        if key in pdf_idx:
            pdf_cmd = pdf_idx[key]
            if key in existing_idx:
                ex = existing_idx[key]
                if is_rich(pdf_cmd):
                    # PDF has good data — use it, backfill richer existing fields
                    for field in ['params', 'example', 'shortDescription']:
                        if not pdf_cmd.get(field) and ex.get(field):
                            pdf_cmd[field] = ex[field]
                    all_cmds.append(pdf_cmd)
                    overridden += 1
                else:
                    # PDF entry is thin (no desc/syntax) — keep existing, mark as PDF-known
                    ex.setdefault('_manualEntry', {})['source'] = 'MSO2 PDF (thin)'
                    all_cmds.append(ex)
                    kept_from_existing += 1
            else:
                # New command only in PDF
                new_from_pdf += 1
                all_cmds.append(pdf_cmd)
        else:
            all_cmds.append(existing_idx[key])
            kept_from_existing += 1

    print(f"  Overridden by PDF: {overridden}")
    print(f"  New from PDF:      {new_from_pdf}")
    print(f"  Kept from existing (not in PDF): {kept_from_existing}")
    print(f"  Total merged:      {len(all_cmds)}")

    # Re-group
    groups: dict[str, dict] = {}
    for cmd in all_cmds:
        g = cmd.get('group') or assign_group(cmd)
        cmd['group'] = g
        if g not in groups:
            groups[g] = {'name': g, 'description': '', 'commands': []}
        groups[g]['commands'].append(cmd)

    return {
        'version': '2.0',
        'manual': 'MSO2 Series Programmer Manual',
        'metadata': {
            'total_commands': len(all_cmds),
            'total_groups': len(groups),
            'source': 'merged: MSO2 PDF + mso_2_4_5_6_7.json filter',
        },
        'groups': groups,
    }


def main():
    if not PDF_PATH.exists():
        sys.exit(f"ERROR: PDF not found: {PDF_PATH}")

    print(f"Opening {PDF_PATH} ...")
    with pdfplumber.open(PDF_PATH) as pdf:
        total = len(pdf.pages)
        print(f"  {total} pages total — extracting pages {CMD_START_PAGE+1} to {CMD_END_PAGE+1} ...")
        pages = extract_text_pages(pdf, CMD_START_PAGE, CMD_END_PAGE)

    print("Parsing commands ...")
    commands = parse_commands(pages)
    print(f"  Found {len(commands)} commands from PDF")

    pdf_data = build_json(commands)

    print(f"\nMerging with existing {OUTPUT_JSON} ...")
    merged = merge_with_existing(pdf_data, OUTPUT_JSON)

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)

    print(f"\nOK  Written {merged['metadata']['total_commands']} commands "
          f"across {merged['metadata']['total_groups']} groups -> {OUTPUT_JSON}")

    print("\nGroup breakdown:")
    for gname, grp in merged['groups'].items():
        print(f"  {gname}: {len(grp['commands'])} commands")


if __name__ == '__main__':
    main()
