"""
Enhanced SCPI Command Extraction Script using pdfplumber
pdfplumber often handles text extraction better than PyMuPDF, especially for formatted PDFs
"""

import pdfplumber
import json
import re
import sys
import os

# Add scripts directory to path to import command groups mapping
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from command_groups_mapping import COMMAND_GROUPS

# ================= CONFIGURATION =================
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

PDF_FILENAME = "4-5-6_MSO_Programmer_077189801_RevA.pdf"
search_locations = [
    os.path.join(PROJECT_ROOT, PDF_FILENAME),
    os.path.join(PROJECT_ROOT, "commands", PDF_FILENAME),
    os.path.join(PROJECT_ROOT, "public", "commands", PDF_FILENAME),
    os.path.join(PROJECT_ROOT, "docs", PDF_FILENAME),
    os.path.join(PROJECT_ROOT, "scripts", PDF_FILENAME),
]

INPUT_PDF = None
for location in search_locations:
    if os.path.exists(location):
        INPUT_PDF = location
        print(f"Found PDF: {INPUT_PDF}")
        break

if not INPUT_PDF:
    import glob
    matches = glob.glob(os.path.join(PROJECT_ROOT, "**", "*MSO*Programmer*.pdf"), recursive=True)
    if matches:
        INPUT_PDF = matches[0]
        print(f"Found PDF: {INPUT_PDF}")
    else:
        print(f"ERROR: PDF file not found!")
        sys.exit(1)

OUTPUT_JSON = os.path.join(PROJECT_ROOT, "public", "commands", "mso_commands_final.json")

# Regex patterns
CMD_PATTERN = re.compile(
    r'^([*][A-Za-z]{2,}\??)$|'  # Star commands
    r'^([A-Za-z][A-Za-z0-9<>]*:[A-Za-z0-9<>:]+(?:\?)?)$'  # Standard commands
)

def get_group_for_command(cmd):
    """Find which group a command belongs to using the mapping."""
    if not cmd:
        return None
    
    # Normalize command for matching
    normalized = cmd.upper().replace('?', '').replace('<N>', '<n>').replace('<X>', '<x>')
    
    # Normalize special patterns with <x> in the middle (before "Val" or "Voltage" or "VOLTage")
    normalized = re.sub(r'PG(\d+)VAL', r'PG<x>VAL', normalized)
    normalized = re.sub(r'PW(\d+)VAL', r'PW<x>VAL', normalized)
    normalized = re.sub(r'AMP(\d+)VAL', r'AMP<x>VAL', normalized)
    normalized = re.sub(r'FREQ(\d+)VAL', r'FREQ<x>VAL', normalized)
    normalized = re.sub(r'SPAN(\d+)VAL', r'SPAN<x>VAL', normalized)
    normalized = re.sub(r'RIPPLEFREQ(\d+)VAL', r'RIPPLEFREQ<x>VAL', normalized)
    normalized = re.sub(r'MAXG(\d+)VOLTAGE', r'MAXG<x>VOLTAGE', normalized)
    normalized = re.sub(r'OUTPUT(\d+)VOLTAGE', r'OUTPUT<x>VOLTAGE', normalized)
    
    # Normalize view patterns
    normalized = re.sub(r'WAVEVIEW\d+', r'WAVEVIEW<x>', normalized)
    normalized = re.sub(r'PLOTVIEW\d+', r'PLOTVIEW<x>', normalized)
    normalized = re.sub(r'MATHFFTVIEW\d+', r'MATHFFTVIEW<x>', normalized)
    normalized = re.sub(r'REFFFTVIEW\d+', r'REFFFTVIEW<x>', normalized)
    normalized = re.sub(r'SPECVIEW\d+', r'SPECVIEW<x>', normalized)
    
    for group_name, group_data in COMMAND_GROUPS.items():
        commands_list = group_data.get("commands", [])
        for mapped_cmd in commands_list:
            # Normalize mapped command
            mapped_normalized = mapped_cmd.upper().replace('?', '').replace('<N>', '<n>').replace('<X>', '<x>')
            
            # Check exact match
            if normalized == mapped_normalized:
                return group_name
            
            # Check if command starts with mapped command (for parameterized commands)
            if normalized.startswith(mapped_normalized) or mapped_normalized.startswith(normalized):
                # More specific check: match up to parameter
                base_normalized = re.sub(r'[<{][nx][>}]', '', normalized)
                base_mapped = re.sub(r'[<{][nx][>}]', '', mapped_normalized)
                if base_normalized == base_mapped:
                    return group_name
    
    return None

