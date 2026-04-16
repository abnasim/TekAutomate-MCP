"""
Parse SignalVu-PC command detail pages (page 167+) and enrich rsa.json
to match the MSO golden template format exactly.

Fields produced per command (matching mso_2_4_5_6_7.json):
  scpi, name, description, shortDescription, conditions, group,
  syntax (object with set/query strings INCLUDING argument placeholders),
  arguments (raw text), returns, relatedCommands, examples (array),
  notes, params, example (_manualEntry also enriched)

Usage:
  python scripts/enrich_rsa_details.py
"""
import json, re, sys
import pdfplumber

PDF      = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"
JSON_IN  = r"public\commands\rsa.json"   # base JSON from parse_rsa_pdf.py
JSON_OUT = r"public\commands\rsa.json"   # overwrite in place
DETAIL_START_PAGE = 166                  # 0-indexed (page 167 in manual)

# ─── Page noise patterns to strip ─────────────────────────────────────────────
PAGE_NOISE_RE = re.compile(
    r'SignalVu-PC[^\n]*Programmer Manual[^\n]*\n?'   # footer
    r'|\b\d{1,4}\s*\n'                                # bare page numbers
    r'|^Command descriptions\s*\n',                   # page header
    re.MULTILINE
)

# ─── Section markers that appear on their own line ────────────────────────────
SECTION_MARKERS = frozenset([
    'Conditions', 'Group', 'Syntax', 'Related Commands',
    'Arguments', 'Returns', 'Examples', 'Notes',
])

# ─── Words that look like section headers but shouldn't split blocks ──────────
NOT_CMD_STARTS = frozenset([
    'Command descriptions', 'Conditions', 'Group', 'Syntax',
    'Returns', 'Arguments', 'Examples', 'Related Commands', 'Notes',
    'Calculate commands', 'Sense commands', 'Trace commands',
    'Fetch commands', 'Read commands', 'Display commands',
    'Trigger commands', 'Status commands', 'System commands',
    'Memory commands', 'Initiate commands', 'Input commands',
    'Output commands', 'Unit commands', 'Source commands',
    'Abort commands', 'Calibration commands', 'IEEE common commands',
])

# A "command header" line: SCPI-like text optionally followed by qualifier
# Must match the FULL line (re.MULTILINE + \s*$)
CMD_HEADER_RE = re.compile(
    r'^([\[{*A-Z][A-Za-z0-9_:<>{}\[\]|.?*]+)'
    r'(\s*\([^)]*\))?'
    r'\s*$',
    re.MULTILINE,
)

# ─── Normalisation helpers ─────────────────────────────────────────────────────

def normalize_key(scpi: str) -> str:
    """Canonical key for matching (uppercase, no brackets, <X> for indices)."""
    s = scpi.strip()
    s = re.sub(r'\(\?\)', '', s)          # remove (?)
    s = re.sub(r'\?$', '', s)             # remove trailing ?
    s = re.sub(r'\s.*', '', s)            # drop any argument suffix (e.g. <value>)
    # Strip optional brackets: [SENSe]: → SENSE:
    s = re.sub(r'\[([A-Za-z0-9]+)\]:', lambda m: m.group(1).upper() + ':', s)
    s = re.sub(r'\[[^\]]*\]', '', s)      # remove remaining optional portions
    s = s.lstrip('[{')
    s = s.upper().replace(' ', '').strip(':')
    s = re.sub(r'([A-Z]+)\d+', r'\1<X>', s)   # CH1 → CH<X>
    s = re.sub(r'<[^>]+>', '<X>', s)           # <x>, <y> → <X>
    return s


def first_sentence(text: str) -> str:
    """Return the first sentence from a paragraph."""
    if not text:
        return ''
    m = re.search(r'[.!?]', text)
    return text[:m.end()].strip() if m else text[:120].strip()


# ─── Extract raw text from detail pages ───────────────────────────────────────

def extract_detail_text(pdf_path: str, start: int) -> str:
    chunks = []
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        print(f"Extracting pages {start+1}–{total}...")
        for i in range(start, total):
            if i % 300 == 0:
                print(f"  Page {i+1}...")
            t = pdf.pages[i].extract_text() or ''
            t = PAGE_NOISE_RE.sub('', t)
            chunks.append(t)
    return '\n'.join(chunks)


# ─── Split text into per-command blocks ───────────────────────────────────────

def is_cmd_header(text: str) -> bool:
    t = text.strip()
    if t in NOT_CMD_STARTS:
        return False
    if len(t) < 3:
        return False
    if ':' not in t and not t.startswith('*') and not t.startswith('['):
        root = re.sub(r'\d+$', '', t.rstrip('?')).upper()
        return root in {'ABORT'}
    return True


