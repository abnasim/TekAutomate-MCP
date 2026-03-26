"""
Enhanced SCPI Command Extraction Script
Uses command groups mapping for validation and group assignment.
Handles alphabetical listing format with all required fields.
"""

import fitz  # PyMuPDF
import json
import re
import sys
import os

# Add scripts directory to path to import command groups mapping
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from command_groups_mapping import COMMAND_GROUPS

# ================= CONFIGURATION =================
# Get the project root directory (parent of scripts folder)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

# Try to find the PDF file
PDF_FILENAME = "4-5-6_MSO_Programmer_077189801_RevA.pdf"

# Priority search locations
search_locations = [
    os.path.join(PROJECT_ROOT, PDF_FILENAME),  # Project root
    os.path.join(PROJECT_ROOT, "commands", PDF_FILENAME),  # commands folder
    os.path.join(PROJECT_ROOT, "public", "commands", PDF_FILENAME),  # public/commands
    os.path.join(PROJECT_ROOT, "docs", PDF_FILENAME),  # docs folder
]

INPUT_PDF = None
for location in search_locations:
    if os.path.exists(location):
        INPUT_PDF = location
        print(f"Found PDF: {INPUT_PDF}")
        break

# If not found in common locations, search recursively
if not INPUT_PDF:
    import glob
    search_patterns = [
        os.path.join(PROJECT_ROOT, "**", "*MSO*Programmer*.pdf"),
        os.path.join(PROJECT_ROOT, "**", "*MSO*.pdf"),
    ]
    for pattern in search_patterns:
        matches = glob.glob(pattern, recursive=True)
        if matches:
            INPUT_PDF = matches[0]
            print(f"Found PDF: {INPUT_PDF}")
            break
    
    if not INPUT_PDF:
        print(f"ERROR: PDF file not found!")
        print(f"Looking for: {PDF_FILENAME}")
        print(f"\nSearched in:")
        for loc in search_locations:
            print(f"  - {loc}")
        print(f"\nPlease place the PDF file in one of these locations or update INPUT_PDF in the script.")
        sys.exit(1)

# Output to public/commands folder with the name the app expects
OUTPUT_JSON = os.path.join(PROJECT_ROOT, "public", "commands", "mso_commands_final.json")

# Regex for SCPI Headers - improved pattern
CMD_PATTERN = re.compile(
    r'^([*][A-Za-z]{2,}\??)$|'  # Star commands like *IDN?, *RST
    r'^([A-Za-z][A-Za-z0-9<>]*:[A-Za-z0-9<>:]+(?:\?)?)$'  # Standard commands
)

# Regex to detect Table of Contents lines (e.g., "Overview......1905")
TOC_PATTERN = re.compile(r'\.{5,}\s*\d+$')

# Section headers - exact match patterns (case-insensitive)
SECTION_PATTERNS = {
    re.compile(r'^Group\s*$', re.IGNORECASE): "GROUP",
    re.compile(r'^Syntax\s*$', re.IGNORECASE): "SYNTAX",
    re.compile(r'^Arguments?\s*$', re.IGNORECASE): "ARGUMENTS",
    re.compile(r'^Examples?\s*$', re.IGNORECASE): "EXAMPLES",
    re.compile(r'^Related\s+Commands?\s*$', re.IGNORECASE): "RELATED",
    re.compile(r'^Returns?\s*$', re.IGNORECASE): "RETURNS",
    re.compile(r'^Conditions?\s*$', re.IGNORECASE): "CONDITIONS"
}

# Lines to strictly ignore
IGNORE_PHRASES = [
    "Commands listed in alphabetical order",
    "Programmer Manual",
    "Table of Contents",
    "Getting Started",
    "legacy oscilloscope command",
    "Symbol Meaning",
    "Table continued",
    "Command groups",
    "Command syntax",
    "Backus-Naur form",
    "Preface"
]

# Invalid command patterns (false positives)
INVALID_COMMANDS = {
    "Table", "Figure", "Note", "Contents", "Preface", "Overview",
    "Command", "Commands", "Syntax", "Arguments", "Examples", "Group"
}

