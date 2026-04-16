"""Quick quality check of extracted commands"""
import json
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

groups = data.get('groups', {})

for group_name, group_data in groups.items():
    cmds = group_data.get('commands', [])
    print(f"\n=== {group_name} ({len(cmds)} commands) ===")
    
    # Count commands with good data
    with_desc = sum(1 for c in cmds if c.get('description'))
    with_syntax = sum(1 for c in cmds if c.get('syntax'))
    with_examples = sum(1 for c in cmds if c.get('examples'))
    with_params = sum(1 for c in cmds if c.get('params'))
    
    print(f"  With description: {with_desc}/{len(cmds)} ({100*with_desc/len(cmds):.1f}%)")
    print(f"  With syntax: {with_syntax}/{len(cmds)} ({100*with_syntax/len(cmds):.1f}%)")
    print(f"  With examples: {with_examples}/{len(cmds)} ({100*with_examples/len(cmds):.1f}%)")
    print(f"  With params: {with_params}/{len(cmds)} ({100*with_params/len(cmds):.1f}%)")
    
    # Show sample command
    print("\n  Sample command:")
    sample = cmds[0] if cmds else {}
    print(f"    SCPI: {sample.get('scpi')}")
    print(f"    Description: {sample.get('description', '')[:80]}...")
    print(f"    Syntax: {sample.get('syntax', [])[:2]}")
    print(f"    Examples: {len(sample.get('examples', []))} entries")
    print(f"    Params: {sample.get('params', [])}")

# Check for misalignment - syntax should match command prefix
print("\n\n=== MISALIGNMENT CHECK ===")
misaligned_syntax = 0
misaligned_examples = 0

for group_name, group_data in groups.items():
    for cmd in group_data.get('commands', []):
        scpi = cmd.get('scpi', '')
        prefix = scpi.split(':')[0].upper() if ':' in scpi else scpi.upper()[:3]
        
        # Check syntax
        for syn in cmd.get('syntax', []):
            syn_prefix = syn.split(':')[0].upper() if ':' in syn else syn.upper()[:3]
            if prefix and syn_prefix and not syn_prefix.startswith(prefix[:3]):
                misaligned_syntax += 1
                if misaligned_syntax <= 3:
                    print(f"  Misaligned syntax in {scpi}: {syn[:60]}")
        
        # Check examples
        for ex in cmd.get('examples', []):
            ex_scpi = ex.get('scpi', '') if isinstance(ex, dict) else ''
            if ex_scpi and prefix and prefix not in ex_scpi.upper():
                misaligned_examples += 1
                if misaligned_examples <= 3:
                    print(f"  Misaligned example in {scpi}: {ex_scpi[:60]}")

print(f"\nTotal misaligned syntax: {misaligned_syntax}")
print(f"Total misaligned examples: {misaligned_examples}")