def _last_section_before(full_text: str, pos: int) -> str | None:
    """Return the name of the most recent section marker (e.g. 'Syntax') before pos."""
    window = full_text[max(0, pos - 900):pos]
    last_marker: str | None = None
    last_idx = -1
    for marker in SECTION_MARKERS:
        idx = window.rfind('\n' + marker + '\n')
        if idx > last_idx:
            last_idx = idx
            last_marker = marker
    return last_marker


def split_blocks(full_text: str) -> list:
    """
    Split the detail-page text into per-command blocks.

    Key insight: the PDF uses different fonts for
      (a) true command headers (the bold/title line at the top of each entry), and
      (b) syntax lines inside the Syntax section (monospace code font).
    Without font info, CMD_HEADER_RE matches both.  We disambiguate by looking
    at the section context: if the most recent section marker before a match is
    'Syntax' or 'Related Commands', the match is a code/reference line, NOT a
    new command header, so we skip it.
    """
    raw = [m for m in CMD_HEADER_RE.finditer(full_text)
           if is_cmd_header(m.group(1))]

    true_headers = []
    for m in raw:
        sec = _last_section_before(full_text, m.start())
        if sec in ('Syntax', 'Related Commands'):
            continue   # inside a code section — not a real block boundary
        true_headers.append(m)

    blocks = []
    for i, m in enumerate(true_headers):
        header   = m.group(1).strip()
        qual_raw = (m.group(2) or '').strip().strip('()')
        start    = m.end()
        end      = true_headers[i+1].start() if i+1 < len(true_headers) else len(full_text)
        body     = full_text[start:end].strip()
        blocks.append({'header': header, 'qualifier': qual_raw.lower(), 'body': body})

    print(f"Found {len(blocks)} raw blocks.")
    return blocks


# ─── Parse one block into structured sections ─────────────────────────────────

def parse_block(block: dict) -> dict:
    body = block['body']
    sections: dict[str, list] = {'__desc__': []}
    cur = '__desc__'
    for line in body.splitlines():
        s = line.strip()
        if s in SECTION_MARKERS:
            cur = s
            if cur not in sections:
                sections[cur] = []
        else:
            sections.setdefault(cur, []).append(line)

    def sec(name):
        return '\n'.join(sections.get(name, [])).strip()

    # Syntax: join continuation lines, then split write vs query.
    # A "new syntax form" starts with '[', '*', or a SCPI root (has ':' in first 30 chars).
    # Continuation lines (e.g. "NEVerdecimate }") don't look like SCPI and get appended.
    raw_syn = sections.get('Syntax', [])
    joined_syn: list[str] = []
    for line in raw_syn:
        s = line.strip()
        if not s:
            continue
        is_new_form = (
            s.startswith('[') or
            s.startswith('*') or
            (':' in s[:30])        # SCPI root word always has a colon early on
        )
        if is_new_form or not joined_syn:
            joined_syn.append(s)
        else:
            joined_syn[-1] = joined_syn[-1] + s   # join continuation without space gap

    # Mark as query-only ONLY when the manual explicitly says so in the header,
    # e.g. "SENSE:FSETtling:BW:ACTual? (Query Only)".
    # A bare trailing '?' is NOT enough — many headers are the query form of a
    # both-type command (the Syntax section re-states SCPI with '?').
    header_is_query = bool(re.search(r'\(query only\)', block['header'], re.IGNORECASE))

    syn_write = ''
    syn_query = ''
    for sl in joined_syn:
        if sl.rstrip().endswith('?'):
            if not syn_query:
                syn_query = sl
        else:
            if not syn_write:          # only take the FIRST write-form line
                syn_write = sl

    # Examples: collect non-trivial lines
    raw_examples = [l.strip() for l in sections.get('Examples', [])
                    if l.strip() and len(l.strip()) > 3]

    # Related commands: split on commas and newlines
    related_raw = re.split(r'[,\n]', sec('Related Commands'))
    related = [r.strip() for r in related_raw if r.strip()]

    return {
        'header':       block['header'],
        'qualifier':    block['qualifier'],
        'header_is_query': header_is_query,
        'description':  sec('__desc__'),
        'conditions':   sec('Conditions').replace('Measurement views:', '').strip(),
        'group':        sec('Group'),
        'syntax_write': syn_write,
        'syntax_query': syn_query,
        'arguments':   sec('Arguments'),
        'returns':     sec('Returns'),
        'examples':    raw_examples,
        'related':     related,
        'notes':       sec('Notes'),
    }


