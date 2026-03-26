"""
Improved: Infer Missing Command Options from Examples and Arguments Text

This script enhances the MSO_DPO_5k_7k_70K.json by inferring enumeration options
from examples when the syntax field doesn't include {OPTIONS}.

Key improvements:
- Better detection of numeric vs enumeration parameters
- Smarter filtering of descriptive text
- More accurate option extraction from arguments
"""

import json
import re
import os
from collections import defaultdict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_FILE = os.path.join(PROJECT_ROOT, "public", "commands", "MSO_DPO_5k_7k_70K.json")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "public", "commands", "MSO_DPO_5k_7k_70K_enhanced.json")

def is_likely_numeric_parameter(arguments_text, syntax_list):
    """Check if this command likely takes a numeric parameter"""
    if not arguments_text:
        return False
    
    # Check syntax for numeric indicators
    full_syntax = ' '.join(syntax_list).upper()
    numeric_indicators = ['<NR1>', '<NR2>', '<NR3>', '<NRF>', '<FREQUENCY>', '<VOLTAGE>', '<TIME>', '<PERCENT>']
    if any(indicator in full_syntax for indicator in numeric_indicators):
        return True
    
    # Check arguments text for numeric descriptions
    args_lower = arguments_text.lower()
    numeric_phrases = [
        'range is',
        'value from',
        'integer',
        'number of',
        'frequency',
        'voltage',
        'time',
        'duration',
        'minimum',
        'maximum',
        'between',
        'specified by <nr',
        'specified as <nr',
        'samples',
        'record length'
    ]
    
    return any(phrase in args_lower for phrase in numeric_phrases)

def expand_range_pattern(text):
    """Expand range patterns like CH1–CH4 or D0–D15 into individual options"""
    options = []
    
    # Pattern for ranges like CH1–CH4, D0–D15, MATH1–MATH4
    # Unicode en-dash is \u2013
    range_pattern = r'([A-Z]+)(\d+)[\u2013\u2014-]([A-Z]+)?(\d+)'
    matches = re.findall(range_pattern, text)
    
    for match in matches:
        prefix1, start, prefix2, end = match
        # If prefix2 is empty, use prefix1 for both
        if not prefix2:
            prefix2 = prefix1
        
        # Only expand if prefixes match and range is reasonable (< 20 items)
        if prefix1 == prefix2:
            start_num = int(start)
            end_num = int(end)
            if 0 <= start_num <= end_num <= start_num + 20:
                for i in range(start_num, end_num + 1):
                    options.append(f"{prefix1}{i}")
    
    return options

def extract_options_from_arguments(arguments_text):
    """Extract enumeration options from arguments text (improved version)"""
    if not arguments_text:
        return []
    
    # Check if this uses placeholder patterns like CH<x>, MATH<x> instead of explicit values
    # If we see "can consist of CH<x>, MATH<x>" without explicit ranges, skip this command
    placeholder_pattern = r'(?:consist of|can be|include)\s+([A-Z]+<[xn]>(?:\s*,\s*[A-Z]+<[xn]>)+)'
    if re.search(placeholder_pattern, arguments_text, re.IGNORECASE):
        # This command uses generic placeholders, don't try to extract options
        return []
    
    # First, try to expand range patterns
    range_options = expand_range_pattern(arguments_text)
    if len(range_options) >= 2:
        return range_options
    
    # Pattern 1: Explicit curly brace options: {SAMple|PEAKdetect|HIRes}
    pipe_pattern = r'\{([^}]+)\}'
    pipe_matches = re.findall(pipe_pattern, arguments_text)
    if pipe_matches:
        all_options = []
        for match in pipe_matches:
            # Split by | and filter out placeholders
            opts = [o.strip() for o in match.split('|') 
                   if o.strip() and not o.strip().startswith('<') and not o.strip().startswith('NR')]
            all_options.extend(opts)
        if len(all_options) >= 2:
            seen = set()
            return [x for x in all_options if not (x in seen or seen.add(x))]
    
    # Pattern 2: Look for explicit lists like "can be OFF, ON, or AUTO"
    # or "Options: OFF, ON" or "values: OFF, ON"
    explicit_list_pattern = r'(?:can be|options?:?|values?:?|selects?|sets?|specifies?)\s+([A-Z][A-Za-z0-9]+(?:\s*,\s*[A-Z][A-Za-z0-9]+)+(?:\s+(?:or|and)\s+[A-Z][A-Za-z0-9]+)?)'
    explicit_match = re.search(explicit_list_pattern, arguments_text, re.IGNORECASE)
    if explicit_match:
        options_text = explicit_match.group(1)
        # Extract uppercase words
        words = re.findall(r'\b[A-Z][A-Za-z0-9]+\b', options_text)
        # Filter out common words
        filtered = [w for w in words if w not in ['Or', 'And', 'The', 'To', 'For', 'Of', 'In', 'On', 
                                                    'Is', 'Are', 'Be', 'By', 'This', 'That', 'Note']]
        if len(filtered) >= 2:
            seen = set()
            return [x for x in filtered if not (x in seen or seen.add(x))]
    
    # Pattern 3: Look for definitions like "OFF turns off... ON turns on..." or "CAN specifies..."
    # This pattern finds repeated "WORD <verb>" patterns
    definition_pattern = r'\b([A-Z][A-Za-z0-9]+)\s+(?:turns?|sets?|enables?|disables?|selects?|specifies?)'
    definitions = re.findall(definition_pattern, arguments_text)
    if len(definitions) >= 2:
        # Filter to get unique words (must start with capital)
        unique_defs = []
        seen = set()
        for word in definitions:
            if word not in seen and len(word) >= 2 and word not in ['The', 'This', 'That', 'Commands']:
                unique_defs.append(word)
                seen.add(word)
        if len(unique_defs) >= 2:
            return unique_defs
    
    return []

