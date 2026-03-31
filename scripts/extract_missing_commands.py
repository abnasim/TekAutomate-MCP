#!/usr/bin/env python3
"""Extract missing SCPI commands from PDF caches and add them to existing JSON files."""

import json
import re
from collections import defaultdict

MSO_PDF = "/tmp/mso_pdf_cache.json"
MSO_JSON = "/home/user/TekAutomate/public/commands/mso_2_4_5_6_7.json"
K5K7K_PDF = "/tmp/5k7k_pdf_cache.json"
K5K7K_JSON = "/home/user/TekAutomate/public/commands/MSO_DPO_5k_7k_70K.json"

# All known valid SCPI root prefixes across both manuals (uppercase, <x> normalized)
# Built from existing JSON files + known PDF roots
VALID_ROOTS = {
    '*CAL', '*CLS', '*DDT', '*ESE', '*ESR', '*IDN', '*LRN', '*OPC', '*OPT',
    '*PSC', '*PUD', '*RCL', '*RST', '*SAV', '*SDS', '*SRE', '*STB', '*TRG',
    '*TST', '*WAI',
    'ACQUIRE', 'ACTONEVENT', 'AFG', 'ALIAS', 'ALLEV', 'ALLOCATE',
    'APPLICATION', 'AUTOSET', 'AUTOSAVEPITIMEOUT', 'AUTOSAVEUITIMEOUT',
    'AUXIN', 'AUXOUT',
    'BUS', 'BUSTABLE', 'BUSY',
    'CALIBRATE', 'CALLOUTS', 'CH', 'CLEAR', 'CONFIGURATION', 'CONNECTED',
    'COUNTER', 'CURVE', 'CURVESTREAM', 'CURSOR', 'CUSTOMTABLE',
    'DATA', 'DATE', 'DELETE', 'DESE', 'DIAG', 'DIGGRP', 'DISPLAY', 'DVM',
    'EMAIL', 'ERRORDETECTOR', 'ETHERNET', 'EVENT', 'EVMSG', 'EVQTY',
    'EXPORT', 'EYEMASK',
    'FACTORY', 'FASTACQ', 'FILESYSTEM', 'FORMAT', 'FPANEL',
    'HARDCOPY', 'HEADER', 'HISTOGRAM', 'HORIZONTAL', 'HOSTPROCESSOR',
    'HSINTERFACE',
    'ID', 'IDNMULTISCOPE',
    'LICENSE', 'LIMIT', 'LOCK',
    'MAINWINDOW', 'MARK', 'MASK', 'MATH', 'MATHARBFLT', 'MATHVAR',
    'MEASTABLE', 'MEASUREMENT',
    'NEWPASS',
    'PASSWORD', 'PAUSE', 'PEAKSTABLE', 'PILOGGER', 'PLOT', 'POWER', 'PPOWER',
    'RECALL', 'REF', 'REM', 'ROSC',
    'SAVE', 'SAVEON', 'SAVEONEVENT', 'SCOPEAPP', 'SEARCH', 'SEARCHTABLE',
    'SECURITY', 'SELECT', 'SET', 'SETUP', 'SOCKETSERVER', 'SV',
    'TEKSECURE', 'TEST', 'TIME', 'TOTALUPTIME', 'TOUCHSCREEN', 'TRIGGER',
    'TSTAMPTABLE',
    'UNDO', 'UNLOCK', 'USBDEVICE', 'USBTMC',
    'VALUE', 'VERBOSE', 'VERTICAL', 'VIDPIC', 'VISUAL', 'VXI',
    'WAVFRM', 'WFMINPRE', 'WFMOUTPRE',
    'ZOOM',
}

# Header regex: star commands or mixed-case SCPI with colons
HEADER_RE = re.compile(
    r'^(\*[A-Z]{2,4}\??)\s*(?:\(Query [Oo]nly\)|\(No Query Form\))?\s*$'
    r'|'
    r'^([A-Z][A-Za-z<>:_\d]+(?:\?)?)\s*(?:\(Query [Oo]nly\)|\(No Query Form\))?\s*$'
)