# ─── Merge blocks sharing the same normalised key ─────────────────────────────
# Every command appears TWICE in the detail pages:
#   Block A: "CMD (qualifier)\n<description>\nConditions\nGroup\nSyntax"
#   Block B: "CMD\n<continuation> → Arguments\nExamples\nRelated Commands"
# Block B is produced because the Syntax section re-states the SCPI path.
# We merge both halves so each key gets the full picture.

def merge_into(dest: dict, src: dict):
    if len(src['description']) > len(dest['description']):
        dest['description'] = src['description']
    for field in ('conditions', 'group', 'syntax_write', 'syntax_query',
                  'arguments', 'returns', 'notes'):
        if not dest[field] and src[field]:
            dest[field] = src[field]
    if not dest['examples'] and src['examples']:
        dest['examples'] = src['examples']
    if not dest['related'] and src['related']:
        dest['related'] = src['related']
    if src['qualifier'] and not dest['qualifier']:
        dest['qualifier'] = src['qualifier']
    # Only propagate the explicit (Query Only) label, not a bare trailing '?'
    if src.get('header_is_query') and not dest.get('header_is_query'):
        dest['header_is_query'] = True


def build_detail_map(blocks: list) -> dict:
    details: dict[str, dict] = {}
    for block in blocks:
        parsed = parse_block(block)
        key = normalize_key(block['header'])
        if key not in details:
            details[key] = parsed
        else:
            merge_into(details[key], parsed)
    print(f"Unique detail entries after merge: {len(details)}")
    return details


# ─── Parse Arguments text into structured params ──────────────────────────────

def extract_enum_from_syntax(syntax_write: str) -> list[str]:
    """Extract enumeration options from the LAST brace in write-syntax, e.g. {ONEK|TENK|...}.
    The last brace is the argument/value brace, not the command-prefix brace."""
    all_braces = re.findall(r'\{([^}]+)\}', syntax_write)
    if not all_braces:
        return []
    # Use the last brace (argument brace), but only if it looks like an enum
    # (not a SCPI prefix like {AM|FM|PM} which is part of the command node itself)
    # Heuristic: if there's a space before the last brace, it's an argument.
    last_brace_m = list(re.finditer(r'\{([^}]+)\}', syntax_write))
    if not last_brace_m:
        return []
    last = last_brace_m[-1]
    # Check there's a space before this brace (argument separator)
    start = last.start()
    if start > 0 and syntax_write[start - 1] != ' ':
        return []    # it's embedded in the command path, not a standalone arg
    opts = [o.strip() for o in last.group(1).split('|') if o.strip()]
    return opts


def parse_args_to_params(args_text: str, existing_params: list,
                         syntax_write: str = '') -> list:
    """Enrich existing params with min/max/options from the arguments text."""
    if not args_text or args_text.strip().lower() in ('none', 'none.'):
        return existing_params

    params = [dict(p) for p in existing_params]  # deep copy

    # ── Try to extract enum options ──────────────────────────────────────────
    # Priority 1: from the syntax write line brace {OPT1|OPT2|...}
    enum_vals = extract_enum_from_syntax(syntax_write)

    # Priority 2: from known keyword patterns in args text
    # Note: '0' and '1' are intentionally excluded — they appear in numeric range
    # descriptions like "Range: 1 Hz to 1 GHz" and cause false positives.
    if not enum_vals:
        bool_matches = re.findall(
            r'\b(OFF|ON|AUTO|MANual|NORMal|INVerted|RISing|FALLing|BOTH|'
            r'FREerun|TRIGgered|SINGle|CONTinuous|IMMediate|ONCE|'
            r'ONEK|TENK|HUNDredk|NDECimate|NEVerdecimate|'
            r'LINear|LOGarithmic|AVERage|MAXimum|MINimum|SAMple|'
            r'POSitive|NEGative|EITher)\b',
            args_text
        )
        enum_vals = list(dict.fromkeys(bool_matches))

    # Priority 3: table-style arguments (pattern: KEYWORD description on same/nearby line)
    # e.g. "ONEK 1k\nTENK 10k\nHUNDredk 100k" — require at least 3 matches to avoid
    # false positives from range descriptions like "Range: 1 Hz to 1 GHz"
    if not enum_vals:
        table_matches = re.findall(r'\b([A-Z][A-Za-z]{2,}[A-Za-z0-9]*)\s+\d', args_text)
        if len(table_matches) >= 3:
            enum_vals = list(dict.fromkeys(table_matches))

    # ── Try to extract numeric range ────────────────────────────────────────
    # Patterns:
    #   "Range: 1 to 100"            – no units
    #   "Range: 1 Hz to 1 GHz"       – with units (skip unit word)
    #   "range from 0 through 255"   – alternate phrasing
    _NUM = r'[-\d.eE+]+'
    _UNIT = r'(?:\s+[A-Za-z]+)?'   # optional unit word e.g. "Hz", "MHz", "GHz", "dB"
    range_m = (
        re.search(rf'[Rr]ange:\s*({_NUM}){_UNIT}\s+to\s+({_NUM})', args_text) or
        re.search(rf'range\s+from\s+({_NUM})\s+through\s+({_NUM})', args_text)
    )
    is_integer = bool(re.search(r'<NR1>|\(integer\)', args_text, re.IGNORECASE))
    is_float   = bool(re.search(r'NRf|<NRf>', args_text))

    for p in params:
        if p.get('name') != 'value':
            continue
        if enum_vals:
            p['type']    = 'enumeration'
            p['options'] = enum_vals
            p['default'] = 'ON' if 'ON' in enum_vals else enum_vals[0]
        elif range_m:
            p['type'] = 'integer' if is_integer else ('float' if is_float else 'numeric')
            try:
                lo = float(range_m.group(1))
                hi = float(range_m.group(2))
                p['min']     = int(lo) if is_integer else lo
                p['max']     = int(hi) if is_integer else hi
                p['default'] = int(lo) if is_integer else lo
            except ValueError:
                pass

    return params


