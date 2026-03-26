"""
tm_devices Documentation Scraper

This script downloads and parses tm_devices API documentation from ReadTheDocs
and converts it into a TypeScript docstring database for offline use.

Usage:
    python scripts/scrape_tm_devices_docs.py

Output:
    src/components/TmDevicesCommandBrowser/docstrings.ts
"""

import requests
import json
import re
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from pathlib import Path

BASE_URL = "https://tm-devices.readthedocs.io/stable/reference/tm_devices/commands/"

# List of all instrument models to scrape
MODELS = [
    'afg3k', 'afg3kb', 'afg3kc',
    'awg5k', 'awg5kc', 'awg7k', 'awg7kc', 'awg70ka', 'awg70kb', 'awg5200',
    'daq6510', 'dmm6500', 'dmm7510',
    'dpo2k', 'dpo2kb', 'dpo4k', 'dpo4kb', 'dpo5k', 'dpo5kb',
    'dpo7k', 'dpo7kc', 'dpo7ax', 'dpo70kc', 'dpo70kd', 'dpo70kdx', 'dpo70ksx',
    'dsa70kc', 'dsa70kd',
    'lpd6',
    'mdo3', 'mdo3k', 'mdo4k', 'mdo4kb', 'mdo4kc',
    'mso2', 'mso2k', 'mso2kb',
    'mso4', 'mso4b', 'mso4k', 'mso4kb',
    'mso5', 'mso5b', 'mso5k', 'mso5kb', 'mso5lp',
    'mso6', 'mso6b',
    'mso70kc', 'mso70kdx',
    'smu2450', 'smu2460', 'smu2461', 'smu2470',
    'smu2601b', 'smu2601b_pulse', 'smu2602b', 'smu2604b', 'smu2606b',
    'smu2611b', 'smu2612b', 'smu2614b',
    'smu2634b', 'smu2635b', 'smu2636b',
    'smu2651a', 'smu2657a',
    'ss3706a',
    'tekscopepc',
]

def scrape_model_docs(model: str) -> Dict[str, Dict]:
    """Scrape documentation for a single model"""
    url = f"{BASE_URL}{model}_commands/"
    print(f"Scraping {model}...")
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
    except Exception as e:
        print(f"  ⚠ Failed to fetch {model}: {e}")
        return {}
    
    soup = BeautifulSoup(response.text, 'html.parser')
    docstrings = {}
    
    # Pattern: look for "### `property_name`property`" in markdown
    # In HTML this becomes <h3> with text like "abort property"
    # The actual structure uses code blocks with backticks
    
    # Find all h3 tags (property headings)
    h3_tags = soup.find_all('h3')
    
    for h3 in h3_tags:
        h3_text = h3.get_text()
        
        # Check if this is a property heading (contains "property")
        if 'property' not in h3_text.lower():
            continue
        
        # Extract property name (first word before "property")
        # e.g., "abort property¶" -> "abort"
        property_name = h3_text.split()[0].strip().replace('`', '')
        
        if not property_name or property_name == 'property':
            continue
        
        # Find the content section (everything until the next h3)
        content_elements = []
        next_elem = h3.find_next_sibling()
        
        while next_elem and next_elem.name != 'h3' and next_elem.name not in ['h1', 'h2']:
            content_elements.append(next_elem)
            next_elem = next_elem.find_next_sibling()
        
        if not content_elements:
            continue
        
        # Parse the content
        description = ''
        usage = []
        scpi_syntax = None
        info = []
        sub_properties = []
        
        current_section = None
        
        for elem in content_elements:
            elem_text = elem.get_text(strip=True)
            
            # Identify sections
            if 'Description' in elem_text and len(elem_text) < 30:
                current_section = 'description'
                continue
            elif 'Usage' in elem_text and len(elem_text) < 30:
                current_section = 'usage'
                continue
            elif 'SCPI Syntax' in elem_text:
                current_section = 'scpi'
                continue
            elif 'Info' in elem_text and len(elem_text) < 30:
                current_section = 'info'
                continue
            elif 'Sub-properties' in elem_text:
                current_section = 'sub-properties'
                continue
            
            # Extract content based on current section
            if current_section == 'description' and elem.name == 'p':
                if not description and elem_text:
                    description = elem_text
            
            elif current_section == 'usage' and elem.name == 'ul':
                for li in elem.find_all('li', recursive=False):
                    usage_text = li.get_text(strip=True)
                    if usage_text:
                        usage.append(usage_text)
            
            elif current_section == 'scpi':
                if elem.name in ['pre', 'code']:
                    lines = elem_text.split('\n')
                    for line in lines:
                        line = line.strip().lstrip('-').strip().lstrip('`').rstrip('`')
                        if line and not line.startswith('##') and '?' not in line or line.endswith('?'):
                            scpi_syntax = line
                            break
                elif elem.name == 'ul':
                    for li in elem.find_all('li', recursive=False):
                        line = li.get_text(strip=True).lstrip('-').strip()
                        if line:
                            scpi_syntax = line
                            break
            
            elif current_section == 'info' and elem.name == 'ul':
                for li in elem.find_all('li', recursive=False):
                    info_text = li.get_text(strip=True)
                    if info_text:
                        info.append(info_text)
            
            elif current_section == 'sub-properties' and elem.name == 'ul':
                for li in elem.find_all('li', recursive=False):
                    subprop_text = li.get_text(strip=True)
                    if subprop_text:
                        sub_properties.append(subprop_text)
        
        # Store docstring if we have useful information
        if description or usage:
            docstrings[property_name] = {
                'path': property_name,
                'description': description,
                'usage': usage,
            }
            if scpi_syntax:
                docstrings[property_name]['scpiSyntax'] = scpi_syntax
            if sub_properties:
                docstrings[property_name]['subProperties'] = sub_properties
            if info:
                docstrings[property_name]['info'] = info
    
    print(f"  ✓ Found {len(docstrings)} commands")
    return docstrings