MSO_SECTION_LABELS = {'Group', 'Syntax', 'Arguments', 'Parameters', 'Examples',
                       'Related Commands', 'Related commands', 'Returns'}

MSO_FOOTER_RE = re.compile(r'4/5/6 Series MSO Programmer Manual')
K5K7K_FOOTER_RE = re.compile(r'MSO/DPO5000|DPO7000|DPO70000|DSA70000|MSO70000|Series\s+\d+-\d+')


def normalize(h):
    return h.strip().upper().rstrip('?').replace(' ', '')


def get_root(header):
    """Get the root prefix of a SCPI command (first part before colon), normalized."""
    h = header.rstrip('?')
    if h.startswith('*'):
        return h.upper()
    root = h.split(':')[0]
    # Remove parameter parts like <x>
    root_clean = re.sub(r'<[^>]+>', '', root).upper()
    return root_clean


def has_valid_root(header):
    """Check if header starts with a known valid SCPI root prefix."""
    root = get_root(header)
    if root in VALID_ROOTS:
        return True
    # Also check prefix matches (e.g., CH matches CH<x>)
    for valid in VALID_ROOTS:
        if root.startswith(valid) or valid.startswith(root):
            if len(root) >= 2:
                return True
    return False


def has_scpi_mixed_case(s):
    """SCPI mnemonics have uppercase mandatory + lowercase optional."""
    return bool(re.search(r'[A-Z]{2,}[a-z]+', s))


def is_valid_scpi_header(h):
    """Strict validation of SCPI header."""
    if not h or len(h) < 3:
        return False

    if h.startswith('*'):
        return bool(re.match(r'^\*[A-Z]{2,4}\??$', h))

    if '|' in h or h.endswith('}') or ' ' in h:
        return False
    # Reject headers with parameter type placeholders (syntax lines, not headers)
    if '<QString>' in h or '<NR1>' in h or '<NR3>' in h or '<NR2>' in h or '<Block>' in h:
        return False
    if h[0].islower():
        return False
    if re.match(r'^\d+$', h.rstrip('?')):
        return False

    # Reject headers longer than 120 chars (likely garbled text)
    if len(h) > 120:
        return False

    # Reject headers with concrete numeric indices that look like example invocations
    # e.g., SEARCH:SEARCH1:TRIGGER:..., MEASUREMENT:MEAS1:...
    # Real definitions use parametric forms: SEARCH<x>, MEAS<x>
    # But allow POWer:POWer1 and similar where the "1" is part of the command name
    if '<' not in h:
        # Check for concrete numeric indices (example invocations, not definitions)
        # e.g., SEARCH1:, MEAS1:, POWer1:, B1:
        # Real definitions use SEARCH<x>, MEAS<x>, POWer<x>
        if re.search(r'(?:SEARCH|MEAS|TRIGGER:A:BUS:B|POWer)\d+:', h, re.IGNORECASE):
            return False

    # Reject known section labels and common non-SCPI words
    reject_exact = {
        'Group', 'Syntax', 'Arguments', 'Parameters', 'Examples', 'Returns',
        'Vertical', 'Horizontal', 'Acquisition', 'Trigger', 'Display',
        'Measurement', 'Cursor', 'Math', 'Bus', 'Zoom', 'Mask', 'Histogram',
        'Alias', 'Digital', 'Miscellaneous', 'Calibration', 'Diagnostics',
        'Power', 'Note', 'NOTE', 'CAUTION', 'WARNING', 'Description',
        'Related', 'Table', 'Figure', 'Chapter', 'Appendix', 'Index',
        'Contents', 'Preface', 'Value', 'Type', 'Commands',
        'RelatedCommands',
    }
    if h.rstrip('?') in reject_exact:
        return False

    # Must have a known root
    if not has_valid_root(h):
        return False

    # Each part between colons should look like a valid mnemonic
    clean = h.rstrip('?')
    parts = clean.split(':')
    for part in parts:
        if not part:
            continue
        # Remove angle bracket params
        check = re.sub(r'<[^>]+>', '', part)
        if not check:
            continue
        # Must start with uppercase
        if not check[0].isupper():
            return False
        # Must match mnemonic pattern: uppercase + optional lowercase + optional digits
        if not re.match(r'^[A-Z]+[a-z]*\d*$', check):
            return False
        # Reject single parts that are too long without mixed case (garbled text)
        if len(check) > 30:
            return False

    # Reject if total header has too many consecutive lowercase (garbled sentences)
    if re.search(r'[a-z]{15,}', h):
        return False

    # Reject truncated headers (ending in short all-uppercase fragment)
    if ':' in clean:
        last_part = parts[-1]
        last_clean = re.sub(r'<[^>]+>', '', last_part)
        if last_clean and last_clean == last_clean.upper() and len(last_clean) <= 4:
            return False

    # Reject headers where a part contains <NR followed by digit (parameter in header)
    if re.search(r'<NR\d>', h):
        return False

    # Reject very long all-uppercase parts (likely garbled concatenated text)
    for part in parts:
        check = re.sub(r'<[^>]+>', '', part)
        if check and len(check) > 20 and check == check.upper():
            return False

    # Reject garbled mnemonics where lowercase suffix is a standalone English word
    # e.g., "STATERUNor" (STATE+RUN + or), "THRESHoldat" etc.
    garbled_suffixes = {'or', 'to', 'at', 'by', 'in', 'on', 'is', 'it', 'as', 'of', 'no', 'an', 'up'}
    for part in parts:
        check = re.sub(r'<[^>]+>', '', part)
        if not check:
            continue
        uc_len = 0
        for ch in check:
            if ch.isupper():
                uc_len += 1
            else:
                break
        lc = check[uc_len:]
        if uc_len > 5 and lc.lower() in garbled_suffixes:
            return False

    return True


