"""Debug script to check fonts in TekExpress document"""
import docx
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCX_FILE = os.path.join(PROJECT_ROOT, "TekExpress_USB4Tx_UserManual_EN-US_077-1702-04_077170204.docx")

doc = docx.Document(DOCX_FILE)

print("Checking fonts around command areas...\n")

# Look for paragraphs with "Set or query" or "TEKEXP:"
for i, para in enumerate(doc.paragraphs[620:680]):  # Around where commands start
    text = para.text.strip()
    if not text:
        continue
    
    # Get font info
    font_name = None
    is_bold_para = False
    if para.runs:
        font = para.runs[0].font
        if font and font.name:
            font_name = font.name
        is_bold_para = any(run.bold for run in para.runs)
    
    # Check style
    style_font = None
    if para.style and para.style.font and para.style.font.name:
        style_font = para.style.font.name
    
    # Check if it's a command or title
    is_cmd = 'TEKEXP:' in text.upper()
    is_title = text.lower().startswith('set or query') or text.lower().startswith('query')
    is_section = text.lower() in ['syntax', 'command arguments', 'arguments', 'returns', 'examples']
    
    if is_cmd or is_title or is_section or 'TEKEXP' in text:
        print(f"Para {i+620}:")
        print(f"  Text: {text[:80]}")
        print(f"  Font (run): {font_name}")
        print(f"  Font (style): {style_font}")
        print(f"  Bold: {is_bold_para}")
        print(f"  Style name: {para.style.name if para.style else 'None'}")
        print()


