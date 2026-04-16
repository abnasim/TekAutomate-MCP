import json, random
with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    d = json.load(f)
print("AUDIT: 1 Random Command Per Group\n" + "="*60)
for gn, gd in sorted(d['groups'].items()):
    cmds = gd.get('commands', [])
    if not cmds: continue
    cmd = random.choice(cmds)
    ct = cmd.get('_manualEntry', {}).get('commandType', '?')
    params = cmd.get('params', [])
    param_str = ', '.join([f"{p['name']}={p.get('default')}" for p in params[:3]])
    ex = cmd.get('examples', [{}])[0].get('scpi', '-')[:40] if cmd.get('examples') else '-'
    print(f"\n[{gn}] ({len(cmds)} cmds)")
    print(f"  SCPI: {cmd['scpi']}")
    print(f"  Type: {ct} | Params: {param_str or 'none'}")
    print(f"  Ex: {ex}")