def extract_header(line):
    """Try to extract a SCPI header from a line."""
    ls = line.strip()
    m = HEADER_RE.match(ls)
    if not m:
        return None, False, False
    header = m.group(1) or m.group(2)
    if not header or not is_valid_scpi_header(header):
        return None, False, False
    qo = bool(re.search(r'\(Query\s+[Oo]nly\)', ls))
    nq = bool(re.search(r'\(No Query Form\)', ls))
    return header, qo, nq


def build_existing_set(json_path):
    with open(json_path) as f:
        data = json.load(f)
    headers = set()
    for group in data['groups'].values():
        for cmd in group['commands']:
            scpi = cmd.get('scpi', '')
            headers.add(normalize(scpi))
            me = cmd.get('_manualEntry', {})
            if me:
                for key in ('header', 'command'):
                    v = me.get(key, '')
                    if v:
                        headers.add(normalize(v))
    headers.discard('')
    return headers


def clean_lines(lines, footer_re):
    out = []
    for l in lines:
        ls = l.strip()
        if ls == 'Commands listed in alphabetical order':
            continue
        if re.match(r'^\d+$', ls):
            continue
        if footer_re and footer_re.search(ls):
            continue
        out.append(l)
    return out


def parse_mso_sections(block):
    sections = {'description': []}
    cur = 'description'
    for line in block:
        ls = line.strip()
        if ls in MSO_SECTION_LABELS:
            label = ls.lower()
            if label == 'parameters':
                label = 'arguments'
            elif label in ('related commands', 'related commands'):
                label = 'relatedcommands'
            cur = label
            if cur not in sections:
                sections[cur] = []
        else:
            if cur not in sections:
                sections[cur] = []
            sections[cur].append(line)
    return sections


