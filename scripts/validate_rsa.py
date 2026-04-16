"""Validate the newly parsed rsa.json."""
import json

with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)

groups = data['groups']
print("=== Metadata ===")
print(json.dumps(data['metadata'], indent=2))
print()

print("=== Group Summary ===")
for k, g in sorted(groups.items(), key=lambda x: -len(x[1]['commands'])):
    cmds = g['commands']
    print(f"  {k:20s} '{g['name']}' — {len(cmds)} commands")

print()
print("=== Sample commands from each group ===")
for k, g in sorted(groups.items()):
    cmds = g['commands']
    print(f"\n--- {k} ({len(cmds)} cmds) ---")
    for cmd in cmds[:3]:
        print(f"  SCPI: {cmd['scpi']}")
        print(f"  Desc: {cmd['description'][:80]}")
        print(f"  Type: {cmd['_manualEntry']['commandType']}  Params: {[p['name'] for p in cmd['parameters']]}")

print()
print("=== Sparse groups (full list) ===")
sparse = {k: g for k, g in groups.items() if len(g['commands']) <= 5}
for k, g in sparse.items():
    print(f"\n--- {k} ---")
    for cmd in g['commands']:
        print(f"  {cmd['scpi']} [{cmd['_manualEntry']['commandType']}]")

print()
print("=== Potential issues ===")
issues = 0
for k, g in groups.items():
    for cmd in g['commands']:
        scpi = cmd['scpi']
        # Check for garbage
        if len(scpi) > 120:
            print(f"  LONG SCPI in {k}: {scpi[:100]}...")
            issues += 1
        if ' ' in scpi and scpi.count(' ') > 2:
            print(f"  SPACES in {k}: {scpi}")
            issues += 1
        if scpi.lower().startswith('the ') or scpi.lower().startswith('note '):
            print(f"  PROSE in {k}: {scpi}")
            issues += 1

print(f"Total issues found: {issues}")

print()
print("=== Commands with parameters sample ===")
count = 0
for k, g in groups.items():
    for cmd in g['commands']:
        if cmd['parameters'] and count < 10:
            print(f"  [{k}] {cmd['scpi']}")
            print(f"    params={[p.get('name','?') for p in cmd['parameters']]}")
            count += 1