def clean_text(text_or_list):
    """Clean extracted text, fixing spacing issues from PDF extraction."""
    if not text_or_list:
        return None
    
    # Handle both string and list inputs
    if isinstance(text_or_list, list):
        text = "\n".join([line.strip() for line in text_or_list if line.strip()])
    else:
        text = text_or_list
    
    if not text:
        return None
    
    # Fix common PDF extraction issues
    # Remove excessive spaces but preserve structure
    text = re.sub(r' +', ' ', text)
    
    # Fix malformed text with spaces between single letters
    # Pattern: "s t a t e" -> "state"
    # Run multiple times to catch all patterns
    for _ in range(5):
        old_text = text
        # Fix sequences of single lowercase letters
        text = re.sub(r'\b([a-z]) ([a-z]) ([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3\4\5', text)
        text = re.sub(r'\b([a-z]) ([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3\4', text)
        text = re.sub(r'\b([a-z]) ([a-z]) ([a-z])\b', r'\1\2\3', text)
        text = re.sub(r'\b([a-z]) ([a-z])\b', r'\1\2', text)
        if text == old_text:
            break
    
    # Fix "s o urce" -> "source"
    text = re.sub(r'\b([a-z]) o ([a-z][a-z]+)\b', r'\1o\2', text)
    
    # Clean up whitespace
    text = re.sub(r'\n\s*\n', '\n', text)
    text = text.strip()
    
    return text if text else None