# ─── Format examples matching MSO golden format ───────────────────────────────

def format_examples(raw_examples: list) -> list:
    """
    Convert raw example lines to [{scpi, description}] objects.
    The raw text from the PDF is like:
      "SENSE:FM:FREQUENCY:SEARCH:AUTO ON specifies that the carrier frequency..."
    We split on the first verb to separate the SCPI from the description.
    """
    result = []
    SPLIT_VERBS = re.compile(
        r'\s+(?:specifies|returns|sets|queries|enables|disables|moves|places'
        r'|adds|removes|resets|clears|loads|saves|performs|indicates|might return)',
        re.IGNORECASE
    )
    for line in raw_examples:
        if not line:
            continue
        m = SPLIT_VERBS.search(line)
        if m:
            scpi_part = line[:m.start()].strip()
            desc_part = line[m.start():].strip()
        else:
            scpi_part = line.strip()
            desc_part = ''
        result.append({'scpi': scpi_part, 'description': desc_part})
    return result


# ─── Build the enriched command entry ─────────────────────────────────────────

def enrich_cmd(cmd: dict, d: dict) -> dict:
    e = dict(cmd)

    # Description (prefer longer/more complete)
    if d['description'] and len(d['description']) > len(cmd.get('description', '')):
        e['description'] = d['description']

    # shortDescription
    e['shortDescription'] = first_sentence(e.get('description', ''))

    # conditions, group
    if d['conditions']:
        e['conditions'] = d['conditions']
    if d['group']:
        e['group'] = d['group']

    # Command type — rely on explicit qualifiers and (Query Only) labels from the PDF.
    # Do NOT infer from syntax forms alone (too many false positives due to split blocks).
    ctype = cmd.get('_manualEntry', {}).get('commandType', 'both')
    qual_lc = d['qualifier'].lower()
    if 'no query' in qual_lc or 'no query form' in qual_lc:
        ctype = 'write'
    elif 'query only' in qual_lc or d.get('header_is_query'):
        ctype = 'query'
    e['_manualEntry'] = dict(cmd.get('_manualEntry', {}))
    e['_manualEntry']['commandType'] = ctype

    # Syntax — build correctly per command type
    scpi_base = cmd['scpi'].split()[0].rstrip('?')
    syntax = {}
    if ctype == 'query':
        # Query-only: only show the query form; explicitly empty set
        syntax['query'] = d['syntax_query'] or (scpi_base + '?')
        syntax['set'] = ''
    elif ctype == 'write':
        # Write-only: only show the set form (with argument placeholder)
        syntax['set'] = d['syntax_write'] or cmd['scpi']
    else:
        # Both: set form includes argument placeholder; query appends ?
        syntax['set'] = d['syntax_write'] or cmd['scpi']
        syntax['query'] = d['syntax_query'] or (scpi_base + '?')
    e['syntax'] = syntax

    # Arguments (raw text)
    if d['arguments']:
        e['arguments'] = d['arguments']

    # Returns
    if d['returns']:
        e['returns'] = d['returns']

    # Related commands
    if d['related']:
        e['relatedCommands'] = d['related']

    # Notes
    if d['notes']:
        e['notes'] = [d['notes']] if isinstance(d['notes'], str) else d['notes']

    # Params — enrich with range/enum from arguments + syntax brace
    if d['arguments']:
        e['params'] = parse_args_to_params(
            d['arguments'], cmd.get('params', []),
            syntax_write=d.get('syntax_write', '')
        )

    # Examples — format as [{scpi, description}] objects
    if d['examples']:
        e['examples'] = format_examples(d['examples'])
        # Single-line example for tooltip (first example's SCPI)
        if e['examples']:
            e['example'] = e['examples'][0]['scpi']

    # _manualEntry enrichment (matches golden format)
    me = e['_manualEntry']
    me['command']          = cmd['scpi']
    me['header']           = cmd['scpi'].split()[0]
    me['description']      = e.get('description', '')
    me['shortDescription'] = e.get('shortDescription', '')
    me['arguments']        = d['arguments'] or None
    me['relatedCommands']  = d['related']
    me['commandGroup']     = d['group'] or ''
    me['syntax']           = syntax
    me['notes']            = e.get('notes', [])
    if d['examples']:
        me['examples'] = [
            {
                'description': ex['description'],
                'codeExamples': {'scpi': {'code': ex['scpi']}},
            }
            for ex in e['examples']
        ]

    return e


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=== Step 1: Extract detail page text ===")
    full_text = extract_detail_text(PDF, DETAIL_START_PAGE)
    print(f"Extracted {len(full_text):,} chars\n")

    print("=== Step 2: Split into blocks ===")
    blocks = split_blocks(full_text)

    print("\n=== Step 3: Build detail map (merge split blocks) ===")
    details = build_detail_map(blocks)

    # Quick sanity check on a known command
    test_key = normalize_key('[SENSe]:DPX:AUDio:DEMod:GAIN')
    if test_key in details:
        d = details[test_key]
        print(f"\nSanity check — {test_key}:")
        print(f"  syntax_write: {d['syntax_write']!r}")
        print(f"  arguments:    {d['arguments'][:80]!r}")
        print(f"  examples:     {d['examples']}")
    else:
        print(f"\nWARN: {test_key} not found in details!")


    print("\n=== Step 4: Load rsa.json ===")
    with open(JSON_IN, encoding='utf-8') as f:
        data = json.load(f)

    print("=== Step 5: Enrich commands ===")
    matched = unmatched = 0
    for group_data in data['groups'].values():
        enriched_cmds = []
        for cmd in group_data['commands']:
            key = normalize_key(cmd['scpi'])
            if key in details:
                enriched_cmds.append(enrich_cmd(cmd, details[key]))
                matched += 1
            else:
                enriched_cmds.append(cmd)
                unmatched += 1
        group_data['commands'] = enriched_cmds

    total = matched + unmatched
    print(f"  Matched:   {matched}/{total} ({matched/total*100:.1f}%)")
    print(f"  Unmatched: {unmatched}")

    # Stats
    has_ex  = sum(1 for g in data['groups'].values() for c in g['commands'] if c.get('example'))
    has_syn = sum(1 for g in data['groups'].values() for c in g['commands'] if c.get('syntax'))
    has_rel = sum(1 for g in data['groups'].values() for c in g['commands'] if c.get('relatedCommands'))
    print(f"  Has example:         {has_ex}")
    print(f"  Has syntax:          {has_syn}")
    print(f"  Has relatedCommands: {has_rel}")

    data['metadata']['version']      = '3.0'
    data['metadata']['detailsParsed'] = True

    print(f"\n=== Step 6: Write {JSON_OUT} ===")
    with open(JSON_OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Sample output
    print("\n=== Sample enriched commands ===")
    count = 0
    for g in data['groups'].values():
        for cmd in g['commands']:
            if cmd.get('example') and count < 3:
                print(f"\n  SCPI:         {cmd['scpi']}")
                print(f"  Desc:         {cmd.get('description','')[:80]}")
                print(f"  Syntax set:   {cmd.get('syntax',{}).get('set','')}")
                print(f"  Syntax query: {cmd.get('syntax',{}).get('query','')}")
                print(f"  Example:      {cmd.get('example','')}")
                print(f"  Related:      {cmd.get('relatedCommands',[])[:2]}")
                print(f"  Arguments:    {str(cmd.get('arguments',''))[:60]}")
                count += 1


if __name__ == '__main__':
    main()