def parse_5k7k_sections(block):
    sections = {'description': []}
    cur = 'description'
    labels = {
        'Group': 'group', 'Syntax': 'syntax', 'Arguments': 'arguments',
        'Parameters': 'arguments', 'Examples': 'examples',
        'RelatedCommands': 'relatedcommands', 'Returns': 'returns',
    }
    for line in block:
        ls = line.strip()
        matched = False
        for label, key in labels.items():
            if ls == label or ls.startswith(label + ' '):
                cur = key
                if cur not in sections:
                    sections[cur] = []
                rest = ls[len(label):].strip()
                if rest:
                    sections[cur].append(rest)
                matched = True
                break
        if not matched:
            if cur not in sections:
                sections[cur] = []
            sections[cur].append(line)
    return sections


def header_to_name(header):
    h = header.rstrip('?')
    if h.startswith('*'):
        return h
    parts = h.split(':')
    words = []
    for part in parts:
        clean = re.sub(r'<[^>]+>', '', part)
        if clean:
            word = clean[0].upper() + clean[1:].lower() if len(clean) > 1 else clean.upper()
            words.append(word)
    return ' '.join(words) if words else header


def parse_examples(text):
    examples = []
    if not text:
        return examples
    pat = re.compile(
        r'([A-Z*][A-Z:_\d<>?]+(?:\s+[^\s]+)?)\s+'
        r'((?:might|sets?|returns?|turns?|queries?|indicates?|enables?|disables?|stores?)\b.*?)(?=\s+[A-Z*][A-Z:_\d<>?]+\s+(?:might|sets?|returns?|turns?)|$)',
        re.IGNORECASE
    )
    for m in pat.finditer(text):
        examples.append({'scpi': m.group(1).strip(), 'description': m.group(2).strip()})
    return examples[:5]


def build_entry(header, qo, nq, sections):
    if qo or header.endswith('?'):
        ct = 'query'
    elif nq:
        ct = 'set'
    else:
        ct = 'both'

    desc = ' '.join(l.strip() for l in sections.get('description', []) if l.strip())
    desc = re.sub(r'^NOTE\.?\s*', '', desc).strip()

    sentences = re.split(r'(?<=[.])\s+', desc)
    short = sentences[0].strip() if sentences and sentences[0].strip() else desc[:100]
    if short and not short.endswith('.'):
        short += '.'

    group_raw = ' '.join(l.strip() for l in sections.get('group', []) if l.strip()).strip()
    # Clean up group: take just the first meaningful group name
    # Handle garbled text like "Status and Error Miscellaneous" or "Trigger Trigger Trigger"
    group = group_raw.split('.')[0].strip()
    # Known group names - match against these
    known_groups = [
        'Acquisition', 'Horizontal', 'Vertical', 'Trigger', 'Display',
        'Display control', 'Measurement', 'Cursor', 'Math', 'Bus',
        'Search and Mark', 'Save and Recall', 'File System', 'File system',
        'Calibration', 'Calibration and Utility', 'Status and Error',
        'Status and Events', 'Zoom', 'Mask', 'Histogram', 'Alias',
        'Hard copy', 'Waveform Transfer', 'Digital', 'AFG', 'Miscellaneous',
        'Limit Test', 'DVM', 'Plot', 'Power', 'Spectrum view', 'E-mail',
        'Email', 'Error Detector', 'Diagnostics', 'Low Speed Serial Trigger',
        'Save on', 'Save On', 'Act On Event', 'Callout', 'Ethernet',
        'Self Test', 'Digital Power Management',
        'Inverter Motors and Drive Analysis',
        'Wide Band Gap Analysis (WBG)',
    ]
    matched_group = ''
    for kg in known_groups:
        if group.lower().startswith(kg.lower()):
            if len(kg) > len(matched_group):
                matched_group = kg
    group = matched_group if matched_group else group
    if len(group) > 50:
        group = group[:50].rsplit(' ', 1)[0]

    syntax = [l.strip() for l in sections.get('syntax', []) if l.strip() and not l.strip().lower().startswith('where')]

    ex_text = ' '.join(l.strip() for l in sections.get('examples', []) if l.strip())
    examples = parse_examples(ex_text)

    clean_h = header.rstrip('?')

    # Validation: a real command should have at least some description or syntax
    if not desc and not syntax:
        return None

    return {
        'name': header_to_name(header),
        'scpi': header if header.endswith('?') and ct == 'query' else clean_h,
        'header': clean_h,
        'commandType': ct,
        'shortDescription': short,
        'description': desc if desc else short,
        'syntax': syntax,
        'examples': examples,
        'group': group if group else 'Miscellaneous',
    }


