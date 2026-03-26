"""
tm_devices Documentation Extractor

This script extracts docstrings directly from the installed tm_devices package.
Much cleaner than web scraping!

Usage:
    pip install tm_devices
    python scripts/extract_tm_devices_docs.py

Output:
    src/components/docstrings.ts
"""

import importlib
import inspect
import json
from pathlib import Path
from typing import Dict, Any
import re


def normalize_prose(text: str) -> str:
    """Normalize prose from generated tm_devices docstrings.

    tm_devices generated docs occasionally collapse spaces at wrapped boundaries
    (e.g. "theMean", "record.This", "SeriesMSO"). This pass repairs common
    human-readable cases while avoiding changes to SCPI tokens.
    """
    if not text:
        return ""

    out = text.replace("\t", " ")
    out = re.sub(r"\s+", " ", out).strip()

    # sentence joins: "record.This" -> "record. This"
    out = re.sub(r"(?<=[a-z0-9])\.(?=[A-Z])", ". ", out)

    # prose joins: "theMean" -> "the Mean"
    out = re.sub(r"([a-z])([A-Z][a-z])", r"\1 \2", out)

    # acronym joins: "SeriesMSO" -> "Series MSO"
    out = re.sub(r"([a-z])([A-Z]{2,})", r"\1 \2", out)

    # known common collapsed phrases from generated docs
    known_fixes = {
        "intoadjacent": "into adjacent",
        "ofadjacent": "of adjacent",
        "cyclein": "cycle in",
        "powerratio": "power ratio",
        "pointvalue": "point value",
        "theMean": "the Mean",
        "record.This": "record. This",
        "SeriesMSO": "Series MSO",
    }
    for bad, good in known_fixes.items():
        out = out.replace(bad, good)

    return out


def clean_docstring(docstring: str) -> Dict[str, Any]:
    """Parse a docstring into structured sections"""
    if not docstring:
        return {}
    
    # Normalize indentation while preserving wrapped continuation lines
    lines = inspect.cleandoc(docstring).split('\n')
    
    result = {
        'description': '',
        'usage': [],
        'scpiSyntax': None,
        'parameters': [],
        'info': [],
        'subProperties': [],
    }
    
    current_section = 'description'
    description_lines = []
    
    for raw_line in lines:
        line = raw_line.strip()
        
        # Identify sections
        if line.lower().startswith('usage'):
            current_section = 'usage'
            continue
        elif 'scpi syntax' in line.lower():
            current_section = 'scpi'
            continue
        elif line.lower().startswith('info'):
            current_section = 'info'
            continue
        elif 'parameter' in line.lower() and not 'sub-properties' in line.lower():
            current_section = 'parameters'
            continue
        elif 'sub-properties' in line.lower() or 'properties' in line.lower():
            current_section = 'subproperties'
            continue
        
        # Skip empty lines
        if not line:
            continue

        # Skip markdown fence markers
        if line == '```':
            continue
        
        # Add content to appropriate section
        if current_section == 'description':
            description_lines.append(line)
        elif current_section == 'usage':
            if line.startswith('*') or line.startswith('-'):
                result['usage'].append(line.lstrip('*- '))
            elif result['usage']:
                # Wrapped list continuation (common in tm_devices docs)
                result['usage'][-1] += f' {line}'
            elif 'Using' in line:
                result['usage'].append(line)
        elif current_section == 'scpi':
            if line.startswith('-') or line.startswith('*'):
                if not result['scpiSyntax']:
                    result['scpiSyntax'] = line.lstrip('-* ')
            elif not result['scpiSyntax'] and line and line.lower() not in ('scpi syntax:', 'scpi syntax'):
                # Some docstrings include bare syntax lines in code fences
                result['scpiSyntax'] = line
        elif current_section == 'parameters':
            if line.startswith('*') or line.startswith('-'):
                result['parameters'].append(line.lstrip('*- '))
            elif result['parameters']:
                result['parameters'][-1] += f' {line}'
        elif current_section == 'info':
            if line.startswith('*') or line.startswith('-'):
                result['info'].append(line.lstrip('*- '))
            elif result['info']:
                result['info'][-1] += f' {line}'
        elif current_section == 'subproperties':
            if line.startswith('.') or line.startswith('*'):
                result['subProperties'].append(line.lstrip('* '))
            elif result['subProperties']:
                result['subProperties'][-1] += f' {line}'
    
    result['description'] = normalize_prose(' '.join(description_lines))
    result['usage'] = [normalize_prose(x) for x in result['usage']]
    result['parameters'] = [normalize_prose(x) for x in result['parameters']]
    result['info'] = [normalize_prose(x) for x in result['info']]
    result['subProperties'] = [normalize_prose(x) for x in result['subProperties']]
    
    # Clean up empty fields
    return {k: v for k, v in result.items() if v}


