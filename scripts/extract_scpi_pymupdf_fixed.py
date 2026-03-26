import fitz  # PyMuPDF
import json
import re

# ================= CONFIGURATION =================
INPUT_PDF = "4-5-6_MSO_Programmer_077189801_RevA.pdf"
OUTPUT_JSON = "mso_commands_clean.json"

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

def clean_text(text_list):
    """Joins and cleans text buffer."""
    if not text_list: 
        return None
    # Remove empty strings and join with newlines, then clean
    lines = [l.strip() for l in text_list if l.strip()]
    if not lines:
        return None
    
    text = "\n".join(lines)
    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text)
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
    # e.g., "ACQuire:STATE" (1 word) or "ACQuire:STATE {ON|OFF}" (2-3 words)
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
    doc = fitz.open(pdf_path)
    
    commands = {}  # Use dict for deduplication
    current_cmd = None
    state = "SEARCHING"
    buffer = []

    def save_current_section():
        """Saves buffer to current command."""
        if not current_cmd: 
            return
        
        if not buffer:
            return
        
        # Special handling for Syntax (keep as list)
        if state == "SYNTAX":
            syntax_lines = [l.strip() for l in buffer if l.strip()]
            # Filter out non-syntax lines
            cleaned_syntax = []
            for line in syntax_lines:
                # Check if line looks like a command syntax
                if CMD_PATTERN.match(line.split()[0] if line.split() else ""):
                    cleaned_syntax.append(line)
                elif '<' in line or '{' in line or '?' in line:  # Has argument syntax
                    cleaned_syntax.append(line)
            current_cmd["syntax"] = cleaned_syntax if cleaned_syntax else None
        
        elif state == "RELATED":
            content = clean_text(buffer)
            if content:
                # Extract command-like strings
                clean = content.replace("See also", "").replace(",", " ").replace("\n", " ")
                # Split and find command patterns
                refs = []
                for word in clean.split():
                    word = word.strip()
                    if CMD_PATTERN.match(word):
                        refs.append(word)
                current_cmd["relatedCommands"] = refs if refs else None
            else:
                current_cmd["relatedCommands"] = None
        
        elif state == "GROUP":
            content = clean_text(buffer)
            # Group should be a single value, not multiple lines
            if content:
                # Take first line only
                group = content.split('\n')[0].strip()
                current_cmd["group"] = group if group else None
            else:
                current_cmd["group"] = None
        
        elif state == "RETURNS":
            content = clean_text(buffer)
            current_cmd["returns"] = content if content else None
        
        elif state == "CONDITIONS":
            content = clean_text(buffer)
            current_cmd["conditions"] = content if content else None
        
        elif state == "ARGUMENTS":
            content = clean_text(buffer)
            current_cmd["arguments"] = content if content else None
        
        elif state == "EXAMPLES":
            content = clean_text(buffer)
            current_cmd["examples"] = content if content else None
        
        elif state == "DESCRIPTION":
            content = clean_text(buffer)
            if content:
                # Filter out section-like content from description
                # Remove lines that look like section headers
                filtered_lines = []
                for line in buffer:
                    line_stripped = line.strip()
                    if not line_stripped:
                        continue
                    # Check if line is a section header
                    is_section = False
                    for pattern in SECTION_PATTERNS.keys():
                        if pattern.match(line_stripped):
                            is_section = True
                            break
                    if not is_section:
                        filtered_lines.append(line_stripped)
                
                if filtered_lines:
                    desc = "\n".join(filtered_lines)
                    # Remove excessive whitespace
                    desc = re.sub(r'\s+', ' ', desc).strip()
                    # Limit description length (remove if too long - likely wrong)
                    if len(desc) > 2000:
                        # Try to get first sentence
                        sentences = desc.split('.')
                        if sentences:
                            desc = sentences[0].strip() + '.'
                        else:
                            desc = desc[:500] + "..."
                    
                    if current_cmd.get("description"):
                        current_cmd["description"] += " " + desc
                    else:
                        current_cmd["description"] = desc
        
        buffer.clear()

    def finalize_command():
        """Saves current command to the dict."""
        if not current_cmd or not current_cmd.get("scpi"):
            return
        
        # Save current section
        save_current_section()
        
        scpi = current_cmd["scpi"]
        
        # Normalize all fields
        for key in ["group", "syntax", "relatedCommands", "arguments", "examples", 
                   "description", "conditions", "returns"]:
            if key not in current_cmd:
                current_cmd[key] = None
            # Convert empty strings to None
            if current_cmd[key] == "":
                current_cmd[key] = None
        
        # DEDUPLICATION LOGIC:
        # If command exists, prefer the one with more complete data
        if scpi in commands:
            existing = commands[scpi]
            new_score = sum([
                1 if current_cmd.get("syntax") else 0,
                1 if current_cmd.get("arguments") else 0,
                1 if current_cmd.get("examples") else 0,
                1 if current_cmd.get("group") else 0,
                1 if current_cmd.get("description") else 0,
            ])
            existing_score = sum([
                1 if existing.get("syntax") else 0,
                1 if existing.get("arguments") else 0,
                1 if existing.get("examples") else 0,
                1 if existing.get("group") else 0,
                1 if existing.get("description") else 0,
            ])
            
            # Only replace if new one has significantly more data
            if new_score > existing_score + 1:
                commands[scpi] = current_cmd
        else:
            commands[scpi] = current_cmd

    total_pages = len(doc)
    print(f"Processing {total_pages} pages...")

    for page_num, page in enumerate(doc):
        if page_num % 100 == 0: 
            print(f"  Scanning page {page_num}/{total_pages}...")

        text = page.get_text("text")
        lines = text.split('\n')

        for line in lines:
            line = line.strip()
            if not line: 
                continue
            
            # Skip page numbers
            if line.isdigit() and len(line) <= 3:
                continue

            # Skip Ignore Phrases
            if any(phrase.lower() in line.lower() for phrase in IGNORE_PHRASES):
                continue
            
            # Skip TOC lines
            if TOC_PATTERN.search(line):
                continue

            line_lower = line.lower()
            words = line.split()
            if not words:
                continue
            
            first_word = words[0]

            # 1. Check for Section Headers FIRST (if we're in a command)
            if current_cmd:
                is_section = False
                for pattern, section_name in SECTION_PATTERNS.items():
                    if pattern.match(line):
                        save_current_section()  # Save previous section
                        state = section_name
                        buffer = []
                        
                        # Handle inline content "Group: Acquisition" or "Group\nAcquisition"
                        # Check if there's content after the header on same line
                        parts = line.split(':', 1)
                        if len(parts) > 1 and parts[1].strip():
                            buffer.append(parts[1].strip())
                        
                        is_section = True
                        break
                
                if is_section:
                    continue

            # 2. Check for Command Header
            if CMD_PATTERN.match(first_word):
                # Verify it's a real header, not a sentence
                if is_valid_header_line(line, first_word):
                    finalize_command()  # Close previous command
                    
                    # Start new command
                    current_cmd = {
                        "scpi": first_word,
                        "description": None,
                        "group": None,
                        "syntax": None,
                        "relatedCommands": None,
                        "arguments": None,
                        "examples": None,
                        "conditions": None,
                        "returns": None
                    }
                    state = "DESCRIPTION"
                    buffer = []
                    
                    # Capture rest of line as description start (if any)
                    rest = line[len(first_word):].strip()
                    if rest and not rest.startswith('{') and not rest.startswith('<'):
                        # Only add if it looks like description, not syntax
                        if len(rest.split()) < 5:  # Short enough to be description
                            buffer.append(rest)
                    continue

            # 3. Accumulate Content (only if we're in a command)
            if current_cmd and state != "SEARCHING":
                # Skip lines that look like new commands (false positives)
                if len(words) == 1 and CMD_PATTERN.match(first_word):
                    # Might be a command in examples or syntax - check context
                    if state not in ["EXAMPLES", "SYNTAX"]:
                        # In description, this might be a new command
                        # Check if it's followed by description-like text
                        continue
                
                buffer.append(line)

    # Finalize last command
    finalize_command()
    
    # Convert dict back to list
    final_list = list(commands.values())
    
    # Sort alphabetically
    final_list.sort(key=lambda x: x.get('scpi', ''))

    return final_list

if __name__ == "__main__":
    data = extract_mso_commands(INPUT_PDF)
    
    output = {
        "category": "All",
        "instruments": ["MSO4", "MSO5", "MSO6", "MSO7"],
        "commands": data
    }

    print(f"\nExtracted {len(data)} unique commands.")
    
    # Print statistics
    with_group = sum(1 for c in data if c.get("group"))
    with_syntax = sum(1 for c in data if c.get("syntax"))
    with_description = sum(1 for c in data if c.get("description"))
    with_examples = sum(1 for c in data if c.get("examples"))
    with_arguments = sum(1 for c in data if c.get("arguments"))
    with_related = sum(1 for c in data if c.get("relatedCommands"))
    
    print(f"  Commands with group: {with_group}")
    print(f"  Commands with syntax: {with_syntax}")
    print(f"  Commands with description: {with_description}")
    print(f"  Commands with examples: {with_examples}")
    print(f"  Commands with arguments: {with_arguments}")
    print(f"  Commands with relatedCommands: {with_related}")
    
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {OUTPUT_JSON}")










