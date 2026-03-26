/* ===================== Browse Commands Modal (Shared Component) ===================== */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Copy } from 'lucide-react';
import { CommandDetailModal } from './CommandDetailModal';
import { TriggerAnimation } from './TriggerMascot';
import { parseSCPI } from '../utils/scpiParser';
import { detectEditableParameters } from '../utils/scpiParameterDetector';
import { SCPIParameterSelector } from './SCPIParameterSelector';
import { SCPICommandTreeBuilder } from './SCPICommandTreeBuilder';
import { materializeCommandTemplate } from '../utils/commandMaterializer';

function normalizeScpiHeaderForMatch(input: string): string {
  return (input || '')
    .trim()
    .toUpperCase()
    .replace(/\?$/, '')
    .split(/\s+/)[0]
    .replace(/<[^>]+>/g, '') // Strip template placeholders
    .replace(/\d+/g, '');    // Treat CH1/CH2 and MATH1/MATH2 as same command family
}

// Fix mixed syntax strings and construct proper SET syntax with arguments
const fixSyntaxDisplay = (
  syntax: { set?: string; query?: string } | undefined,
  params?: Array<{ name: string; type?: string; options?: string[] }>
): { set: string | null; query: string | null } => {
  if (!syntax) return { set: null, query: null };
  
  let setSyntax = syntax.set?.trim() || null;
  let querySyntax = syntax.query?.trim() || null;
  
  // Fix case where query contains both SET and QUERY syntax
  if (querySyntax && querySyntax.includes('{') && querySyntax.includes('?')) {
    const queryMatch = querySyntax.match(/^(.+?\})\s+(\S+\?)$/);
    if (queryMatch) {
      if (!setSyntax) {
        setSyntax = queryMatch[1].trim();
      }
      querySyntax = queryMatch[2].trim();
    }
  }
  
  // Fix case where set syntax wrongly ends with ?
  if (setSyntax && setSyntax.endsWith('?')) {
    if (!querySyntax) {
      querySyntax = setSyntax;
    }
    setSyntax = null;
  }
  
  // Ensure query ends with ?
  if (querySyntax && !querySyntax.endsWith('?')) {
    querySyntax = null;
  }
  
  return { set: setSyntax, query: querySyntax };
};

export interface CommandLibraryItem {
  name: string;
  scpi: string;
  description: string;
  category: string;
  subcategory?: string;
  params?: any[];
  example?: string;
  tekhsi?: boolean;
  sourceFile?: string;
  [key: string]: any;
}

interface SearchScoreRow {
  cmd: CommandLibraryItem;
  score: number;
  matchedBy: string[];
}

function buildCommandSearchBlob(cmd: CommandLibraryItem): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'string') {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(push);
      return;
    }
    if (typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(push);
    }
  };

  push(cmd.name);
  push(cmd.scpi);
  push(cmd.description);
  push(cmd.category);
  push(cmd.subcategory);
  push(cmd.example);
  push(cmd.params?.map((p) => `${p.name || ''} ${p.description || ''} ${(p.options || []).join(' ')}`));
  push(cmd.manualEntry?.shortDescription);
  push(cmd.manualEntry?.commandGroup);
  push(cmd.manualEntry?.mnemonics);
  push(cmd.manualEntry?.syntax);
  push(cmd.manualEntry?.arguments);
  push(cmd.manualEntry?.examples);
  return out
    .map((x) => String(x).toLowerCase())
    .filter((x) => x && x !== '[object object]');
}

function normalizeIndexedQueryToTemplate(value: string): string {
  return String(value || '')
    .replace(/\bCH\d+\b/gi, 'CH<x>')
    .replace(/\bMEAS\d+\b/gi, 'MEAS<x>')
    .replace(/\bREF\d+\b/gi, 'REF<x>')
    .replace(/\bMATH\d+\b/gi, 'MATH<x>')
    .replace(/\bBUS\d+\b/gi, 'BUS<x>')
    .replace(/\bCURSOR\d+\b/gi, 'CURSOR<x>')
    .replace(/\bPLOT\d+\b/gi, 'PLOT<x>')
    .replace(/\bSEARCH\d+\b/gi, 'SEARCH<x>')
    .replace(/\bDIGGRP\d+\b/gi, 'DIGGRP<x>')
    .replace(/\bSOUrce\d+\b/gi, 'SOUrce<x>');
}