def normalize_command(cmd):
    """Normalize command for comparison (remove query marks, handle variants)."""
    if not cmd:
        return None
    # Remove query mark for comparison
    normalized = cmd.rstrip('?')
    # Handle {A|B} variants - normalize to just A for comparison
    normalized = re.sub(r'\{[^}]+\}', 'A', normalized)
    # Handle <x> placeholders - normalize
    normalized = re.sub(r'<[^>]+>', '<x>', normalized)
    return normalized.upper()

def get_group_for_command(cmd):
    """
    Find which command group a command belongs to using the mapping.
    Returns group name or None if not found.
    """
    if not cmd:
        return None
    
    normalized_cmd = normalize_command(cmd)
    
    # Search through all groups
    for group_name, group_data in COMMAND_GROUPS.items():
        for mapped_cmd in group_data["commands"]:
            normalized_mapped = normalize_command(mapped_cmd)
            # Check if commands match (exact or prefix match for hierarchical commands)
            if normalized_cmd == normalized_mapped:
                return group_name
            # Check if cmd is a prefix of mapped_cmd (e.g., "ACQuire" matches "ACQuire:STATE")
            if normalized_mapped.startswith(normalized_cmd + ":") or \
               normalized_cmd.startswith(normalized_mapped + ":"):
                return group_name
    
    return None

def clean_text(text_list):
    """Joins and cleans text buffer."""
    if not text_list: 
        return None
    # Remove empty strings and join with newlines, then clean
    lines = [l.strip() for l in text_list if l.strip()]
    if not lines:
        return None
    
    text = "\n".join(lines)
    # Remove excessive whitespace but preserve structure
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n', '\n', text)
    return text.strip() if text.strip() else None

def is_valid_header_line(line, first_word):
    """
    Strict checks to ensure this line is actually a command definition header,
    not just a sentence mentioning a command.
    """
    # 1. Check if it looks like a TOC line (ends in .... 123)
    if TOC_PATTERN.search(line):
        return False

    # 2. Check if it's an invalid command
    if first_word in INVALID_COMMANDS:
        return False

    # 3. Check word count. Real headers are short.
    words = line.split()
    if len(words) > 4:  # Allow up to 4 words for syntax examples
        return False
    
    # 4. Check for trailing punctuation (headers usually don't end in .)
    if line.strip().endswith('.') and len(words) > 1:
        return False

    # 5. Must match command pattern
    if not CMD_PATTERN.match(first_word):
        return False

    return True