def generate_typescript(all_docs: Dict[str, Dict]) -> str:
    """Generate TypeScript file from scraped documentation"""
    
    ts_code = '''/* ===================== tm_devices Command Docstrings ===================== */
/* AUTO-GENERATED - DO NOT EDIT MANUALLY */
/* Generated from tm_devices documentation at ReadTheDocs */

export interface CommandDocstring {
  path: string;
  description: string;
  usage: string[];
  scpiSyntax?: string;
  parameters?: string[];
  subProperties?: string[];
  info?: string[];
}

export const docstrings: Record<string, Record<string, CommandDocstring>> = {
'''
    
    for model, commands in sorted(all_docs.items()):
        if not commands:
            continue
            
        model_upper = model.upper().replace('_', '')
        ts_code += f'\n  {model_upper}: {{\n'
        
        for path, doc in sorted(commands.items()):
            # Escape strings for TypeScript
            description = json.dumps(doc['description'])
            usage = json.dumps(doc['usage'])
            scpi = json.dumps(doc.get('scpiSyntax')) if doc.get('scpiSyntax') else 'undefined'
            sub_props = json.dumps(doc.get('subProperties', []))
            
            ts_code += f'    {json.dumps(path)}: {{\n'
            ts_code += f'      path: {json.dumps(path)},\n'
            ts_code += f'      description: {description},\n'
            ts_code += f'      usage: {usage},\n'
            if doc.get('scpiSyntax'):
                ts_code += f'      scpiSyntax: {scpi},\n'
            if doc.get('subProperties'):
                ts_code += f'      subProperties: {sub_props},\n'
            ts_code += '    },\n'
        
        ts_code += '  },\n'
    
    ts_code += '''};

/**
 * Get docstring for a specific command path
 */
export function getDocstring(model: string, path: string): CommandDocstring | null {
  const modelDocs = docstrings[model.toUpperCase()];
  if (!modelDocs) return null;
  return modelDocs[path] || null;
}

/**
 * Search for docstrings matching a partial path
 */
export function searchDocstrings(model: string, query: string): CommandDocstring[] {
  const modelDocs = docstrings[model.toUpperCase()];
  if (!modelDocs) return [];
  
  const results: CommandDocstring[] = [];
  const lowerQuery = query.toLowerCase();
  
  for (const [path, doc] of Object.entries(modelDocs)) {
    if (path.toLowerCase().includes(lowerQuery)) {
      results.push(doc);
    }
  }
  
  return results;
}
'''
    
    return ts_code


def main():
    """Main scraping function"""
    print("tm_devices Documentation Scraper")
    print("=" * 50)
    print(f"Scraping {len(MODELS)} instrument models...\n")
    
    all_docs = {}
    
    for model in MODELS:
        docs = scrape_model_docs(model)
        if docs:
            all_docs[model] = docs
    
    print(f"\n✓ Successfully scraped {len(all_docs)} models")
    print(f"Total commands: {sum(len(docs) for docs in all_docs.values())}")
    
    # Generate TypeScript file
    print("\nGenerating TypeScript file...")
    ts_code = generate_typescript(all_docs)
    
    # Write to file
    output_path = Path(__file__).parent.parent / 'src' / 'components' / 'docstrings.ts'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(ts_code, encoding='utf-8')
    
    print(f"✓ Written to: {output_path}")
    print("\n🎉 Done! You can now use rich docstrings in the tm_devices browser.")


if __name__ == '__main__':
    main()