def extract_commands(pdf_cache, start_page, fmt, end_page=None):
    commands = {}
    max_page = end_page if end_page else max(int(k) for k in pdf_cache.keys()) + 1

    footer = MSO_FOOTER_RE if fmt == 'mso' else K5K7K_FOOTER_RE
    all_lines = []
    for pg in range(start_page, max_page):
        text = pdf_cache.get(str(pg), '')
        if text:
            all_lines.extend(clean_lines(text.split('\n'), footer))

    # Find headers, joining continuation lines for split headers
    hdr_pos = []
    skip_next = False
    for i, line in enumerate(all_lines):
        if skip_next:
            skip_next = False
            continue
        h, qo, nq = extract_header(line)
        if h:
            # Check if the next line is a continuation of a line-wrapped header
            if i + 1 < len(all_lines):
                next_line = all_lines[i + 1].strip()
                if next_line:
                    is_continuation = False
                    # Case 1: starts with lowercase (e.g., "nationaddr:VALue", "col:VALue")
                    if next_line[0].islower():
                        if ':' in next_line or len(next_line) <= 15:
                            is_continuation = True
                    # Case 2: very short fragment (1-5 chars) that completes the mnemonic
                    # e.g., "De" completing "FAMILYCO" -> "FAMILYCODe"
                    # or "MBer" completing "SERIALNU" -> "SERIALNUMBer"
                    elif len(next_line) <= 5 and re.match(r'^[A-Z]*[a-z]+$', next_line):
                        is_continuation = True

                    if is_continuation:
                        joined = line.strip() + next_line
                        jh, jqo, jnq = extract_header(joined)
                        if jh:
                            h, qo, nq = jh, jqo, jnq
                            skip_next = True
            # Store position: if we joined with next line, block starts at i+2
            block_start = i + 2 if skip_next else i + 1
            hdr_pos.append((block_start, h, qo, nq))

    # Extract blocks
    # pos = block_start (line after header, or after header+continuation)
    for idx, (pos, header, qo, nq) in enumerate(hdr_pos):
        end = hdr_pos[idx + 1][0] if idx + 1 < len(hdr_pos) else len(all_lines)
        block = all_lines[pos:end]

        if fmt == 'mso':
            sections = parse_mso_sections(block)
        else:
            sections = parse_5k7k_sections(block)

        entry = build_entry(header, qo, nq, sections)
        if entry:
            commands[normalize(header)] = entry

    return commands