def extract_mso_commands(pdf_path):
    print(f"Opening {pdf_path}...")
    print(f"Using {len(COMMAND_GROUPS)} command groups for validation")
    doc = fitz.open(pdf_path)
    
    commands = {}  # Use dict for deduplication: cmd -> command_data
    current_cmd = None
    state = "SEARCHING"
    buffer = []
    
    def save_current_section():
        """Saves buffer content to the appropriate field in current_cmd based on state."""
        nonlocal buffer, state
        if not current_cmd:
            return
        
        text_content = clean_text(buffer)
        if not text_content:
            return
        
        if state == "DESCRIPTION":
            # Clean description immediately when extracted
            import re
            cleaned = text_content
            # Fix malformed descriptions with spaces between single letters
            cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z]) ([a-z])', r'\1\2\3\4', cleaned)
            cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', cleaned)
            cleaned = re.sub(r'([a-z]) ([a-z])', r'\1\2', cleaned)
            cleaned = re.sub(r'([a-z]) o ([a-z][a-z]+)', r'\1o\2', cleaned)
            cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', cleaned)
            cleaned = re.sub(r'([a-z]) ([a-z])', r'\1\2', cleaned)
            cleaned = ' '.join(cleaned.split())
            current_cmd["description"] = cleaned
        elif state == "CONDITIONS":
            current_cmd["conditions"] = text_content
        elif state == "GROUP":
            # Use extracted group, but validate against mapping
            extracted_group = text_content.strip()
            # Validate and assign group using mapping
            mapped_group = get_group_for_command(current_cmd["scpi"])
            if mapped_group:
                current_cmd["group"] = mapped_group
            elif extracted_group:
                current_cmd["group"] = extracted_group
        elif state == "SYNTAX":
            # Syntax is a list - split by newlines
            syntax_lines = [line.strip() for line in buffer if line.strip()]
            if syntax_lines:
                if not current_cmd.get("syntax"):
                    current_cmd["syntax"] = []
                current_cmd["syntax"].extend(syntax_lines)
        elif state == "ARGUMENTS":
            # Arguments should be stored as text for now (can be parsed later)
            # But ensure it's not null - use empty string if needed
            current_cmd["arguments"] = text_content if text_content else None
        elif state == "EXAMPLES":
            # Examples can be multiple lines - store as string for now, will convert to array format later
            if not current_cmd.get("examples"):
                current_cmd["examples"] = ""
            if current_cmd["examples"]:
                current_cmd["examples"] += "\n" + text_content
            else:
                current_cmd["examples"] = text_content
        elif state == "RELATED":
            # Related commands are usually comma-separated or newline-separated
            # Clean and split
            clean = text_content.replace(',', ' ').replace('\n', ' ')
            related = [cmd.strip() for cmd in clean.split() if cmd.strip() and CMD_PATTERN.match(cmd.strip())]
            if related:
                if not current_cmd.get("relatedCommands"):
                    current_cmd["relatedCommands"] = []
                current_cmd["relatedCommands"].extend(related)
        elif state == "RETURNS":
            current_cmd["returns"] = text_content
        
        buffer = []
    
    def clean_description(desc):
        """Clean description to remove malformed content."""
        if not desc:
            return None
        
        import re
        
        # Remove descriptions that are just concatenated commands
        # Check if it has too many colons (likely command syntax)
        if desc.count(':') > 5:
            return None
        
        # Remove descriptions that are just newline-separated commands
        lines = desc.split('\n')
        command_like_lines = sum(1 for line in lines if ':' in line and len(line.split(':')) >= 2)
        if command_like_lines > 3:
            return None
        
        # Remove descriptions that are too long and look like command dumps
        if len(desc) > 500 and desc.count('\n') > 5:
            return None
        
        # Remove descriptions that start with a colon (likely command syntax)
        if desc.strip().startswith(':'):
            return None
        
        # Clean up: remove excessive newlines and whitespace
        cleaned = ' '.join(desc.split())
        
        # Fix malformed descriptions with spaces between single letters
        # Pattern: "s t a t e" -> "state", "p o sition" -> "position"
        # Match patterns like "s t a t e" or "p o sition"
        cleaned = re.sub(r'\b([a-z]) ([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3\4', cleaned)  # 4 letters
        cleaned = re.sub(r'\b([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3', cleaned)  # 3 letters
        cleaned = re.sub(r'\b([a-z]) ([a-z])\b', r'\1\2', cleaned)  # 2 letters
        # Fix patterns like "s o urce" -> "source"
        cleaned = re.sub(r'\b([a-z]) o ([a-z])\b', r'\1o\2', cleaned)
        cleaned = re.sub(r'\b([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3', cleaned)  # Run again
        
        if len(cleaned) > 500:
            cleaned = cleaned[:497] + '...'
        
        return cleaned if cleaned else None
    
    def finalize_command():
        """Saves the current command to the dictionary and resets."""
        nonlocal current_cmd, state, buffer
        
        if not current_cmd:
            return
        
        # Save any remaining buffer
        save_current_section()
        
        # Clean description
        if current_cmd.get("description"):
            cleaned_desc = clean_description(current_cmd["description"])
            if cleaned_desc:
                current_cmd["description"] = cleaned_desc
            else:
                current_cmd["description"] = None
        
        # Validate and assign group if not set
        if not current_cmd.get("group"):
            mapped_group = get_group_for_command(current_cmd["scpi"])
            if mapped_group:
                current_cmd["group"] = mapped_group
        
        # Normalize nulls and ensure proper types
        if not current_cmd.get("relatedCommands"):
            current_cmd["relatedCommands"] = None
        if not current_cmd.get("conditions"):
            current_cmd["conditions"] = None
        if not current_cmd.get("returns"):
            current_cmd["returns"] = None
        if not current_cmd.get("syntax"):
            current_cmd["syntax"] = []
        
        # Convert examples string to array format expected by the app
        examples_str = current_cmd.get("examples")
        if examples_str and isinstance(examples_str, str):
            # Split by newlines and create example objects
            example_lines = [line.strip() for line in examples_str.split('\n') if line.strip()]
            if example_lines:
                # Create array of example objects in the format expected by CommandDetailModal
                current_cmd["examples"] = [
                    {
                        "description": f"Example {i+1}",
                        "codeExamples": {
                            "scpi": {"code": line}
                        }
                    }
                    for i, line in enumerate(example_lines)
                ]
            else:
                current_cmd["examples"] = []
        elif not examples_str:
            current_cmd["examples"] = []
        
        # Ensure arguments is either null or a string (not an array unless it's already parsed)
        if current_cmd.get("arguments") and not isinstance(current_cmd["arguments"], str):
            # If it's not a string, convert to string or set to None
            if isinstance(current_cmd["arguments"], list):
                current_cmd["arguments"] = None  # Will be parsed later if needed
            else:
                current_cmd["arguments"] = str(current_cmd["arguments"])
        
        # Deduplication: if command exists, merge data (prefer richer entry)
        cmd_key = current_cmd["scpi"]
        if cmd_key in commands:
            existing = commands[cmd_key]
            # Merge: prefer non-empty fields
            for key in ["description", "group", "arguments", "examples", "conditions", "returns"]:
                if not existing.get(key) and current_cmd.get(key):
                    existing[key] = current_cmd[key]
            # Merge lists
            if current_cmd.get("syntax"):
                existing["syntax"].extend([s for s in current_cmd["syntax"] if s not in existing["syntax"]])
            if current_cmd.get("relatedCommands"):
                if not existing.get("relatedCommands"):
                    existing["relatedCommands"] = []
                existing["relatedCommands"].extend([r for r in current_cmd["relatedCommands"] if r not in existing["relatedCommands"]])
        else:
            commands[cmd_key] = current_cmd
        
        # Reset
        current_cmd = None
        state = "SEARCHING"
        buffer = []
    
    total_pages = len(doc)
    print(f"Processing {total_pages} pages...")
    
    for page_num in range(total_pages):
        page = doc[page_num]
        text = page.get_text()
        
        if not text:
            continue
        
        lines = text.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            # Skip ignored phrases
            if any(phrase.lower() in line.lower() for phrase in IGNORE_PHRASES):
                continue
            
            # Check for section headers
            section_found = False
            for pattern, section_name in SECTION_PATTERNS.items():
                if pattern.match(line):
                    save_current_section()
                    state = section_name
                    buffer = []
                    section_found = True
                    break
            
            if section_found:
                continue
            
            # Check for command header
            words = line.split()
            if words:
                first_word = words[0]
                
                # Check if this looks like a command header
                if is_valid_header_line(line, first_word):
                    # Save previous command
                    finalize_command()
                    
                    # Start new command
                    current_cmd = {
                        "scpi": first_word,
                        "description": None,
                        "conditions": None,
                        "group": None,  # Will be assigned using mapping
                        "syntax": [],
                        "relatedCommands": None,
                        "arguments": None,
                        "examples": None,
                        "returns": None
                    }
                    
                    # If there's description on the same line after the command
                    if len(words) > 1:
                        desc_text = " ".join(words[1:])
                        # Filter out if it's just more commands or malformed
                        if desc_text and not CMD_PATTERN.match(desc_text) and len(desc_text) < 200:
                            # Check if it looks like a real description (not just command syntax)
                            if not (desc_text.count(':') > 3 or desc_text.count('\n') > 2):
                                # Clean description immediately
                                import re
                                cleaned = desc_text
                                # Fix malformed descriptions with spaces between single letters
                                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z]) ([a-z])', r'\1\2\3\4', cleaned)
                                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', cleaned)
                                cleaned = re.sub(r'([a-z]) ([a-z])', r'\1\2', cleaned)
                                cleaned = re.sub(r'([a-z]) o ([a-z][a-z]+)', r'\1o\2', cleaned)
                                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', cleaned)
                                cleaned = re.sub(r'([a-z]) ([a-z])', r'\1\2', cleaned)
                                cleaned = ' '.join(cleaned.split())
                                current_cmd["description"] = cleaned
                                state = "SEARCHING"
                            else:
                                state = "DESCRIPTION"
                        else:
                            state = "DESCRIPTION"
                    else:
                        state = "DESCRIPTION"
                    
                    buffer = []
                    continue
            
            # Accumulate content
            if state != "SEARCHING" and current_cmd:
                buffer.append(line)
        
        if page_num % 50 == 0:
            print(f"  Processed page {page_num + 1}/{total_pages}...")
    
    # Finalize last command
    finalize_command()
    
    doc.close()
    
    # Convert dict to list
    commands_list = list(commands.values())
    
    # Post-process: assign groups and clean descriptions
    import re
    unassigned = 0
    for cmd in commands_list:
        # Clean description one more time to fix any remaining malformed text
        desc = cmd.get("description")
        if desc and isinstance(desc, str):
            # Fix "s t a t e" -> "state" patterns - use iterative approach
            cleaned = desc
            # Keep applying fixes until no more changes
            max_iterations = 10
            for _ in range(max_iterations):
                old_cleaned = cleaned
                # Fix sequences of single lowercase letters (without word boundaries for better matching)
                # Match any lowercase letter followed by space and another lowercase letter
                # Keep applying until all are fixed
                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z]) ([a-z]) ([a-z])', r'\1\2\3\4\5', cleaned)  # 5 letters
                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z]) ([a-z])', r'\1\2\3\4', cleaned)  # 4 letters
                cleaned = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', cleaned)  # 3 letters
                cleaned = re.sub(r'([a-z]) ([a-z])', r'\1\2', cleaned)  # 2 letters
                # Fix "s o urce" -> "source"
                cleaned = re.sub(r'([a-z]) o ([a-z][a-z]+)', r'\1o\2', cleaned)
                if cleaned == old_cleaned:
                    break
            
            cleaned = ' '.join(cleaned.split())
            if cleaned != desc:
                cmd["description"] = cleaned
                # Update shortDescription too
                if cmd.get("shortDescription") == desc:
                    cmd["shortDescription"] = cleaned.split('.')[0][:80]
                # Update name if it was generated from description
                if cmd.get("name") == desc or (cmd.get("name") and ' s ' in cmd.get("name")):
                    # Regenerate name from cleaned description
                    cleaned_name = generate_name(cmd.get("scpi", ""), cleaned, cleaned.split('.')[0][:80])
                    cmd["name"] = cleaned_name
        
        if not cmd.get("group"):
            mapped_group = get_group_for_command(cmd["scpi"])
            if mapped_group:
                cmd["group"] = mapped_group
            else:
                unassigned += 1
    
    print(f"\nExtraction complete!")
    print(f"  Total commands extracted: {len(commands_list)}")
    print(f"  Commands with assigned groups: {len(commands_list) - unassigned}")
    print(f"  Commands without groups: {unassigned}")
    
    return commands_list