export interface BrowseCommandsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (command: CommandLibraryItem) => void;
  commands: CommandLibraryItem[];
  categoryColors: Record<string, string>;
  triggerAnimation?: (anim: TriggerAnimation) => void;
  selectedDeviceFamily?: string;
  setSelectedDeviceFamily?: (family: string) => void;
  deviceFamilies?: Array<{ id: string; label: string; icon: string; description: string; tooltip?: string }>;
  buttonText?: string; // Customizable button text (e.g., "Add", "Add to Block")
  title?: string; // Customizable title (e.g., "Browse Commands", "Select SCPI Command")
  initialCommand?: string; // Initial command to navigate to when opening
}

export const BrowseCommandsModal: React.FC<BrowseCommandsModalProps> = ({ 
  isOpen, 
  onClose, 
  onSelect, 
  commands, 
  categoryColors,
  triggerAnimation,
  selectedDeviceFamily,
  setSelectedDeviceFamily,
  deviceFamilies = [],
  buttonText = 'Add',
  title = 'Browse Commands',
  initialCommand
}) => {
  const [search, setSearch] = useState<string>('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedCommand, setSelectedCommand] = useState<CommandLibraryItem | null>(null);
  const [editedCommand, setEditedCommand] = useState<string>('');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const commandGridRef = useRef<HTMLDivElement>(null);
  
  // Update edited command when selected command changes
  useEffect(() => {
    if (selectedCommand) {
      // Use syntax from manualEntry if available (includes argument placeholders like {GRATICULE|BADGE})
      let initialCommand = selectedCommand.scpi;
      
      // Check if manualEntry has better syntax with arguments
      if (selectedCommand.manualEntry?.syntax) {
        const syntax = selectedCommand.manualEntry.syntax;
        if (typeof syntax === 'object' && syntax.set) {
          initialCommand = syntax.set;
        } else if (typeof syntax === 'object' && syntax.query) {
          initialCommand = syntax.query.replace(/\?$/, ''); // Remove ? for editing
        } else if (typeof syntax === 'string') {
          initialCommand = syntax;
        }
      }
      
      // Remove query mark if it's a SET command (not a query)
      const isQueryCommand = initialCommand.trim().endsWith('?');
      const isSetCommand = selectedCommand.manualEntry?.commandType === 'set' || 
                           selectedCommand.manualEntry?.commandType === 'both';
      
      // If it's a set command but ends with ?, remove the ?
      if (isSetCommand && isQueryCommand && selectedCommand.manualEntry?.commandType !== 'query') {
        initialCommand = initialCommand.trim().slice(0, -1);
      }
      
      // Materialize template placeholders to concrete values so Blockly gets editable, real commands.
      initialCommand = materializeCommandTemplate(initialCommand, selectedCommand.params || []);
      
      setEditedCommand(initialCommand);
    }
  }, [selectedCommand]);
  
  // Get categories with command counts (must be before early return)
  const categories = useMemo(() => {
    const catMap = new Map<string, number>();
    commands.forEach(cmd => {
      catMap.set(cmd.category, (catMap.get(cmd.category) || 0) + 1);
    });
    return Array.from(catMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [commands]);

  // Filter commands (must be before early return)
  const searchResults = useMemo<SearchScoreRow[]>(() => {
    const q = search.toLowerCase().trim();
    
    // Split search into keywords and normalize (remove spaces for fuzzy matching)
    const stopWords = new Set(['and', 'or', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'on', 'in', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'that', 'this', 'it']);
    const searchKeywords = q.split(/\s+/).filter(kw => kw && !stopWords.has(kw));
    const normalizedQuery = q.replace(/[\s:]/g, ''); // Remove spaces/colons from full query
    
    // For parameterized matching - replace numbers with pattern to match <x>
    const parameterizedQuery = normalizedQuery.replace(/(\d+)/g, '(?:\\d+|<[xn]>)');
    const parameterizedRegex = new RegExp(parameterizedQuery, 'i');
    
    const scored = commands.map((cmd) => {
      // Category filtering (always applied)
      const matchesCat = selectedCat === null || cmd.category === selectedCat;
      if (!matchesCat) return { cmd, score: -1, matchedBy: [] as string[] };
      
      // If no search query, just filter by category
      if (!q) return { cmd, score: 1, matchedBy: ['category'] as string[] };
      
      // Search across all relevant fields
      const searchableFields = buildCommandSearchBlob(cmd);
      
      // Create a combined searchable text (with and without spaces for fuzzy matching)
      const combinedText = searchableFields.join(' ');
      const normalizedText = combinedText.replace(/[\s:]/g, ''); // Remove spaces and colons for fuzzy matching
      
      // Strategy 1: Try full query as one fuzzy string (e.g., "search option" matches "searchoption")
      const matchesFullQueryFuzzy = normalizedText.includes(normalizedQuery);
      
      // Strategy 2: Parameterized match - "MEAS1:FTYPe" should match "MEAS<x>:FTYPe"
      const matchesParameterized = parameterizedRegex.test(normalizedText);
      
      // Strategy 3: Match if ALL keywords are found individually (e.g., "search" AND "option" both present)
      const matchesAllKeywords = searchKeywords.length > 0 && searchKeywords.every(keyword => {
        const normalizedKeyword = keyword.replace(/[\s:]/g, '');
        // Also try replacing numbers with <x> pattern
        const keywordWithParam = normalizedKeyword.replace(/(\d+)/g, '(?:\\d+|<[xn]>)');
        const keywordRegex = new RegExp(keywordWithParam, 'i');
        return combinedText.includes(keyword) || normalizedText.includes(normalizedKeyword) || keywordRegex.test(normalizedText);
      });
      
      // Match if ANY strategy succeeds
      const matchesSearch = matchesFullQueryFuzzy || matchesParameterized || matchesAllKeywords;
      if (!matchesSearch) return { cmd, score: -1, matchedBy: [] as string[] };

      let score = 0;
      const matchedBy: string[] = [];
      const scpi = (cmd.scpi || '').toLowerCase();
      const name = (cmd.name || '').toLowerCase();
      const desc = (cmd.description || '').toLowerCase();
      if (scpi.includes(q)) {
        score += 25;
        matchedBy.push('header');
      }
      if (name.includes(q)) {
        score += 20;
        matchedBy.push('name');
      }
      if (desc.includes(q)) {
        score += 8;
        matchedBy.push('description');
      }
      if (normalizedText.includes(normalizedQuery)) {
        score += 12;
        matchedBy.push('fuzzy');
      }
      if (
        cmd.params?.some((p) =>
          `${p.name || ''} ${p.description || ''} ${(p.options || []).join(' ')}`.toLowerCase().includes(q)
        ) ||
        String(cmd.manualEntry?.arguments || '').toLowerCase().includes(q)
      ) {
        matchedBy.push('args');
      }
      score += Math.max(0, 5 - scpi.indexOf(q)); // earlier matches are better
      return { cmd, score, matchedBy: Array.from(new Set(matchedBy)) };
    });

    return scored
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.cmd.scpi.localeCompare(b.cmd.scpi))
      .slice(0, 2000);
  }, [commands, search, selectedCat]);

  const filtered = useMemo(
    () => searchResults.map((x) => x.cmd),
    [searchResults]
  );

  // Infinite scroll (must be before early return)
  const visibleCommands = useMemo(() => 
    filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMore = visibleCount < filtered.length;

  // Reset visible count when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [search, selectedCat]);

  // Infinite scroll observer for CommandBrowser
  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount(prev => Math.min(prev + 50, filtered.length));
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, filtered.length]);
  
  // Trigger search animation when browser opens
  useEffect(() => {
    if (isOpen && triggerAnimation) {
      triggerAnimation('search');
    }
  }, [isOpen, triggerAnimation]);
  
  // Navigate to initial command when modal opens
  useEffect(() => {
    if (isOpen && initialCommand && commands.length > 0) {
      // Find the command that matches the initial command.
      // This supports concrete block commands (e.g. MATH2, CH3) against template
      // headers in the library (e.g. MATH<x>, CH<x>).
      const normalizedInitial = initialCommand.trim().toUpperCase().replace(/\?$/, '');
      const initialHeader = normalizedInitial.split(/\s+/)[0];
      const initialHeaderNormalized = normalizeScpiHeaderForMatch(initialHeader);

      // Strategy 1: exact full command match.
      let matchedCommand = commands.find(cmd =>
        cmd.scpi.trim().toUpperCase().replace(/\?$/, '') === normalizedInitial
      );

      // Strategy 2: exact header match.
      if (!matchedCommand) {
        matchedCommand = commands.find(cmd => {
          const cmdHeader = cmd.scpi.trim().toUpperCase().replace(/\?$/, '').split(/\s+/)[0];
          return cmdHeader === initialHeader;
        });
      }

      // Strategy 3: normalized header match (handles <x> vs concrete indices).
      if (!matchedCommand) {
        matchedCommand = commands.find(cmd => {
          const cmdHeader = cmd.scpi.trim().toUpperCase().replace(/\?$/, '').split(/\s+/)[0];
          return normalizeScpiHeaderForMatch(cmdHeader) === initialHeaderNormalized;
        });
      }
      
      // Strategy 4: prefix fallback
      if (!matchedCommand) {
        matchedCommand = commands.find(cmd => {
          const cmdHeader = cmd.scpi.trim().toUpperCase().replace(/\?$/, '').split(/\s+/)[0];
          return normalizedInitial.startsWith(cmdHeader) || initialHeaderNormalized.startsWith(normalizeScpiHeaderForMatch(cmdHeader));
        });
      }
      
      if (matchedCommand) {
        // Set the selected command
        setSelectedCommand(matchedCommand);
        
        // Set the category to filter
        if (matchedCommand.category) {
          setSelectedCat(matchedCommand.category);
        }
        
        // Also set search to help user find the command
        setSearch(matchedCommand.scpi.split(/\s+/)[0] || initialHeader);
        
        // Scroll to the command after a short delay to allow rendering
        const scrollToCommand = matchedCommand; // Capture for closure
        setTimeout(() => {
          if (commandGridRef.current && scrollToCommand) {
            // Find the command element in the grid
            const commandElements = commandGridRef.current.querySelectorAll('[data-command-scpi]');
            for (const el of Array.from(commandElements)) {
              if ((el as HTMLElement).dataset.commandScpi === scrollToCommand.scpi) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                break;
              }
            }
          }
        }, 300);
      }
    }
  }, [isOpen, initialCommand, commands]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);
  
  // Debounced search handler
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    setVisibleCount(50); // Reset visible count on search
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    searchTimeoutRef.current = setTimeout(() => {
      if (triggerAnimation && value.length > 0) {
        triggerAnimation('search');
      }
    }, 300);
  };
  
  if (!isOpen) return null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleCommandClick = (cmd: CommandLibraryItem, e: React.MouseEvent) => {
    // Check if info icon was clicked
    const target = e.target as HTMLElement;
    if (target.closest('.info-icon') || target.closest('button[data-action="info"]')) {
      e.stopPropagation();
      setSelectedCommand(cmd);
      setShowDetailModal(true);
      return;
    }
    
    // Otherwise, add to flow
    onSelect(cmd);
    setTimeout(() => onClose(), 10);
    if (triggerAnimation) {
      triggerAnimation('success');
    }
  };

  const handleAddFromDetail = (cmd: CommandLibraryItem) => {
    onSelect(cmd);
    setShowDetailModal(false);
    setTimeout(() => onClose(), 10);
    if (triggerAnimation) {
      triggerAnimation('success');
    }
  };

  // Handle close without triggering Blockly focus issues
  const handleClose = () => {
    // Small delay to prevent Blockly focus manager conflicts
    setTimeout(() => {
      onClose();
    }, 10);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
        <div
          className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-[95vw] h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-white dark:bg-gray-900">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
            <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition text-gray-600 dark:text-gray-300">
              <X size={18} />
            </button>
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky top-0 z-[101]">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search by name, SCPI command, or description..."
                  title="Tip: try headers like CH, REF, MATH, BUS (for example: CH SCALE, REF STATE, MATH FFT)."
                  value={search}
                  onChange={handleSearchChange}
                  className="w-full pl-10 pr-10 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
                {search && (
                  <button
                    onClick={() => handleSearchChange({ target: { value: '' } } as any)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                    title="Clear search"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {deviceFamilies.length > 0 && selectedDeviceFamily && setSelectedDeviceFamily && (
                <div className="relative" title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}>
                  <select
                    value={selectedDeviceFamily}
                    onChange={(e) => setSelectedDeviceFamily(e.target.value)}
                    className="appearance-none text-xs pl-4 pr-8 py-2.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-gray-900 dark:text-gray-100 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    title={deviceFamilies.find(f => f.id === selectedDeviceFamily)?.tooltip || ''}
                  >
                    {deviceFamilies.map(family => (
                      <option key={family.id} value={family.id} title={family.tooltip || ''}>
                        {family.icon} {family.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none" />
                </div>
              )}
            </div>
            
            {/* Parameter Selector - appears when typing CH, MEAS, etc. */}
            <SCPICommandTreeBuilder
              commands={selectedCat ? commands.filter(cmd => cmd.category === selectedCat) : commands}
              searchQuery={search}
              onSelectParameter={(resolved, index) => {
                setSearch(normalizeIndexedQueryToTemplate(resolved));
                setVisibleCount(50);
              }}
            />
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tip: type `CH`, `REF`, `MATH`, `BUS` to open the index helper and quickly pick channel/reference numbers.
            </div>
            {search.trim().length > 0 && (
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Search debug: {searchResults[0]
                  ? `top match by ${searchResults[0].matchedBy.join(' | ') || 'text'}`
                  : 'no matches'}
              </div>
            )}
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Category Sidebar */}
            <div className="w-48 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 overflow-y-auto flex-shrink-0">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Categories</h3>
                <button
                  onClick={() => setSelectedCat(null)}
                  className={`w-full text-left px-3 py-2 text-sm rounded transition ${
                    selectedCat === null
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  All ({commands.length})
                </button>
              </div>
              <div className="p-2 space-y-1">
                {categories.map(({ name, count }) => (
                  <button
                    key={name}
                    onClick={() => setSelectedCat(name)}
                  className={`w-full text-left px-3 py-2 text-sm rounded transition flex items-center justify-between ${
                    selectedCat === name
                      ? `${categoryColors[name] || 'bg-blue-100 text-blue-700'} dark:bg-blue-900/30 dark:text-blue-200 dark:border dark:border-blue-700/60 font-medium`
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                    <span className="truncate">{name}</span>
                    <span className={`text-xs ml-2 ${
                      selectedCat === name ? 'text-blue-600 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'
                    }`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Command List */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {filtered.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
                  <div className="text-center">
                    <Search size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                    <p className="text-lg font-medium">No commands found</p>
                    <p className="text-sm mt-2">Try adjusting your search or category filter</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                    {filtered.length} commands
                  </div>
                  <div className="flex-1 overflow-y-auto p-3" ref={commandGridRef}>
                    <div className={`grid gap-2 ${
                      selectedCommand 
                        ? 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2' 
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                    }`}>
                      {visibleCommands.map((cmd, idx) => (
                        <div
                          key={`${cmd.scpi}-${idx}`}
                          data-command-scpi={cmd.scpi}
                          className={`p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition cursor-pointer ${
                            selectedCommand?.scpi === cmd.scpi ? 'border-blue-500 ring-1 ring-blue-200 dark:ring-blue-900/60' : ''
                          }`}
                          onClick={() => setSelectedCommand(cmd)}
                        >
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{cmd.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${categoryColors[cmd.category] || 'bg-gray-100 text-gray-700'} dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600`}>
                              {cmd.category}
                            </span>
                          </div>
                          <div className="text-xs font-mono text-blue-600 dark:text-blue-200 bg-blue-50/70 dark:bg-gray-700 px-1.5 py-0.5 rounded truncate">
                            {cmd.scpi}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Infinite scroll sentinel */}
                    <div ref={scrollSentinelRef} className="py-2 text-center">
                      <div className="text-xs text-gray-400 dark:text-gray-500">
                        {hasMore ? (
                          <span>Loading... ({visibleCommands.length} of {filtered.length})</span>
                        ) : (
                          <span>All {filtered.length} shown</span>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Inline Detail Panel */}
            {selectedCommand && (() => {
              // Parse command to detect editable parameters
              const parsed = editedCommand ? parseSCPI(editedCommand) : null;
              const editableParameters = parsed ? detectEditableParameters(parsed) : [];
              
              return (
                <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto flex-shrink-0">
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-900">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">{selectedCommand.name}</h3>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${categoryColors[selectedCommand.category] || 'bg-gray-100 text-gray-700'} dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600`}>
                            {selectedCommand.category}
                          </span>
                          {selectedCommand.subcategory && (
                            <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                              {selectedCommand.subcategory}
                            </span>
                          )}
                          {selectedCommand.manualEntry?.commandType && (
                            <>
                              {(selectedCommand.manualEntry.commandType === 'set' || selectedCommand.manualEntry.commandType === 'both') && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 font-medium">Set</span>
                              )}
                              {(selectedCommand.manualEntry.commandType === 'query' || selectedCommand.manualEntry.commandType === 'both' || selectedCommand.scpi.trim().endsWith('?')) && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">Query</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedCommand(null)}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <X size={16} className="text-gray-400 dark:text-gray-500" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-4 space-y-4">
                    
                    {/* Command Syntax */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Command</h4>
                      <div className="font-mono text-sm text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded border border-blue-200 dark:border-blue-800 break-all">
                        {editedCommand}
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(editedCommand)}
                        className="mt-2 text-xs text-blue-600 dark:text-blue-300 hover:underline flex items-center gap-1"
                      >
                        <Copy size={12} /> Copy command
                      </button>
                    </div>
                    
                    {/* Parameter Editor - Always visible if parameters exist */}
                    {editableParameters.length > 0 && (
                      <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-3">
                        <SCPIParameterSelector
                          command={editedCommand}
                          editableParameters={editableParameters}
                          parsed={parsed || undefined}
                          commandParams={selectedCommand.params}
                          onCommandChange={setEditedCommand}
                          title="Parameters"
                          compact={true}
                        />
                      </div>
                    )}
                  
                  {/* Description */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Description</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                      {selectedCommand.description || 'No description available.'}
                    </p>
                  </div>
                  
                  {/* Syntax Details */}
                  {selectedCommand.manualEntry?.syntax && (() => {
                    const fixedSyntax = fixSyntaxDisplay(selectedCommand.manualEntry.syntax, selectedCommand.params);
                    return (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Syntax</h4>
                        <div className="space-y-2">
                          {fixedSyntax.set && (
                            <div>
                              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Set Command:</span>
                              <div className="font-mono text-xs bg-gray-900 text-green-400 px-2 py-1.5 rounded mt-1 break-all">
                                {fixedSyntax.set}
                              </div>
                            </div>
                          )}
                          {fixedSyntax.query && (
                            <div>
                              <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Query Command:</span>
                              <div className="font-mono text-xs bg-gray-900 text-blue-400 px-2 py-1.5 rounded mt-1 break-all">
                                {fixedSyntax.query}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Arguments */}
                  {selectedCommand.manualEntry?.arguments && Array.isArray(selectedCommand.manualEntry.arguments) && selectedCommand.manualEntry.arguments.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Arguments</h4>
                      <div className="space-y-2">
                        {selectedCommand.manualEntry.arguments.map((arg: any, idx: number) => (
                          <div key={idx} className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs font-semibold text-purple-700">{arg.name}</span>
                              {arg.type && (
                                <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">{arg.type}</span>
                              )}
                            </div>
                            {arg.description && (
                              <p className="text-xs text-gray-600 dark:text-gray-400">{arg.description}</p>
                            )}
                            {arg.validValues?.values && Array.isArray(arg.validValues.values) && arg.validValues.values.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {arg.validValues.values.slice(0, 6).map((val: string, vIdx: number) => (
                                  <span key={vIdx} className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 rounded border border-blue-200 dark:border-blue-700/60">
                                    {val}
                                  </span>
                                ))}
                                {arg.validValues.values.length > 6 && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">+{arg.validValues.values.length - 6} more</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Query Response */}
                  {selectedCommand.manualEntry?.queryResponse && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Query Response</h4>
                      <div className="space-y-1">
                        {selectedCommand.manualEntry.queryResponse.type && (
                          <div className="text-xs text-gray-600 dark:text-gray-300"><span className="font-medium text-gray-700 dark:text-gray-200">Type:</span> {selectedCommand.manualEntry.queryResponse.type}</div>
                        )}
                        {selectedCommand.manualEntry.queryResponse.format && (
                          <div className="text-xs text-gray-600 dark:text-gray-300"><span className="font-medium text-gray-700 dark:text-gray-200">Format:</span> {selectedCommand.manualEntry.queryResponse.format}</div>
                        )}
                        {selectedCommand.manualEntry.queryResponse.example && (
                          <div className="font-mono text-xs bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-1 rounded mt-1">{selectedCommand.manualEntry.queryResponse.example}</div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Examples — handles both nested {codeExamples.scpi.code} and flat {scpi} formats */}
                  {(() => {
                    const meExamples = selectedCommand.manualEntry?.examples;
                    const topExamples = (selectedCommand as any).examples;
                    const hasManual = Array.isArray(meExamples) && meExamples.length > 0;
                    const hasTop = Array.isArray(topExamples) && topExamples.length > 0;

                    type NormEx = { scpiCode: string; description: string };
                    let normalised: NormEx[] = [];
                    if (hasManual) {
                      normalised = (meExamples as any[]).slice(0, 3).map((ex: any) => ({
                        scpiCode: ex.codeExamples?.scpi?.code || (ex as any).scpi || '',
                        description: ex.description || '',
                      }));
                    } else if (hasTop) {
                      normalised = (topExamples as any[]).slice(0, 3).map((ex: any) => ({
                        scpiCode: ex.scpi || ex.codeExamples?.scpi?.code || '',
                        description: ex.description || '',
                      }));
                    } else if (selectedCommand.example) {
                      normalised = [{ scpiCode: selectedCommand.example, description: '' }];
                    }

                    const visible = normalised.filter(ex => ex.scpiCode || ex.description);
                    if (visible.length === 0) return null;

                    return (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase mb-2">Examples</h4>
                        <div className="space-y-3">
                          {visible.map((ex, idx) => (
                            <div key={idx} className="bg-gray-50 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                              {ex.scpiCode && (
                                <div className="font-mono text-xs bg-gray-900 text-green-400 px-3 py-2">
                                  {ex.scpiCode}
                                </div>
                              )}
                              {ex.description && (
                                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800">
                                  <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed italic">
                                    {ex.description}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Add button */}
                  <button
                    onClick={() => {
                      const normalized = materializeCommandTemplate(editedCommand, selectedCommand.params || []);
                      // Create a modified command with the edited command string
                      const modifiedCommand = {
                        ...selectedCommand,
                        scpi: normalized
                      };
                      onSelect(modifiedCommand);
                      setTimeout(() => onClose(), 10);
                      if (triggerAnimation) {
                        triggerAnimation('success');
                      }
                    }}
                    className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
                    title={editedCommand !== selectedCommand.scpi ? `Will add: ${editedCommand}` : buttonText}
                  >
                    {buttonText}
                  </button>
                </div>
              </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Command Detail Modal - Keep for "info" button popup */}
      <CommandDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
        }}
        command={selectedCommand}
        onAddToFlow={handleAddFromDetail}
        categoryColor={selectedCommand ? (categoryColors[selectedCommand.category] || 'bg-blue-100 text-blue-700 border-blue-300') : undefined}
      />
    </>
  );
};
