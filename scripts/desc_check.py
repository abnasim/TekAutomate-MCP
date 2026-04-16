import json, random
with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)
groups = data['groups']
random.seed(1)
all_cmds = [cmd for g in groups.values() for cmd in g['commands']]
sample = random.sample(all_cmds, 8)
for cmd in sample:
    scpi = cmd['scpi']
    desc = cmd['description']
    ctype = cmd['_manualEntry']['commandType']
    pnames = [p['name'] for p in cmd['params']]
    print(f"  SCPI: {scpi}")
    print(f"  Desc: {desc}")
    print(f"  Type: {ctype}  Params: {pnames}")
    print()
