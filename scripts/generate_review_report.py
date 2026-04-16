"""
Generate report of commands that need manual option entry

This identifies commands that have:
- No enumeration options in params
- Generic/empty arguments text  
- Only 1 or 0 examples

These need to be manually checked against the PDF manual.
"""

import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_FILE = os.path.join(PROJECT_ROOT, "public", "commands", "MSO_DPO_5k_7k_70K.json")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "scripts", "commands_needing_manual_review.txt")

print(f"Loading {INPUT_FILE}...")

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    data = json.load(f)

needs_review = []

for group_name, group_data in data.get('groups', {}).items():
    commands = group_data.get('commands', [])
    
    for cmd in commands:
        scpi = cmd.get('scpi', '')
        params = cmd.get('params', [])
        arguments_text = cmd.get('arguments', '')
        examples = cmd.get('examples', [])
        
        # Skip query-only
        if scpi.endswith('?'):
            continue
        
        # Skip if already has options
        has_options = any(
            p.get('options') and len(p.get('options', [])) > 0
            for p in params
        )
        if has_options:
            continue
        
        # Check if arguments text is generic or empty
        if not arguments_text:
            arguments_text = ""
        generic_phrases = [
            'specifies',
            'arguments specify',
            'argument specifies',
            'sets or queries',
            'this command',
        ]
        is_generic = any(phrase in arguments_text.lower() for phrase in generic_phrases) or len(arguments_text) < 50
        
        # Check examples
        non_query_examples = [ex for ex in examples if isinstance(ex, dict) and '?' not in ex.get('scpi', '')]
        
        if is_generic and len(non_query_examples) <= 1:
            needs_review.append({
                'scpi': scpi,
                'group': group_name,
                'arguments': arguments_text[:100],
                'example_count': len(non_query_examples)
            })

print(f"\n Found {len(needs_review)} commands needing manual review\n")
print("Sample commands:")
for item in needs_review[:20]:
    print(f"  - {item['scpi']}")

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write("Commands Needing Manual Review\n")
    f.write("="*80 + "\n\n")
    f.write(f"Total: {len(needs_review)} commands\n\n")
    f.write("These commands have generic/empty arguments text and <=1 example.\n")
    f.write("They should be checked against the PDF manual for proper {OPTIONS} syntax.\n\n")
    f.write("="*80 + "\n\n")
    
    for item in needs_review:
        f.write(f"Command: {item['scpi']}\n")
        f.write(f"Group: {item['group']}\n")
        f.write(f"Arguments: {item['arguments']}\n")
        f.write(f"Examples: {item['example_count']}\n")
        f.write("-"*80 + "\n")

print(f"\nReport saved to: {OUTPUT_FILE}")