def extract_mso_commands(pdf_path):
    print(f"Opening {pdf_path} with pdfplumber...")
    print(f"Using {len(COMMAND_GROUPS)} command groups for validation")
    
    commands = {}
    current_cmd = None
    state = "SEARCHING"
    buffer = []
    
    def save_current_section():
        """Saves buffer content to the appropriate field."""
        nonlocal buffer, state
        if not current_cmd:
            return
        
        text_content = clean_text(buffer)
        if not text_content:
            return
        
        if state == "DESCRIPTION":
            current_cmd["description"] = text_content
        elif state == "CONDITIONS":
            current_cmd["conditions"] = text_content
        elif state == "GROUP":
            extracted_group = text_content.strip()
            mapped_group = get_group_for_command(current_cmd["scpi"])
            current_cmd["group"] = mapped_group or extracted_group
        elif state == "SYNTAX":
            syntax_lines = [line.strip() for line in buffer if line.strip()]
            if syntax_lines:
                if not current_cmd.get("syntax"):
                    current_cmd["syntax"] = []
                current_cmd["syntax"].extend(syntax_lines)
        elif state == "ARGUMENTS":
            current_cmd["arguments"] = text_content
        elif state == "EXAMPLES":
            if not current_cmd.get("examples"):
                current_cmd["examples"] = ""
            if current_cmd["examples"]:
                current_cmd["examples"] += "\n" + text_content
            else:
                current_cmd["examples"] = text_content
        elif state == "RELATED":
            clean = text_content.replace(',', ' ').replace('\n', ' ')
            related = [cmd.strip() for cmd in clean.split() if cmd.strip() and CMD_PATTERN.match(cmd.strip())]
            if related:
                if not current_cmd.get("relatedCommands"):
                    current_cmd["relatedCommands"] = []
                current_cmd["relatedCommands"].extend(related)
        elif state == "RETURNS":
            current_cmd["returns"] = text_content
        
        buffer = []
    
    def finalize_command():
        """Saves the current command and resets."""
        nonlocal current_cmd, state, buffer
        
        if not current_cmd:
            return
        
        save_current_section()
        
        # Assign group if not set
        if not current_cmd.get("group"):
            mapped_group = get_group_for_command(current_cmd["scpi"])
            if mapped_group:
                current_cmd["group"] = mapped_group
        
        # Normalize fields
        if not current_cmd.get("relatedCommands"):
            current_cmd["relatedCommands"] = None
        if not current_cmd.get("conditions"):
            current_cmd["conditions"] = None
        if not current_cmd.get("returns"):
            current_cmd["returns"] = None
        if not current_cmd.get("syntax"):
            current_cmd["syntax"] = []
        if not current_cmd.get("examples"):
            current_cmd["examples"] = None
        
        # Deduplication
        cmd_key = current_cmd["scpi"]
        if cmd_key in commands:
            existing = commands[cmd_key]
            for key in ["description", "group", "arguments", "examples", "conditions", "returns"]:
                if not existing.get(key) and current_cmd.get(key):
                    existing[key] = current_cmd[key]
            if current_cmd.get("syntax"):
                existing["syntax"].extend([s for s in current_cmd["syntax"] if s not in existing["syntax"]])
            if current_cmd.get("relatedCommands"):
                if not existing.get("relatedCommands"):
                    existing["relatedCommands"] = []
                existing["relatedCommands"].extend([r for r in current_cmd["relatedCommands"] if r not in existing["relatedCommands"]])
        else:
            commands[cmd_key] = current_cmd
        
        current_cmd = None
        state = "SEARCHING"
        buffer = []
    
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        print(f"Processing {total_pages} pages...")
        
        for page_num, page in enumerate(pdf.pages):
            text = page.extract_text()
            if not text:
                continue
            
            lines = text.split('\n')
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                line_lower = line.lower()
                
                # State switching keywords
                if line_lower.startswith("conditions"):
                    save_current_section()
                    state = "CONDITIONS"
                    buffer = []
                    continue
                elif line_lower.startswith("group"):
                    save_current_section()
                    state = "GROUP"
                    buffer = []
                    continue
                elif line_lower.startswith("syntax"):
                    save_current_section()
                    state = "SYNTAX"
                    buffer = []
                    continue
                elif line_lower.startswith("related commands") or (line_lower.startswith("related") and "command" in line_lower):
                    save_current_section()
                    state = "RELATED"
                    buffer = []
                    continue
                elif line_lower.startswith("arguments") or line_lower.startswith("args"):
                    save_current_section()
                    state = "ARGUMENTS"
                    buffer = []
                    continue
                elif line_lower.startswith("examples") or line_lower.startswith("example"):
                    save_current_section()
                    state = "EXAMPLES"
                    buffer = []
                    continue
                elif line_lower.startswith("returns"):
                    save_current_section()
                    state = "RETURNS"
                    buffer = []
                    continue
                
                # Check for command header
                words = line.split()
                if words:
                    first_word = words[0]
                    if CMD_PATTERN.match(first_word) and state != "SYNTAX" and state != "EXAMPLES":
                        finalize_command()
                        
                        # Start new command
                        current_cmd = {
                            "scpi": first_word,
                            "description": None,
                            "conditions": None,
                            "group": None,
                            "syntax": [],
                            "relatedCommands": None,
                            "arguments": None,
                            "examples": None,
                            "returns": None
                        }
                        
                        # Check if description is on same line
                        if len(words) > 1:
                            desc_text = " ".join(words[1:])
                            if desc_text and not CMD_PATTERN.match(desc_text) and len(desc_text) < 200:
                                if not (desc_text.count(':') > 3):
                                    current_cmd["description"] = clean_text([desc_text])
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
        
        finalize_command()
    
    commands_list = list(commands.values())
    
    # Post-process: assign groups and clean descriptions
    unassigned = 0
    for cmd in commands_list:
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

# Copy the rest of the processing logic from extract_scpi_enhanced.py
# This includes: params detection, name generation, manualEntry creation, etc.
# For now, let's test if pdfplumber extracts text better - if it does, we'll add the full processing

if __name__ == "__main__":
    print("Testing pdfplumber extraction (text quality check)...")
    data = extract_mso_commands(INPUT_PDF)
    
    # Check sample commands to see if descriptions are better
    print(f"\nChecking first 5 commands for text quality:")
    for i, cmd in enumerate(data[:5]):
        desc = cmd.get('description', '')
        has_spaced_letters = ' s ' in desc or ' p ' in desc or ' c ' in desc
        print(f"  {i+1}. {cmd.get('scpi', 'N/A')}")
        print(f"     Description: {desc[:60]}...")
        print(f"     Has spacing issues: {has_spaced_letters}")
    
    print(f"\nIf pdfplumber extracts better, we'll complete the script with full processing.")
    print(f"Otherwise, consider converting PDF to Word/HTML format.")

