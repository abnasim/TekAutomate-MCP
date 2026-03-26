"""Find pages containing STATus, SYSTem, UNIT, ABORt commands."""
import pdfplumber, re

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"
TARGETS = ['STATUS', 'SYSTEM', 'UNIT:POWER', 'ABORT']

with pdfplumber.open(PDF) as pdf:
    total = len(pdf.pages)
    print(f"Total pages: {total}")
    
    found = []
    # Only scan first 300 pages (programmer manual section)
    for page_idx in range(300):
        page = pdf.pages[page_idx]
        text = page.extract_text() or ''
        text_upper = text.upper()
        
        for target in TARGETS:
            if target in text_upper:
                found.append((page_idx+1, target, text[:200]))
                break
    
    # Show unique pages
    seen = set()
    for pg, target, text in found:
        if pg not in seen:
            seen.add(pg)
            print(f"\n=== Page {pg} (contains '{target}') ===")
            print(text[:300])
            
            # Show tables on this page
            page = pdf.pages[pg-1]
            tables = page.extract_tables()
            print(f"  Tables: {len(tables)}")
            for i, t in enumerate(tables):
                if t:
                    print(f"  Table {i}: {len(t)} rows x {len(t[0]) if t[0] else 0} cols")
                    print(f"  Header: {t[0]}")
                    for row in t[1:4]:
                        print(f"    {row}")
