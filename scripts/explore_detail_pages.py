"""Explore the detail command pages in the SignalVu PDF."""
import pdfplumber, re

PDF = r"C:\Users\u650455\Downloads\SignalVu-PC-Programmer-Manual_EN-US_077072122.pdf"

with pdfplumber.open(PDF) as pdf:
    # Look at pages 166-185 (right after the summary tables end)
    for page_idx in range(165, 195):
        page = pdf.pages[page_idx]
        text = page.extract_text() or ''
        tables = page.extract_tables()
        print(f"\n=== Page {page_idx+1} ===")
        print(text[:600])
        if tables:
            print(f"  Tables: {len(tables)}")
            for t in tables[:2]:
                if t:
                    print(f"    Table header: {t[0]}")
                    for row in t[1:3]:
                        print(f"      {row}")
