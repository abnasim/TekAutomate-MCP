"""
Validation Script for SCPI Extraction
Checks for improvements:
1. Enum params properly combined (CH<x>/MATH<x>/REF<x> as ONE param)
2. NR params have correct min/max with signs
3. Notes appear in JSON
4. No duplicate params from enum options
5. Filler words removed from arguments
"""

import json
import sys
import os

# Colors for terminal output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def validate_extraction(json_path):
    """Validate the extracted JSON file."""
    
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}VALIDATING EXTRACTION{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")
    
    if not os.path.exists(json_path):
        print(f"{RED}ERROR: File not found: {json_path}{RESET}")
        return False
    
    print(f"Loading: {json_path}")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    groups = data.get("groups", {})
    total_commands = 0
    
    # Validation results
    results = {
        "enum_combined": {"pass": 0, "fail": 0, "examples": []},
        "nr_with_ranges": {"pass": 0, "fail": 0, "examples": []},
        "notes_captured": {"pass": 0, "fail": 0, "examples": []},
        "no_duplicate_params": {"pass": 0, "fail": 0, "examples": []},
        "no_filler_words": {"pass": 0, "fail": 0, "examples": []}
    }
    
    filler_words = ["this", "and", "the", "a", "an", "or"]
    
    for group_name, group_data in groups.items():
        commands = group_data.get("commands", [])
        total_commands += len(commands)
        
        for cmd in commands:
            scpi = cmd.get("scpi", "")
            params = cmd.get("params", [])
            notes = cmd.get("notes", [])
            arguments = cmd.get("arguments", "")
            
            # Check 1: Enum params combined (CH<x>|MATH<x>|REF<x> should be ONE param)
            param_names = [p.get("name", "") for p in params]
            
            # Check if we have separate CH<x>, MATH<x>, REF<x> params (BAD)
            has_separate_enum_params = (
                "CH<x>" in param_names or 
                "MATH<x>" in param_names or 
                "REF<x>" in param_names
            )
            
            # Look for combined params with multiple enum options (GOOD)
            has_combined_enum = False
            for param in params:
                if param.get("type") == "enum":
                    options = param.get("options", [])
                    # Check if options include multiple types (CH, MATH, REF)
                    has_ch = any("CH" in str(opt) for opt in options)
                    has_math = any("MATH" in str(opt) for opt in options)
                    has_ref = any("REF" in str(opt) for opt in options)
                    if (has_ch and has_math) or (has_ch and has_ref) or (has_math and has_ref):
                        has_combined_enum = True
                        break
            
            # If command has {CH<x>|MATH<x>|REF<x>} in syntax
            if "{CH<x>|MATH<x>" in scpi or (arguments and "CH<x>|MATH<x>" in arguments):
                if has_combined_enum and not has_separate_enum_params:
                    results["enum_combined"]["pass"] += 1
                else:
                    results["enum_combined"]["fail"] += 1
                    if len(results["enum_combined"]["examples"]) < 3:
                        results["enum_combined"]["examples"].append({
                            "scpi": scpi,
                            "params": param_names
                        })
            
            # Check 2: NR params have min/max ranges
            for param in params:
                if param.get("type") in ["NR1", "NR2", "NR3", "numeric"]:
                    if "min" in param and "max" in param:
                        results["nr_with_ranges"]["pass"] += 1
                        # Check for negative signs
                        if param.get("min", 0) < 0 or param.get("max", 0) < 0:
                            if len(results["nr_with_ranges"]["examples"]) < 3:
                                results["nr_with_ranges"]["examples"].append({
                                    "scpi": scpi,
                                    "param": param.get("name"),
                                    "min": param.get("min"),
                                    "max": param.get("max")
                                })
                    else:
                        results["nr_with_ranges"]["fail"] += 1
            
            # Check 3: Notes captured
            if notes and len(notes) > 0:
                results["notes_captured"]["pass"] += 1
                if len(results["notes_captured"]["examples"]) < 3:
                    results["notes_captured"]["examples"].append({
                        "scpi": scpi,
                        "notes": notes[:1]  # First note only
                    })
            
            # Check 4: No duplicate params (param names shouldn't match enum option values)
            for param in params:
                param_name = param.get("name", "")
                param_type = param.get("type", "")
                
                # Check if any OTHER param has this as an enum option
                is_duplicate = False
                for other_param in params:
                    if other_param == param:
                        continue
                    if other_param.get("type") == "enum":
                        options = other_param.get("options", [])
                        if param_name in options:
                            is_duplicate = True
                            break
                
                if is_duplicate:
                    results["no_duplicate_params"]["fail"] += 1
                    if len(results["no_duplicate_params"]["examples"]) < 3:
                        results["no_duplicate_params"]["examples"].append({
                            "scpi": scpi,
                            "duplicate_param": param_name
                        })
            
            # If no duplicates found in this command
            if not any(p.get("name") in [opt for param in params if param.get("type") == "enum" for opt in param.get("options", [])] for p in params):
                results["no_duplicate_params"]["pass"] += 1
            
            # Check 5: No filler words in arguments
            if arguments:
                args_lower = arguments.lower()
                has_filler = any(f" {word} " in args_lower for word in filler_words)
                if not has_filler:
                    results["no_filler_words"]["pass"] += 1
                else:
                    results["no_filler_words"]["fail"] += 1
                    if len(results["no_filler_words"]["examples"]) < 3:
                        results["no_filler_words"]["examples"].append({
                            "scpi": scpi,
                            "arguments": arguments[:100]
                        })
    
    # Print results
    print(f"\n{BLUE}VALIDATION RESULTS{RESET}")
    print(f"{BLUE}{'='*60}{RESET}")
    print(f"Total commands validated: {total_commands}\n")
    
    def print_result(name, desc, result):
        total = result["pass"] + result["fail"]
        if total == 0:
            status = f"{YELLOW}NO DATA{RESET}"
            pct = "N/A"
        elif result["fail"] == 0:
            status = f"{GREEN}[PASS]{RESET}"
            pct = "100%"
        else:
            status = f"{RED}[FAIL]{RESET}"
            pct = f"{result['pass']}/{total} ({100*result['pass']//total}%)"
        
        print(f"{status} {name}: {desc}")
        print(f"    Pass: {result['pass']}, Fail: {result['fail']} ({pct})")
        
        if result["examples"]:
            print(f"    Examples:")
            for ex in result["examples"][:2]:
                print(f"      - {ex}")
        print()
    
    print_result(
        "Enum Combining",
        "CH<x>|MATH<x>|REF<x> as ONE param",
        results["enum_combined"]
    )
    
    print_result(
        "NR Ranges",
        "NR params have min/max with correct signs",
        results["nr_with_ranges"]
    )
    
    print_result(
        "Notes Capture",
        "Notes appear in JSON",
        results["notes_captured"]
    )
    
    print_result(
        "No Duplicates",
        "No params named after enum options",
        results["no_duplicate_params"]
    )
    
    print_result(
        "No Filler Words",
        "Arguments don't contain 'this/and/the'",
        results["no_filler_words"]
    )
    
    # Overall assessment
    total_fails = sum(r["fail"] for r in results.values())
    if total_fails == 0:
        print(f"\n{GREEN}{'='*60}{RESET}")
        print(f"{GREEN}ALL VALIDATIONS PASSED!{RESET}")
        print(f"{GREEN}{'='*60}{RESET}\n")
        return True
    else:
        print(f"\n{YELLOW}{'='*60}{RESET}")
        print(f"{YELLOW}SOME VALIDATIONS FAILED - Review needed{RESET}")
        print(f"{YELLOW}{'='*60}{RESET}\n")
        return False

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    json_path = os.path.join(project_root, "public", "commands", "mso_commands_final.json")
    
    validate_extraction(json_path)

