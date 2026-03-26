"""
Comprehensive Extraction Audit
Checks 3 random commands from each group for quality
"""
import json
import random
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

with open('public/commands/mso_commands_final.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print("=" * 80)
print("SCPI EXTRACTION QUALITY AUDIT")
print("=" * 80)

# Overall stats
total_cmds = data['metadata']['total_commands']
total_groups = data['metadata']['total_groups']
print(f"\nTotal Commands: {total_cmds}")
print(f"Total Groups: {total_groups}")

# Aggregate stats
all_cmds = []
for group in data['groups'].values():
    all_cmds.extend(group['commands'])

with_desc = sum(1 for c in all_cmds if c.get('description'))
with_syntax = sum(1 for c in all_cmds if c.get('syntax'))
with_examples = sum(1 for c in all_cmds if c.get('examples'))
with_params = sum(1 for c in all_cmds if c.get('params'))
with_cmdtype = sum(1 for c in all_cmds if c.get('commandType'))

print(f"\n{'='*40}")
print("OVERALL COVERAGE")
print(f"{'='*40}")
print(f"With description:  {with_desc}/{total_cmds} ({100*with_desc/total_cmds:.1f}%)")
print(f"With syntax:       {with_syntax}/{total_cmds} ({100*with_syntax/total_cmds:.1f}%)")
print(f"With examples:     {with_examples}/{total_cmds} ({100*with_examples/total_cmds:.1f}%)")
print(f"With params:       {with_params}/{total_cmds} ({100*with_params/total_cmds:.1f}%)")
print(f"With commandType:  {with_cmdtype}/{total_cmds} ({100*with_cmdtype/total_cmds:.1f}%)")

# Command type breakdown
set_only = sum(1 for c in all_cmds if c.get('commandType') == 'set')
query_only = sum(1 for c in all_cmds if c.get('commandType') == 'query')
both = sum(1 for c in all_cmds if c.get('commandType') == 'both')
print(f"\nCommand Types:")
print(f"  Set only:   {set_only}")
print(f"  Query only: {query_only}")
print(f"  Both:       {both}")

# Param type breakdown
enum_params = 0
int_params = 0
float_params = 0
string_params = 0
for c in all_cmds:
    for p in c.get('params', []):
        if p.get('type') == 'enumeration':
            enum_params += 1
        elif p.get('type') == 'integer':
            int_params += 1
        elif p.get('type') == 'float':
            float_params += 1
        elif p.get('type') == 'string':
            string_params += 1

print(f"\nParameter Types:")
print(f"  Enumeration: {enum_params}")
print(f"  Integer:     {int_params}")
print(f"  Float:       {float_params}")
print(f"  String:      {string_params}")

# Check for issues
issues = []

# Commands with multiple params of same name
for c in all_cmds:
    param_names = [p.get('name') for p in c.get('params', [])]
    if len(param_names) != len(set(param_names)):
        issues.append(f"Duplicate param names in {c['scpi']}: {param_names}")

# Commands with empty options in enum
for c in all_cmds:
    for p in c.get('params', []):
        if p.get('type') == 'enumeration' and not p.get('options'):
            issues.append(f"Empty enum options in {c['scpi']}")

print(f"\n{'='*40}")
print(f"ISSUES FOUND: {len(issues)}")
print(f"{'='*40}")
for issue in issues[:10]:
    print(f"  - {issue}")
if len(issues) > 10:
    print(f"  ... and {len(issues) - 10} more")

# Sample 3 random commands from each group
print(f"\n{'='*80}")
print("RANDOM SAMPLE CHECK (3 commands per group)")
print(f"{'='*80}")

random.seed(42)  # For reproducibility

for group_name, group_data in sorted(data['groups'].items()):
    cmds = group_data['commands']
    sample_size = min(3, len(cmds))
    samples = random.sample(cmds, sample_size)
    
    print(f"\n--- {group_name} ({len(cmds)} commands) ---")
    
    for cmd in samples:
        scpi = cmd.get('scpi', 'N/A')
        name = cmd.get('name', 'N/A')
        desc = cmd.get('description', '')[:60] + '...' if cmd.get('description') else 'MISSING'
        syntax_count = len(cmd.get('syntax', []))
        example_count = len(cmd.get('examples', []))
        param_count = len(cmd.get('params', []))
        cmd_type = cmd.get('commandType', 'N/A')
        
        # Quality score
        score = 0
        if cmd.get('description'): score += 1
        if cmd.get('syntax'): score += 1
        if cmd.get('examples'): score += 1
        if cmd.get('params'): score += 1
        if cmd.get('commandType'): score += 1
        
        quality = ['❌', '⚠️', '⚠️', '✓', '✓', '✓✓'][score]
        
        print(f"  [{quality}] {scpi}")
        print(f"      Name: {name} | Type: {cmd_type} | Params: {param_count} | Syntax: {syntax_count} | Examples: {example_count}")
        
        # Show params detail
        if cmd.get('params'):
            for p in cmd.get('params', [])[:2]:
                opts = p.get('options', [])[:4]
                opts_str = ', '.join(opts) + ('...' if len(p.get('options', [])) > 4 else '') if opts else p.get('type', 'N/A')
                print(f"      -> Param '{p.get('name')}': {opts_str}")

print(f"\n{'='*80}")
print("AUDIT COMPLETE")
print(f"{'='*80}")

# Final summary
print(f"""
SUMMARY:
- Total commands extracted: {total_cmds}
- Coverage: {100*with_desc/total_cmds:.0f}% descriptions, {100*with_params/total_cmds:.0f}% params
- Issues found: {len(issues)}
- Command types: {both} both, {set_only} set-only, {query_only} query-only
""")








