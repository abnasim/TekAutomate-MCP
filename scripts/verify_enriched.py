import json

with open('public/commands/rsa.json', encoding='utf-8') as f:
    data = json.load(f)

groups = data['groups']

# Count enriched vs plain
has_example = 0
has_syntax = 0
has_related = 0
has_code_examples = 0
total = 0

for g in groups.values():
    for cmd in g['commands']:
        total += 1
        if cmd.get('example'):
            has_example += 1
        if cmd.get('syntax'):
            has_syntax += 1
        if cmd.get('relatedCommands'):
            has_related += 1
        if cmd.get('codeExamples'):
            has_code_examples += 1

print(f"Total: {total}")
print(f"Has example:       {has_example} ({has_example/total*100:.1f}%)")
print(f"Has syntax:        {has_syntax} ({has_syntax/total*100:.1f}%)")
print(f"Has relatedCmds:   {has_related} ({has_related/total*100:.1f}%)")
print(f"Has codeExamples:  {has_code_examples} ({has_code_examples/total*100:.1f}%)")

# Show the FM/PM AUTO command the user mentioned
print("\n=== [SENSe]:{FM|PM}:FREQuency:SEARch:AUTO ===")
for g in groups.values():
    for cmd in g['commands']:
        if 'SEARch:AUTO' in cmd['scpi'] and 'FM' in cmd['scpi']:
            print(json.dumps(cmd, indent=2))
            break

# Show 3 more sample enriched commands
print("\n=== Sample enriched commands ===")
count = 0
for g in groups.values():
    for cmd in g['commands']:
        if cmd.get('codeExamples') and cmd.get('relatedCommands') and count < 3:
            print(f"\n  SCPI: {cmd['scpi']}")
            print(f"  Desc: {cmd['description'][:100]}")
            print(f"  Syntax set:   {cmd.get('syntax',{}).get('set','')}")
            print(f"  Syntax query: {cmd.get('syntax',{}).get('query','')}")
            print(f"  Example: {cmd.get('example','')}")
            print(f"  Related: {cmd.get('relatedCommands',[])[:3]}")
            print(f"  Params: {[p.get('name') for p in cmd.get('params',[])]}")
            count += 1
