#!/usr/bin/env python3
"""
Test script to verify the syntax extraction fix for commands like:
BUS:B<x>:ARINC429A:SOUrce  {CH<x>|MATH<x>|REF<x>} BUS:B<x>:ARINC429A:SOUrce?
"""

import re

def extract_syntax_fixed(syntax_lines, cmd_key, desc=""):
    """
    Test the fixed syntax extraction logic
    """
    desc_lower = desc.lower() if desc else ""
    is_query_only = (
        "query-only" in desc_lower or 
        "(query only)" in desc_lower or 
        "(Query Only)" in desc or
        (cmd_key.endswith("?") and not any("?" not in s for s in syntax_lines if s.strip()))
    )
    
    set_syntax = ""
    query_syntax = ""
    
    for s in syntax_lines:
        s = s.strip()
        if not s:
            continue
            
        # Check if line contains BOTH set and query syntax (e.g., "CMD {args} CMD?")
        # Pattern: Contains "?" and also contains arguments like {}, <NR>, <QString>, etc.
        if "?" in s:
            # First, try the alternative pattern: Split on the command header that appears twice
            # This is more reliable than regex for complex command patterns
            # e.g., "BUS:B<x>:ARINC429A:SOUrce {CH<x>|MATH<x>|REF<x>} BUS:B<x>:ARINC429A:SOUrce?"
            header = cmd_key.split(" ")[0].split("?")[0]
            if header and s.count(header) >= 2:
                # Find the second occurrence which is the query
                first_pos = s.find(header)
                second_pos = s.find(header, first_pos + len(header))
                if second_pos > 0:
                    potential_set = s[:second_pos].strip()
                    potential_query = s[second_pos:].strip()
                    if potential_set and not set_syntax:
                        set_syntax = potential_set
                    if potential_query and not query_syntax:
                        query_syntax = potential_query
                    continue
            
            # Try to find if there's a SET command before the QUERY command using regex
            # Look for pattern: COMMAND [args] COMMAND?
            # The query command typically starts with the same mnemonic path and ends with ?
            # Improved regex to handle complex command patterns with <x> placeholders
            query_match = re.search(r'\s+([A-Za-z:]+(?:<x>)?[A-Za-z:]*\?)\s*$', s)
            if query_match:
                # Everything before the query command is the SET syntax
                potential_set = s[:query_match.start()].strip()
                potential_query = query_match.group(1).strip()
                
                # Validate: SET should have arguments, QUERY should just end with ?
                if potential_set and ('{' in potential_set or '<NR' in potential_set or '<QString' in potential_set):
                    if not set_syntax:
                        set_syntax = potential_set
                    if not query_syntax:
                        query_syntax = potential_query
                    continue
            
            # Simple case: just a query line
            if not query_syntax:
                query_syntax = s
        else:
            # No "?" means this is a SET syntax line
            if not set_syntax:
                set_syntax = s
    
    # For query-only commands, don't create a set syntax
    if is_query_only:
        set_syntax = None
        if not query_syntax:
            query_syntax = cmd_key if cmd_key.endswith("?") else cmd_key + "?"
    else:
        # For non-query-only commands, ensure both syntaxes exist if needed
        # Only set default set_syntax if we don't already have one
        # This prevents overwriting a correctly parsed set_syntax that includes arguments
        if not set_syntax and not cmd_key.endswith("?"):
            set_syntax = cmd_key.replace("?", "")
        if not query_syntax:
            query_syntax = cmd_key if cmd_key.endswith("?") else cmd_key + "?"
    
    return {
        "set": set_syntax,
        "query": query_syntax
    }


# Test cases
test_cases = [
    {
        "name": "BUS:B<x>:ARINC429A:SOUrce - Combined syntax",
        "cmd_key": "BUS:B<x>:ARINC429A:SOUrce",
        "syntax_lines": [
            "BUS:B<x>:ARINC429A:SOUrce  {CH<x>|MATH<x>|REF<x>} BUS:B<x>:ARINC429A:SOUrce?"
        ],
        "desc": "This command sets or queries the source for the specified ARINC429 bus.",
        "expected_set": "BUS:B<x>:ARINC429A:SOUrce  {CH<x>|MATH<x>|REF<x>}",
        "expected_query": "BUS:B<x>:ARINC429A:SOUrce?"
    },
    {
        "name": "MATH:MATH<x>:LABel - Combined syntax",
        "cmd_key": "MATH:MATH<x>:LABel",
        "syntax_lines": [
            "MATH:MATH<x>:LABel {<QString>} MATH:MATH<x>:LABel?"
        ],
        "desc": "Sets or queries the label for the specified math waveform.",
        "expected_set": "MATH:MATH<x>:LABel {<QString>}",
        "expected_query": "MATH:MATH<x>:LABel?"
    },
    {
        "name": "Simple set command",
        "cmd_key": "DATa:SOUrce",
        "syntax_lines": [
            "DATa:SOUrce {CH<x>|MATH<x>|REF<x>}"
        ],
        "desc": "Sets the waveform source.",
        "expected_set": "DATa:SOUrce {CH<x>|MATH<x>|REF<x>}",
        "expected_query": "DATa:SOUrce?"
    },
    {
        "name": "Query only command",
        "cmd_key": "SYSTem:ERRor?",
        "syntax_lines": [
            "SYSTem:ERRor?"
        ],
        "desc": "Query-only command to get system errors.",
        "expected_set": None,
        "expected_query": "SYSTem:ERRor?"
    },
    {
        "name": "Separate set and query lines",
        "cmd_key": "CH<x>:SCAle",
        "syntax_lines": [
            "CH<x>:SCAle <NR3>",
            "CH<x>:SCAle?"
        ],
        "desc": "Sets or queries the vertical scale.",
        "expected_set": "CH<x>:SCAle <NR3>",
        "expected_query": "CH<x>:SCAle?"
    }
]

print("=" * 80)
print("Testing Syntax Extraction Fix")
print("=" * 80)
print()

all_passed = True

for i, test in enumerate(test_cases, 1):
    print(f"Test {i}: {test['name']}")
    print(f"  Command: {test['cmd_key']}")
    print(f"  Syntax line(s): {test['syntax_lines']}")
    print()
    
    result = extract_syntax_fixed(test['syntax_lines'], test['cmd_key'], test['desc'])
    
    print(f"  Result:")
    print(f"    set:   {result['set']}")
    print(f"    query: {result['query']}")
    print()
    
    # Check results
    set_match = result['set'] == test['expected_set'] or (result['set'] is None and test['expected_set'] is None)
    query_match = result['query'] == test['expected_query']
    
    if set_match and query_match:
        print(f"  [PASSED]")
    else:
        print(f"  [FAILED]")
        if not set_match:
            print(f"    Expected set:   {test['expected_set']}")
            print(f"    Got set:        {result['set']}")
        if not query_match:
            print(f"    Expected query: {test['expected_query']}")
            print(f"    Got query:       {result['query']}")
        all_passed = False
    
    print()
    print("-" * 80)
    print()

print("=" * 80)
if all_passed:
    print("[SUCCESS] ALL TESTS PASSED!")
else:
    print("[FAILED] SOME TESTS FAILED")
print("=" * 80)