# ================= EXECUTION =================
if __name__ == "__main__":
    data = extract_mso_commands(INPUT_PDF)
    
    # Organize commands by groups (format expected by App.tsx)
    groups_dict = {}
    ungrouped = []
    
    def detect_params(scpi_command):
        """Detect editable parameters in SCPI command like {n}, <n>, <x>"""
        import re
        params = []
        
        # Pattern 1: {n}, {x} etc. in command
        pattern1 = re.compile(r'\{(\w+)\}')
        matches1 = pattern1.findall(scpi_command)
        for param_name in matches1:
            params.append({
                "name": param_name,
                "type": "number" if param_name in ['n', 'x', 'y', 'z'] else "text",
                "default": 1 if param_name in ['n', 'x'] else None,
                "required": True
            })
        
        # Pattern 2: <n>, <x> etc. in command
        pattern2 = re.compile(r'<(\w+)>')
        matches2 = pattern2.findall(scpi_command)
        for param_name in matches2:
            # Avoid duplicates
            if not any(p["name"] == param_name for p in params):
                params.append({
                    "name": param_name,
                    "type": "number" if param_name in ['n', 'x', 'y', 'z'] else "text",
                    "default": 1 if param_name in ['n', 'x'] else None,
                    "required": True
                })
        
        # Pattern 3: CH<n>, REF<n>, MATH<n>, MEAS<n>, B<x>, etc.
        pattern3 = re.compile(r'(CH|REF|MATH|MEAS|BUS|B|CURSOR|ZOOM|SEARCH|PLOT|WAVEView|PLOTView)(<(\w+)>|\{(\w+)\})', re.IGNORECASE)
        matches3 = pattern3.findall(scpi_command)
        for match in matches3:
            param_name = match[2] or match[3]  # Get from <n> or {n}
            if param_name and not any(p["name"] == param_name for p in params):
                params.append({
                    "name": param_name,
                    "type": "number",
                    "default": 1,
                    "required": True
                })
        
        return params
    
    def generate_name(scpi, description, short_description):
        """Generate a user-friendly name for the command"""
        import re
        
        # Prefer description if it's good quality
        if description and len(description) < 100 and not description.startswith('Sets or queries s '):
            # Clean up description - remove "Sets or queries" prefix and capitalize properly
            desc = description.replace('Sets or queries ', '').replace('sets or queries ', '')
            if desc and not desc.startswith('s ') and not desc.startswith('p '):
                # Capitalize first letter
                return desc[0].upper() + desc[1:] if desc else scpi
        
        # Use short description if available and not malformed
        if short_description and len(short_description) < 100:
            # Check if it's malformed (has spaces between single letters)
            if not re.search(r'\b[A-Z] [A-Z] [A-Z]\b', short_description):
                return short_description[0].upper() + short_description[1:] if short_description else scpi
        
        # Fallback: generate from SCPI command - extract meaningful parts
        scpi_parts = scpi.split(':')
        if scpi_parts:
            # Get the last meaningful part
            last_part = scpi_parts[-1].replace('?', '').replace('<n>', 'n').replace('<x>', 'x').replace('{n}', 'n').replace('{x}', 'x')
            # Convert SCPI mnemonic to readable name
            # Handle patterns like STATE -> State, FREQuency -> Frequency
            # Split on capital letters but keep words together
            words = re.findall(r'[A-Z][a-z]*|[A-Z]+(?=[A-Z]|$)', last_part)
            if words:
                name = ' '.join(words)
                return name if name else scpi
        
        return scpi
    
    for cmd in data:
        # Ensure arguments is either null or an empty array (App.tsx expects array or undefined)
        if cmd.get("arguments") is not None and not isinstance(cmd.get("arguments"), list):
            cmd["arguments"] = None
        
        # Clean and fix description
        description = cmd.get("description")
        if description:
            import re
            # Fix malformed descriptions that have spaces between single letters
            # Pattern: "Sets or queries s t a t e" -> "Sets or queries state"
            fixed_desc = description
            # More aggressive: match any sequence of single lowercase letters with spaces
            # Pattern: "s t a t e" -> "state" (any number of single letters)
            # First, fix sequences of single letters: "s t a t e" -> "state"
            fixed_desc = re.sub(r'([a-z]) ([a-z]) ([a-z]) ([a-z])', r'\1\2\3\4', fixed_desc)
            fixed_desc = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', fixed_desc)
            fixed_desc = re.sub(r'([a-z]) ([a-z])', r'\1\2', fixed_desc)
            # Fix patterns like "s o urce" -> "source"
            fixed_desc = re.sub(r'([a-z]) o ([a-z][a-z]+)', r'\1o\2', fixed_desc)
            # Run again to catch any remaining
            fixed_desc = re.sub(r'([a-z]) ([a-z]) ([a-z])', r'\1\2\3', fixed_desc)
            fixed_desc = re.sub(r'([a-z]) ([a-z])', r'\1\2', fixed_desc)
            # Remove extra spaces
            fixed_desc = ' '.join(fixed_desc.split())
            cmd["description"] = fixed_desc
            
            # Extract first sentence as short description
            first_sentence = fixed_desc.split('.')[0].strip()
            if first_sentence:
                cmd["shortDescription"] = first_sentence[:80] if len(first_sentence) > 80 else first_sentence
            else:
                cmd["shortDescription"] = fixed_desc[:80] if len(fixed_desc) > 80 else fixed_desc
        else:
            # Generate a basic description from command structure
            scpi_parts = cmd.get("scpi", "").split(':')
            if scpi_parts:
                last_part = scpi_parts[-1].replace('?', '').replace('<n>', 'n').replace('<x>', 'x')
                # Convert SCPI mnemonic to readable text
                import re
                words = re.findall(r'[A-Z][a-z]*|[A-Z]+(?=[A-Z]|$)', last_part)
                readable = ' '.join(words).lower() if words else last_part.lower()
                cmd["description"] = f"Sets or queries {readable}"
                cmd["shortDescription"] = f"Sets or queries {readable}"
        
        # Generate name field - use cleaned description
        cleaned_description = cmd.get("description", "")
        cleaned_short = cmd.get("shortDescription", "")
        cmd["name"] = generate_name(cmd.get("scpi", ""), cleaned_description, cleaned_short)
        
        # Detect and add params array
        scpi_cmd = cmd.get("scpi", "")
        detected_params = detect_params(scpi_cmd)
        cmd["params"] = detected_params if detected_params else []
        
        # Store examples as string for main command (like original format)
        examples_str = cmd.get("examples")
        if isinstance(examples_str, list):
            # Convert array back to string for main command
            cmd["example"] = examples_str[0].get("codeExamples", {}).get("scpi", {}).get("code", "") if examples_str else None
        elif isinstance(examples_str, str):
            cmd["example"] = examples_str.split('\n')[0] if examples_str else None
        else:
            cmd["example"] = None
        
        # Create examples array for manualEntry (app expects array)
        examples_array = []
        if isinstance(examples_str, str) and examples_str:
            example_lines = [line.strip() for line in examples_str.split('\n') if line.strip()]
            examples_array = [
                {
                    "description": f"Example {i+1}",
                    "codeExamples": {
                        "scpi": {"code": line}
                    }
                }
                for i, line in enumerate(example_lines)
            ]
        elif isinstance(examples_str, list):
            examples_array = examples_str
        
        # Create manualEntry structure expected by the app
        cmd["_manualEntry"] = {
            "command": scpi_cmd,
            "header": scpi_cmd.split(' ')[0].split('?')[0] if scpi_cmd else "",
            "mnemonics": scpi_cmd.split(' ')[0].split(':') if scpi_cmd else [],
            "commandType": "query" if scpi_cmd.endswith('?') else ("both" if '?' in scpi_cmd else "set"),
            "description": cleaned_description or cmd.get("shortDescription", ""),
            "shortDescription": cmd.get("shortDescription", ""),
            "arguments": None,  # Will be parsed by the app if needed
            "examples": examples_array,  # Must be an array
            "relatedCommands": cmd.get("relatedCommands") if isinstance(cmd.get("relatedCommands"), list) else [],
            "commandGroup": cmd.get("group", ""),
            "syntax": {
                "set": scpi_cmd.replace('?', '') if scpi_cmd else "",
                "query": scpi_cmd if scpi_cmd and scpi_cmd.endswith('?') else (scpi_cmd + '?' if scpi_cmd else "")
            } if scpi_cmd else None,
            "manualReference": {"section": cmd.get("group", "")}
        }
        
        # Remove examples field from main command (use example instead, like original format)
        if "examples" in cmd:
            del cmd["examples"]
        
        group_name = cmd.get("group")
        if group_name:
            # Normalize group name
            if group_name not in groups_dict:
                groups_dict[group_name] = {
                    "description": COMMAND_GROUPS.get(group_name, {}).get("description", ""),
                    "commands": []
                }
            groups_dict[group_name]["commands"].append(cmd)
        else:
            ungrouped.append(cmd)
    
    # Add ungrouped commands to a "Miscellaneous" group
    if ungrouped:
        if "Miscellaneous" not in groups_dict:
            groups_dict["Miscellaneous"] = {
                "description": COMMAND_GROUPS.get("Miscellaneous", {}).get("description", "Commands that do not fit into other categories."),
                "commands": []
            }
        groups_dict["Miscellaneous"]["commands"].extend(ungrouped)
    
    # Wrap in the final structure (groups format expected by App.tsx)
    final_output = {
        "version": "1.0.0",
        "manual": {
            "title": "4-5-6 Series MSO Programmer Manual",
            "file": "4-5-6_MSO_Programmer_077189801_RevA.pdf",
            "revision": "A",
            "models": ["MSO4XB", "MSO5XB", "MSO58LP", "MSO6XB", "LPD64"],
            "families": ["MSO4", "MSO5", "MSO6", "MSO7"]
        },
        "groups": groups_dict,
        "metadata": {
            "total_commands": len(data),
            "total_groups": len(groups_dict),
            "command_groups_count": len(COMMAND_GROUPS),
            "extraction_date": "2024",
            "note": "Some commands may not be available on all instrument models. Some commands require specific options to be installed."
        }
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    
    print(f"\nSaving to {OUTPUT_JSON}...")
    print(f"  Organized into {len(groups_dict)} groups")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(final_output, f, indent=2, ensure_ascii=False)
    
    print("Extraction Complete!")
    print(f"\nThe file is ready to use in TekAutomate!")
    print(f"Location: {OUTPUT_JSON}")