def extract_value_from_example(example_scpi, command_header):
    """Extract the argument value from an example"""
    # Remove <x> patterns and replace with \d+ for regex matching
    pattern = command_header.replace('<x>', r'\d+').replace('<n>', r'\d+')
    pattern = re.escape(pattern).replace(r'\\d\+', r'\d+')
    
    # Match: COMMAND VALUE_HERE (where VALUE is all uppercase or mixed case)
    match = re.match(rf'^{pattern}\s+([A-Z][A-Za-z0-9]*)', example_scpi, re.IGNORECASE)
    if match:
        value = match.group(1)
        # Filter out obvious non-options
        if value.upper() not in ['THE', 'TO', 'FOR', 'AND', 'OR', 'OF', 'IN', 'ON', 'AT']:
            return value
    return None

def analyze_command(cmd):
    """Analyze a command to see if it needs option enhancement"""
    scpi = cmd.get('scpi', '')
    params = cmd.get('params', [])
    syntax_list = cmd.get('syntax', [])
    arguments_text = cmd.get('arguments', '')
    examples = cmd.get('examples', [])
    
    # Skip if command is a query-only
    if scpi.endswith('?'):
        return None
    
    # Skip if already has a value parameter with options
    has_value_param_with_options = any(
        p.get('name', '').lower() == 'value' and 
        p.get('options') and 
        len(p.get('options', [])) > 0
        for p in params
    )
    if has_value_param_with_options:
        return None
    
    # Skip if syntax already includes {OPTIONS}
    full_syntax = ' '.join(syntax_list)
    if '{' in full_syntax and '|' in full_syntax:
        return None
    
    # IMPORTANT: Skip if this is likely a numeric parameter
    if is_likely_numeric_parameter(arguments_text, syntax_list):
        return None
    
    # Extract options from arguments text
    inferred_options = extract_options_from_arguments(arguments_text)
    
    # Extract values from examples
    example_values = []
    for ex in examples:
        ex_scpi = ex.get('scpi', '') if isinstance(ex, dict) else str(ex)
        if '?' in ex_scpi:
            continue  # Skip queries
        
        value = extract_value_from_example(ex_scpi, scpi.replace('?', ''))
        if value and value not in example_values:
            example_values.append(value)
    
    # Combine options: prefer arguments text, supplement with examples
    all_options = inferred_options if inferred_options else example_values
    
    # Filter out common false positives
    false_positives = [
        'WfmDB', 'Mask', 'Pass', 'Fail', 'Completion', 'Test', 'Note', 
        'QString', 'Using', 'ALIas', 'DELEte', 'NAMe',
        'INT', 'FLOAT', 'FAStest', 'DATA', 'SOUrce', 'ENCdg',
        'FRAMESTOP', 'FRAMESTART', 'STARt', 'STOP', 'Commands', 'When', 'CURVE',
        'MATH', 'REF', 'DIGITALALL', 'D15', 'Digital', 'LSB', 'MSB'
    ]
    all_options = [opt for opt in all_options if opt not in false_positives]
    
    # Must have at least 2 options to be considered an enumeration
    if len(all_options) >= 2:
        return {
            'options': all_options,
            'source': 'arguments' if inferred_options else 'examples',
            'confidence': 'high' if inferred_options else 'medium'
        }
    
    return None