GROUP_ALIASES = {
    'vertical': 'Vertical', 'horizontal': 'Horizontal',
    'acquisition': 'Acquisition', 'trigger': 'Trigger',
    'display': 'Display', 'display control': 'Display control',
    'measurement': 'Measurement', 'cursor': 'Cursor',
    'math': 'Math', 'bus': 'Bus',
    'search': 'Search and Mark', 'search and mark': 'Search and Mark',
    'save and recall': 'Save and Recall',
    'file system': 'File System', 'filesystem': 'File system',
    'calibration and utility': 'Calibration', 'calibration': 'Calibration',
    'status and error': 'Status and Error', 'status and events': 'Status and Error',
    'zoom': 'Zoom', 'mask': 'Mask', 'histogram': 'Histogram',
    'alias': 'Alias', 'hard copy': 'Hard copy', 'hardcopy': 'Hard copy',
    'waveform transfer': 'Waveform Transfer', 'digital': 'Digital',
    'afg': 'AFG', 'miscellaneous': 'Miscellaneous',
    'limit test': 'Limit Test', 'dvm': 'DVM', 'plot': 'Plot',
    'power': 'Power', 'spectrum view': 'Spectrum view',
    'e-mail': 'E-mail', 'email': 'E-mail',
    'error detector': 'Error Detector', 'diagnostics': 'Diagnostics',
    'low speed serial trigger': 'Low Speed Serial Trigger',
    'save on': 'Save on', 'act on event': 'Act On Event',
    'digital power management': 'Digital Power Management',
    'dpm': 'Digital Power Management',
    'inverter motors and drive analysis': 'Inverter Motors and Drive Analysis',
    'wide band gap analysis (wbg)': 'Wide Band Gap Analysis (WBG)',
    'callout': 'Callout', 'ethernet': 'Ethernet', 'self test': 'Self Test',
}

PREFIX_MAP = [
    ('ACQUIRE', 'Acquisition'), ('ACTONEVENT', 'Act On Event'),
    ('AFG', 'AFG'), ('ALIAS', 'Alias'), ('ALLEV', 'Status and Error'),
    ('ALLOCATE', 'Waveform Transfer'),
    ('APPLICATION', 'Miscellaneous'), ('AUTOSET', 'Miscellaneous'),
    ('AUXIN', 'Vertical'), ('AUXOUT', 'Vertical'),
    ('BUS', 'Bus'), ('CALIBRATE', 'Calibration'), ('CALLOUT', 'Callout'),
    ('CH', 'Vertical'), ('CLEAR', 'Miscellaneous'),
    ('CONFIGURATION', 'Miscellaneous'), ('CONNECTED', 'Miscellaneous'),
    ('COUNTER', 'Measurement'), ('CURVE', 'Waveform Transfer'),
    ('CURVESTREAM', 'Waveform Transfer'), ('CURSOR', 'Cursor'),
    ('DATA', 'Waveform Transfer'), ('DATE', 'Miscellaneous'),
    ('DELETE', 'Miscellaneous'), ('DESE', 'Status and Error'),
    ('DIAG', 'Miscellaneous'), ('DIGGRP', 'Digital'),
    ('DISPLAY', 'Display'), ('DVM', 'DVM'),
    ('EMAIL', 'E-mail'), ('ERRORDETECTOR', 'Error Detector'),
    ('ETHERNET', 'Ethernet'), ('EVENT', 'Status and Error'),
    ('EVMSG', 'Status and Error'), ('EVQTY', 'Status and Error'),
    ('EXPORT', 'Miscellaneous'), ('EYEMASK', 'Mask'),
    ('FACTORY', 'Miscellaneous'), ('FASTACQ', 'Acquisition'),
    ('FILESYSTEM', 'File System'), ('FORMAT', 'Miscellaneous'),
    ('FPANEL', 'Miscellaneous'),
    ('HARDCOPY', 'Hard copy'), ('HEADER', 'Miscellaneous'),
    ('HISTOGRAM', 'Histogram'), ('HORIZONTAL', 'Horizontal'),
    ('LICENSE', 'Miscellaneous'), ('LIMIT', 'Limit Test'),
    ('LOCK', 'Miscellaneous'), ('MAINWINDOW', 'Display'),
    ('MARK', 'Search and Mark'), ('MASK', 'Mask'),
    ('MATH', 'Math'), ('MEASUREMENT', 'Measurement'),
    ('PILOGGER', 'Miscellaneous'), ('PLOT', 'Plot'),
    ('POWER', 'Power'), ('PPOWER', 'Power'),
    ('RECALL', 'Save and Recall'), ('REF', 'Vertical'),
    ('REM', 'Miscellaneous'), ('ROSC', 'Miscellaneous'),
    ('SAVE', 'Save and Recall'), ('SAVEON', 'Save on'),
    ('SEARCH', 'Search and Mark'), ('SECURITY', 'Miscellaneous'),
    ('SELECT', 'Miscellaneous'), ('SETUP', 'Save and Recall'),
    ('SV', 'Spectrum view'), ('TEKSECURE', 'Miscellaneous'),
    ('TEST', 'Miscellaneous'), ('TIME', 'Miscellaneous'),
    ('TOUCHSCREEN', 'Miscellaneous'), ('TRIGGER', 'Trigger'),
    ('UNLOCK', 'Miscellaneous'), ('USBDEVICE', 'Miscellaneous'),
    ('USBTMC', 'Miscellaneous'), ('VERBOSE', 'Miscellaneous'),
    ('VERTICAL', 'Vertical'), ('VISUAL', 'Display'),
    ('VXI', 'Miscellaneous'), ('WAVFRM', 'Waveform Transfer'),
    ('WFMINPRE', 'Waveform Transfer'), ('WFMOUTPRE', 'Waveform Transfer'),
    ('ZOOM', 'Zoom'),
    ('*', 'Miscellaneous'),
]