def extract_command_properties(command_class, prefix='', max_depth=3, current_depth=0, visited=None) -> Dict[str, Dict]:
    """
    Recursively extract all property docstrings from a command class
    
    Args:
        command_class: The class to extract from
        prefix: Current path prefix (e.g., 'display' or 'display.colors')
        max_depth: Maximum recursion depth
        current_depth: Current recursion depth
        visited: Set of already visited classes (to prevent infinite loops)
    """
    if visited is None:
        visited = set()
    
    # Prevent infinite recursion
    if current_depth >= max_depth:
        return {}
    
    # Avoid revisiting the same class
    class_id = id(command_class)
    if class_id in visited:
        return {}
    visited.add(class_id)
    
    docstrings = {}
    
    # Get all properties
    for name, obj in inspect.getmembers(command_class):
        # Skip private and special methods
        if name.startswith('_'):
            continue
        
        # Check if it's a property
        if isinstance(inspect.getattr_static(command_class, name, None), property):
            # Build the full path
            full_path = f"{prefix}.{name}" if prefix else name
            
            # Get the property object
            prop_obj = getattr(command_class, name)
            if prop_obj and prop_obj.fget and prop_obj.fget.__doc__:
                parsed = clean_docstring(prop_obj.fget.__doc__)
                if parsed:
                    docstrings[full_path] = {
                        'path': full_path,
                        **parsed
                    }
            
            # Try to get the return type and recurse into it
            try:
                # Get the return type annotation if available
                if prop_obj and prop_obj.fget:
                    return_annotation = prop_obj.fget.__annotations__.get('return')
                    if return_annotation and inspect.isclass(return_annotation):
                        # Recursively extract nested properties
                        nested_docs = extract_command_properties(
                            return_annotation, 
                            prefix=full_path,
                            max_depth=max_depth,
                            current_depth=current_depth + 1,
                            visited=visited
                        )
                        docstrings.update(nested_docs)
            except Exception:
                # If we can't get the return type, just continue
                pass
    
    return docstrings


def extract_model_docs(model_name: str) -> Dict[str, Dict]:
    """Extract documentation for a specific model"""
    print(f"Extracting {model_name}...")
    
    try:
        # Import the commands module
        module_name = f"tm_devices.commands.{model_name}_commands"
        module = importlib.import_module(module_name)
        
        # Find the Commands class (e.g., AFG3KCommands, MSO2Commands)
        model_upper = model_name.upper().replace('_', '')
        commands_class_name = f"{model_upper}Commands"
        
        if not hasattr(module, commands_class_name):
            print(f"  ! Could not find {commands_class_name}")
            return {}
        
        commands_class = getattr(module, commands_class_name)
        
        # Extract all properties
        docstrings = extract_command_properties(commands_class)
        
        print(f"  OK Found {len(docstrings)} commands")
        return docstrings
        
    except ImportError as e:
        print(f"  ! Could not import module: {e}")
        return {}
    except Exception as e:
        print(f"  ! Error: {e}")
        return {}