def enhance_json():
    """Main enhancement function"""
    print(f"Loading {INPUT_FILE}...")
    
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    enhanced_count = 0
    skipped_numeric = 0
    skipped_has_options = 0
    stats = defaultdict(int)
    enhanced_commands = []
    
    print("\nScanning commands for missing options...")
    
    for group_name, group_data in data.get('groups', {}).items():
        commands = group_data.get('commands', [])
        
        for cmd in commands:
            scpi = cmd.get('scpi', '')
            
            # Track why we skip
            if scpi.endswith('?'):
                continue
            
            has_opts = any(
                p.get('name', '').lower() == 'value' and 
                p.get('options') and 
                len(p.get('options', [])) > 0
                for p in cmd.get('params', [])
            )
            if has_opts:
                skipped_has_options += 1
                continue
            
            if is_likely_numeric_parameter(cmd.get('arguments', ''), cmd.get('syntax', [])):
                skipped_numeric += 1
                continue
            
            result = analyze_command(cmd)
            
            if result:
                # Add or update the value parameter
                params = cmd.get('params', [])
                
                # Check if there's already a value param without options
                value_param_idx = None
                for idx, p in enumerate(params):
                    if p.get('name', '').lower() == 'value':
                        value_param_idx = idx
                        break
                
                if value_param_idx is not None:
                    # Update existing value param
                    params[value_param_idx]['type'] = 'enumeration'
                    params[value_param_idx]['options'] = result['options']
                    params[value_param_idx]['default'] = result['options'][0]
                else:
                    # Add new value param
                    params.append({
                        'name': 'value',
                        'type': 'enumeration',
                        'required': True,
                        'options': result['options'],
                        'default': result['options'][0],
                        'description': f"Options: {', '.join(result['options'][:5])}{'...' if len(result['options']) > 5 else ''}"
                    })
                
                cmd['params'] = params
                enhanced_count += 1
                stats[result['source']] += 1
                
                enhanced_commands.append({
                    'scpi': scpi,
                    'group': group_name,
                    'options': result['options'],
                    'source': result['source']
                })
                
                if enhanced_count <= 15:  # Show first 15
                    print(f"\n[OK] Enhanced: {scpi}")
                    print(f"  Options: {', '.join(result['options'][:8])}{'...' if len(result['options']) > 8 else ''}")
                    print(f"  Source: {result['source']}")
    
    print(f"\n{'='*60}")
    print(f"Enhancement Summary:")
    print(f"{'='*60}")
    print(f"Total commands enhanced: {enhanced_count}")
    print(f"From arguments text: {stats['arguments']}")
    print(f"From examples: {stats['examples']}")
    print(f"\nSkipped:")
    print(f"  Already have options: {skipped_has_options}")
    print(f"  Numeric parameters: {skipped_numeric}")
    
    # Save enhanced JSON
    print(f"\nSaving enhanced JSON to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Save enhancement log
    log_file = OUTPUT_FILE.replace('.json', '_log.txt')
    with open(log_file, 'w', encoding='utf-8') as f:
        f.write("Enhanced Commands Log\n")
        f.write("=" * 60 + "\n\n")
        for item in enhanced_commands:
            f.write(f"Command: {item['scpi']}\n")
            f.write(f"Group: {item['group']}\n")
            f.write(f"Options: {', '.join(item['options'])}\n")
            f.write(f"Source: {item['source']}\n")
            f.write("-" * 60 + "\n")
    
    print(f"Enhancement log saved to {log_file}")
    print(f"\n[DONE] Enhanced JSON saved to: {OUTPUT_FILE}")
    print(f"\nTo use the enhanced version, replace the original file:")
    print(f"  copy {OUTPUT_FILE} {INPUT_FILE}")

if __name__ == '__main__':
    enhance_json()
