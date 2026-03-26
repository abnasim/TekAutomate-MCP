"""One-off script to patch bad query syntax and spacing in rsa.json."""
import json, re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
JSON = r"public\commands\rsa.json"

with open(JSON, encoding='utf-8') as f:
    data = json.load(f)

fixes = 0

for gname, g in data['groups'].items():
    for cmd in g['commands']:
        scpi_base = cmd['scpi'].rstrip('?')
        syntax = cmd.get('syntax', {})

        # Fix 1: Bad query syntax whose root doesn't match the command root
        if syntax.get('query'):
            q = syntax['query']
            scpi_root = re.sub(r'^\[', '', scpi_base).split(':')[0].split(']')[0].upper()[:4]
            q_clean = re.sub(r'^[\[: ]+', '', q)
            q_root = q_clean.split(':')[0].upper()[:4]
            if scpi_root != q_root:
                new_q = scpi_base + '?'
                print(f'Fix query root mismatch: {q!r} -> {new_q!r}')
                syntax['query'] = new_q
                fixes += 1

        # Fix 2: syntax.set missing space before <value> or {choices}
        if syntax.get('set'):
            s = syntax['set']
            # e.g. "TINTerval<value>" -> "TINTerval <value>"
            fixed = re.sub(r'([A-Za-z\]>])(<(?:value|NR|file))', r'\1 \2', s)
            if fixed != s:
                print(f'Fix set space: {s!r} -> {fixed!r}')
                syntax['set'] = fixed
                fixes += 1

        # Propagate syntax fix into _manualEntry so both are consistent
        if '_manualEntry' in cmd and syntax:
            cmd['_manualEntry']['syntax'] = syntax

print(f'\nTotal fixes applied: {fixes}')

with open(JSON, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('rsa.json updated.')