def generate_typescript(_all_docs: Dict[str, Dict]) -> str:
    """Generate lightweight TypeScript loader (doc data lives in JSON)"""
    return '''/* ===================== tm_devices Command Docstrings ===================== */
/* AUTO-GENERATED - DO NOT EDIT MANUALLY */
/* Generated from tm_devices Python package docstrings */

import { publicAssetUrl } from '../utils/publicUrl';

export interface CommandDocstring {
  path: string;
  description: string;
  usage: string[];
  scpiSyntax?: string;
  parameters?: string[];
  subProperties?: string[];
  info?: string[];
}

type ModelDocs = Record<string, Record<string, CommandDocstring>>;

let docstringsCache: ModelDocs | null = null;
let loadPromise: Promise<ModelDocs> | null = null;

function normalizeModelKey(model: string): string {
  return (model || '').toUpperCase().replace(/_/g, '');
}

export function areDocstringsLoaded(): boolean {
  return !!docstringsCache;
}

export async function ensureDocstringsLoaded(): Promise<ModelDocs> {
  if (docstringsCache) return docstringsCache;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const res = await fetch(publicAssetUrl('commands/tm_devices_docstrings.json'));
    if (!res.ok) {
      throw new Error(`Failed to load tm_devices docstrings: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    docstringsCache = data as ModelDocs;
    return docstringsCache;
  })();

  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function getDocstring(model: string, path: string): CommandDocstring | null {
  if (!docstringsCache) return null;
  const modelDocs = docstringsCache[normalizeModelKey(model)];
  if (!modelDocs) return null;
  return modelDocs[path] || null;
}

export function searchDocstrings(model: string, query: string): CommandDocstring[] {
  if (!docstringsCache) return [];
  const modelDocs = docstringsCache[normalizeModelKey(model)];
  if (!modelDocs) return [];

  const lowerQuery = (query || '').toLowerCase();
  return Object.entries(modelDocs)
    .filter(([path]) => path.toLowerCase().includes(lowerQuery))
    .map(([, doc]) => doc);
}

export function getDocstringModels(): ModelDocs | null {
  return docstringsCache;
}
'''


# List of all instrument models
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


def main():
    """Main extraction function"""
    print("tm_devices Documentation Extractor")
    print("=" * 50)
    print("Extracting from installed tm_devices package...")
    print()
    
    # Check if tm_devices is installed
    try:
        import tm_devices
        print(f"OK Found tm_devices version: {tm_devices.__version__}")
        print()
    except ImportError:
        print("ERROR tm_devices not installed!")
        print("   Please run: pip install tm_devices")
        return
    
    all_docs = {}
    
    for model in MODELS:
        docs = extract_model_docs(model)
        if docs:
            all_docs[model] = docs
    
    print(f"\nOK Successfully extracted {len(all_docs)} models")
    print(f"Total commands: {sum(len(docs) for docs in all_docs.values())}")
    
    # Normalize docs by model key (matches runtime lookup convention)
    json_docs = {
        model.upper().replace('_', ''): docs
        for model, docs in all_docs.items()
        if docs
    }

    # Generate TypeScript loader file
    print("\nGenerating TypeScript loader...")
    ts_code = generate_typescript(all_docs)
    
    # Write TypeScript loader
    output_path = Path(__file__).parent.parent / 'src' / 'components' / 'docstrings.ts'
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(ts_code, encoding='utf-8')

    # Write JSON data payload for lazy loading
    json_output_path = Path(__file__).parent.parent / 'public' / 'commands' / 'tm_devices_docstrings.json'
    json_output_path.parent.mkdir(parents=True, exist_ok=True)
    json_output_path.write_text(json.dumps(json_docs, ensure_ascii=False, indent=2), encoding='utf-8')
    
    print(f"OK Written to: {output_path}")
    print(f"OK Written to: {json_output_path}")
    print("\nDONE! You now have rich docstrings from the actual Python package!")


if __name__ == '__main__':
    main()