def find_group(entry, existing_groups):
    pdf_group = entry.get('group', '').strip()
    if pdf_group and pdf_group != 'Miscellaneous':
        for g in existing_groups:
            if g.lower() == pdf_group.lower():
                return g
        pl = pdf_group.lower()
        if pl in GROUP_ALIASES and GROUP_ALIASES[pl] in existing_groups:
            return GROUP_ALIASES[pl]

    # Guess from prefix
    h = entry['header'].upper()
    best, best_len = 'Miscellaneous', 0
    for prefix, group in PREFIX_MAP:
        if h.startswith(prefix) and len(prefix) > best_len and group in existing_groups:
            best, best_len = group, len(prefix)
    return best


def process(pdf_path, json_path, fmt):
    print(f"\n{'='*70}")
    print(f"JSON: {json_path}")
    print(f"PDF:  {pdf_path} (format: {fmt})")
    print(f"{'='*70}")

    existing = build_existing_set(json_path)
    print(f"\nExisting commands: {len(existing)}")

    with open(pdf_path) as f:
        pdf = json.load(f)

    start = None
    for pg in range(50, 200):
        text = pdf.get(str(pg), '')
        if 'alphabetical' in text.lower() and 'ACQuire' in text:
            start = pg
            break
    if not start:
        print("ERROR: No command section found!")
        return

    # Find end page (where "Status and events" or appendix section starts)
    max_pg = max(int(k) for k in pdf.keys())
    end_page = max_pg + 1
    for pg in range(start + 100, max_pg + 1):
        text = pdf.get(str(pg), '')
        if text and 'alphabetical' not in text.lower() and text.strip():
            first_line = text.strip().split('\n')[0].strip()
            if 'Status and' in first_line or 'Appendix' in first_line:
                end_page = pg
                break

    print(f"Commands: pages {start}-{end_page - 1}")
    extracted = extract_commands(pdf, start, fmt, end_page)
    print(f"Extracted from PDF: {len(extracted)}")

    # Remove truncated headers: if header A is a strict prefix of header B (both extracted),
    # then A is likely a line-wrapped truncation of B
    all_extracted_norms = sorted(extracted.keys())
    truncated = set()
    for i, nh in enumerate(all_extracted_norms):
        for j in range(i + 1, len(all_extracted_norms)):
            other = all_extracted_norms[j]
            if other.startswith(nh) and other != nh:
                # nh is a prefix of other - likely truncated
                # But only if the difference is a continuation (not a colon-separated child)
                suffix = other[len(nh):]
                if not suffix.startswith(':'):
                    truncated.add(nh)
                break  # sorted, so first match is enough
    if truncated:
        print(f"  Removed {len(truncated)} truncated headers (line-wrap artifacts)")
        for nh in truncated:
            del extracted[nh]

    # Also remove headers that are prefixes of existing commands (same logic)
    existing_truncated = set()
    for nh in list(extracted.keys()):
        for e in existing:
            if e.startswith(nh) and e != nh:
                suffix = e[len(nh):]
                if not suffix.startswith(':'):
                    existing_truncated.add(nh)
                    break
    if existing_truncated:
        print(f"  Removed {len(existing_truncated)} truncated headers (prefixes of existing)")
        for nh in existing_truncated:
            if nh in extracted:
                del extracted[nh]

    # Find missing
    missing = {}
    for nh, entry in extracted.items():
        if nh in existing:
            continue
        h = entry['header']
        # Skip root-only if children exist (it's just a prefix fragment)
        if ':' not in h.rstrip('?') and not h.startswith('*'):
            if any(e.startswith(nh + ':') for e in existing):
                continue
        # Skip single words that are clearly not standalone SCPI commands
        # (known section headers, generic words, etc.)
        if ':' not in h and not h.startswith('*'):
            skip_words = {
                'CURSOR', 'AUTO', 'LIMIT', 'CURSOR', 'DISPLAY', 'TRIGGER',
                'MEASUREMENT', 'HORIZONTAL', 'VERTICAL', 'ACQUISITION',
                'SEARCH', 'MASK', 'MATH', 'ZOOM', 'HISTOGRAM', 'BUS',
                'POWER', 'CALIBRATE', 'NOTE', 'CAUTION', 'WARNING',
            }
            if h.upper() in skip_words:
                continue
        # Skip headers with garbled group names (indicator of bad parse)
        g = entry.get('group', '')
        if g and len(g) > 60:
            continue
        missing[nh] = entry

    print(f"Missing after dedup: {len(missing)}")

    if not missing:
        print("Nothing to add!")
        return

    # Print samples
    print("\nSample missing (first 40):")
    for i, (nh, e) in enumerate(sorted(missing.items())):
        if i >= 40:
            print(f"  ... and {len(missing) - 40} more")
            break
        print(f"  {e['header']:60s} [{e['group']}]")

    # Add to JSON
    with open(json_path) as f:
        data = json.load(f)

    groups = set(data['groups'].keys())
    counts = defaultdict(int)
    added = []

    for nh, entry in sorted(missing.items()):
        gname = find_group(entry, groups)
        if gname not in data['groups']:
            data['groups'][gname] = {'name': gname, 'description': '', 'commands': []}
            groups.add(gname)

        obj = {
            'scpi': entry['scpi'],
            'name': entry['name'],
            'description': entry['description'],
            'shortDescription': entry['shortDescription'],
            'group': gname,
            'syntax': entry['syntax'],
            'arguments': None,
            'params': [],
            'examples': entry['examples'],
            'relatedCommands': [],
            'conditions': None,
            'returns': None,
            'notes': [],
            'example': entry['examples'][0]['scpi'] if entry['examples'] else entry['scpi'].upper(),
            'commandType': entry['commandType'],
            'hasQuery': entry['commandType'] in ('query', 'both'),
            'hasSet': entry['commandType'] in ('set', 'both'),
        }
        data['groups'][gname]['commands'].append(obj)
        counts[gname] += 1
        added.append((gname, entry['header']))

    print(f"\nAdded per group:")
    for g, c in sorted(counts.items()):
        print(f"  {g}: +{c}")

    with open(json_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    # Verify
    with open(json_path) as f:
        v = json.load(f)
    total = sum(len(g['commands']) for g in v['groups'].values())
    print(f"\nVerification: JSON valid, total commands = {total}, added = {sum(counts.values())}")


def main():
    print("SCPI Command Extraction - Missing Command Finder")
    process(MSO_PDF, MSO_JSON, 'mso')
    process(K5K7K_PDF, K5K7K_JSON, '5k7k')
    print("\nDone!")


if __name__ == '__main__':
    main()
