"""
Check for data misalignment in extracted commands
"""
import json

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

groups = data.get('groups', {})
all_cmds = []
for group_name, group_data in groups.items():
    for cmd in group_data.get('commands', []):
        all_cmds.append(cmd)

# Count misalignment stats
syntax_mismatch = 0
example_mismatch = 0
syntax_mismatch_list = []
example_mismatch_list = []

for cmd in all_cmds:
    scpi = cmd.get('scpi', '')
    scpi_base = scpi.split('?')[0].upper().replace('<X>', '').replace('<N>', '')
    
    # Check syntax
    syntax_list = cmd.get('syntax', [])
    for syn in syntax_list:
        syn_base = syn.split()[0].upper().replace('<X>', '').replace('<N>', '').replace('?', '')
        if syn_base and not syn_base.startswith(scpi_base[:min(len(scpi_base), 5)]) and not scpi_base.startswith(syn_base[:min(len(syn_base), 5)]):
            syntax_mismatch += 1
            syntax_mismatch_list.append((scpi, syn))
            break
    
    # Check examples
    examples = cmd.get('examples', [])
    scpi_prefix = scpi.split(':')[0].upper() if ':' in scpi else scpi.upper()[:3]
    if examples and isinstance(examples, list):
        for ex in examples:
            if isinstance(ex, dict):
                ex_code = ex.get('scpi', '') or (ex.get('codeExamples', {}).get('scpi', {}).get('code', ''))
                if ex_code and len(ex_code) > 3 and scpi_prefix not in ex_code.upper():
                    example_mismatch += 1
                    example_mismatch_list.append((scpi, ex_code))
                    break

print('=== MISALIGNMENT STATISTICS ===')
print(f'Total commands: {len(all_cmds)}')
print(f'Commands with syntax misalignment: {syntax_mismatch} ({100*syntax_mismatch/len(all_cmds):.1f}%)')
print(f'Commands with example misalignment: {example_mismatch} ({100*example_mismatch/len(all_cmds):.1f}%)')

print('\n=== SYNTAX MISALIGNMENT EXAMPLES (first 10) ===')
for scpi, syn in syntax_mismatch_list[:10]:
    print(f'SCPI: {scpi}')
    print(f'  Wrong Syntax: {syn[:80]}...' if len(syn) > 80 else f'  Wrong Syntax: {syn}')
    print()

print('\n=== EXAMPLE MISALIGNMENT EXAMPLES (first 10) ===')
for scpi, ex in example_mismatch_list[:10]:
    print(f'SCPI: {scpi}')
    print(f'  Wrong Example: {ex[:80]}...' if len(ex) > 80 else f'  Wrong Example: {ex}')
    print()

# Check specific commands mentioned in ISSUE_SUMMARY.md
print('\n=== CHECKING SPECIFIC COMMANDS FROM ISSUE SUMMARY ===')

for cmd in all_cmds:
    if cmd.get('scpi') == '*CLS':
        print(f"\nCommand: *CLS")
        print(f"  Syntax: {cmd.get('syntax')}")
        desc = cmd.get('description', '')
        print(f"  Description: {desc[:100]}..." if len(desc) > 100 else f"  Description: {desc}")
        
for cmd in all_cmds:
    if cmd.get('scpi') == 'ACQuire:NUMAVg':
        print(f"\nCommand: ACQuire:NUMAVg")
        print(f"  Syntax: {cmd.get('syntax')}")
        desc = cmd.get('description', '')
        print(f"  Description: {desc[:100]}..." if len(desc) > 100 else f"  Description: {desc}")
        args = cmd.get('arguments', '')
        print(f"  Arguments: {str(args)[:100]}..." if args and len(str(args)) > 100 else f"  Arguments: {args}")

for cmd in all_cmds:
    if cmd.get('scpi') == 'ACQuire:STATE':
        print(f"\nCommand: ACQuire:STATE")
        print(f"  Syntax: {cmd.get('syntax')}")
        desc = cmd.get('description', '')
        print(f"  Description: {desc[:100]}..." if len(desc) > 100 else f"  Description: {desc}")








