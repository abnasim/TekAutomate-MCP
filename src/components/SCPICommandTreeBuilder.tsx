/**
 * SCPI Parameter Selector
 * 
 * A simple inline component that appears when typing parameterized commands.
 * Shows quick selection for <x>, <n> parameters like MEAS1, MEAS2, CH1, CH2, etc.
 */

import React, { useMemo } from 'react';
import { Hash, ChevronRight } from 'lucide-react';

export interface CommandLibraryItem {
  name: string;
  scpi: string;
  description: string;
  category: string;
  params?: Array<{ name: string; type?: string; options?: string[]; description?: string }>;
  manualEntry?: {
    syntax?: { set?: string; query?: string } | string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface SCPICommandTreeBuilderProps {
  commands: CommandLibraryItem[];
  searchQuery: string;
  onSelectParameter: (resolvedCommand: string, index: number) => void;
}

interface DetectedParameter {
  displayName: string;
  fullPrefix: string;
  typedNumber: number | null;
  maxIndex: number;
  matchingCommands: CommandLibraryItem[];
  afterParam: string;
  exactMatchCommand: CommandLibraryItem | null;
}

function chooseBestPrefixCommand(
  candidates: CommandLibraryItem[],
  paramName: string
): CommandLibraryItem | null {
  if (!candidates.length) return null;
  const scored = candidates.map((cmd) => {
    const scpi = String(cmd.scpi || '').toUpperCase();
    const marker = `${paramName}<X>`;
    const idx = scpi.indexOf(marker);
    const prefix = idx >= 0 ? scpi.slice(0, idx) : scpi;
    const startsNative = /^:?([A-Z]+:)?[A-Z]+/.test(scpi) && (scpi.startsWith(`${paramName}<X>`) || scpi.startsWith(`${paramName}<N>`));
    const isDisplayWrapped = /DISPLAY:|WAVEVIEW|GLOBAL:/.test(prefix);
    // Prefer native roots (e.g. PLOT:PLOT<x>...) over wrapped display paths.
    const score =
      (startsNative ? 100 : 0) +
      (isDisplayWrapped ? -20 : 0) +
      (idx >= 0 ? Math.max(0, 50 - idx) : 0) -
      prefix.split(':').length;
    return { cmd, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cmd || candidates[0];
}

// Known parameter patterns with their max values
const PARAM_CONFIGS: Record<string, number> = {
  'CH': 8,
  'MEAS': 8,
  'REF': 8,
  'MATH': 4,
  'BUS': 4,
  'D': 16,
  'CURSOR': 2,
  'PLOT': 4,
  'SEARCH': 8,
  'DIGGRP': 4,
};

// Helper function to extract options from a command
const extractCommandOptions = (cmd: CommandLibraryItem | null): string[] => {
  if (!cmd) return [];
  
  const options: string[] = [];
  
  // Check syntax array for {OPTION1|OPTION2|...} pattern
  const syntaxArray = (cmd as any).syntax;
  if (syntaxArray && Array.isArray(syntaxArray)) {
    syntaxArray.forEach((syntaxLine: string) => {
      const optionMatches = syntaxLine.match(/\{([^}]+)\}/g);
      if (optionMatches) {
        optionMatches.forEach((match: string) => {
          const inner = match.slice(1, -1);
          const opts = inner.split('|')
            .map((o: string) => o.trim().replace(/\s+/g, ''))
            .filter((o: string) => o && !o.includes('<') && !o.includes('>'));
          options.push(...opts);
        });
      }
    });
  }
  
  // Check manualEntry syntax
  if (cmd.manualEntry?.syntax) {
    const syntax = cmd.manualEntry.syntax;
    const syntaxStr = typeof syntax === 'string' ? syntax : syntax.set || '';
    const optionMatch = syntaxStr.match(/\{([^}]+)\}/);
    if (optionMatch) {
      const opts = optionMatch[1].split('|').map((o: string) => o.trim()).filter((o: string) => o);
      options.push(...opts);
    }
  }
  
  return Array.from(new Set(options));
};

export const SCPICommandTreeBuilder: React.FC<SCPICommandTreeBuilderProps> = ({
  commands,
  searchQuery,
  onSelectParameter
}) => {
  
  // Detect if user is typing something that matches a parameterized command
  const detected = useMemo((): DetectedParameter | null => {
    if (!searchQuery || searchQuery.length < 2 || commands.length === 0) return null;
    
    const query = searchQuery.toUpperCase().trim();
    
    // Check if query contains a known parameter pattern
    for (const [paramName, maxIndex] of Object.entries(PARAM_CONFIGS)) {
      const paramRegex = new RegExp(`(^|:)(${paramName})(<[xXnN]>|\\d*)(:|$)`, 'i');
      const match = query.match(paramRegex);
      
      if (match) {
        const indexPart = match[3];
        const afterMatch = query.substring(match.index! + match[0].length - (match[4] === ':' ? 1 : 0));
        
        let typedNum: number | null = null;
        if (indexPart && /^\d+$/.test(indexPart)) {
          typedNum = parseInt(indexPart);
        }
        
        const paramPattern = new RegExp(`${paramName}<[XN]>`, 'i');
        const matchingCommands = commands.filter(cmd => paramPattern.test(cmd.scpi));
        
        if (matchingCommands.length > 0) {
          const prefixExtractRegex = new RegExp(`^(.*)${paramName}<[XN]>`, 'i');
          const preferredCmd = chooseBestPrefixCommand(matchingCommands, paramName) || matchingCommands[0];
          const prefixMatch = preferredCmd.scpi.match(prefixExtractRegex);
          const fullPrefix = prefixMatch ? prefixMatch[1] + paramName : paramName;
          
          let filteredCommands = matchingCommands;
          let exactMatchCommand: CommandLibraryItem | null = null;
          
          if (afterMatch) {
            const normalizedAfter = afterMatch.replace(/^:/, '').toUpperCase();
            const afterPrefixPattern = new RegExp(`${paramName}<[XN]>:${normalizedAfter}`, 'i');
            const filtered = matchingCommands.filter(cmd => afterPrefixPattern.test(cmd.scpi));
            if (filtered.length > 0) {
              filteredCommands = filtered;
            }
            
            const exactPattern = new RegExp(`${paramName}<[XN]>:${normalizedAfter}$`, 'i');
            exactMatchCommand = matchingCommands.find(cmd => exactPattern.test(cmd.scpi)) || null;
          }
          
          return {
            displayName: paramName,
            fullPrefix,
            typedNumber: typedNum,
            maxIndex,
            matchingCommands: filteredCommands,
            afterParam: afterMatch || '',
            exactMatchCommand
          };
        }
      }
    }
    
    // Simple prefix match
    for (const [paramName, maxIndex] of Object.entries(PARAM_CONFIGS)) {
      const simpleRegex = new RegExp(`^${paramName}(\\d*)$`, 'i');
      const match = query.match(simpleRegex);
      
      if (match) {
        const typedNum = match[1] ? parseInt(match[1]) : null;
        
        const paramPattern = new RegExp(`${paramName}<[XN]>`, 'i');
        const matchingCommands = commands.filter(cmd => paramPattern.test(cmd.scpi));
        
        if (matchingCommands.length > 0) {
          const prefixExtractRegex = new RegExp(`^(.*)${paramName}<[XN]>`, 'i');
          const preferredCmd = chooseBestPrefixCommand(matchingCommands, paramName) || matchingCommands[0];
          const prefixMatch = preferredCmd.scpi.match(prefixExtractRegex);
          const fullPrefix = prefixMatch ? prefixMatch[1] + paramName : paramName;
          
          return {
            displayName: paramName,
            fullPrefix,
            typedNumber: typedNum,
            maxIndex,
            matchingCommands,
            afterParam: '',
            exactMatchCommand: null
          };
        }
      }
    }
    
    return null;
  }, [searchQuery, commands]);

  // Get sub-commands available (must be before any conditional returns)
  const subCommands = useMemo(() => {
    if (!detected) return [];
    
    const { displayName, matchingCommands, afterParam, fullPrefix, typedNumber } = detected;
    const subCmdMap = new Map<string, { name: string, cmd: CommandLibraryItem, resolvedPath: string }>();
    const tailPattern = new RegExp(`${displayName}<[XN]>(.*)$`, 'i');
    const typedRaw = (afterParam || '').replace(/^:/, '').trim();
    const typedTokens = typedRaw ? typedRaw.split(':').filter(Boolean) : [];
    const selectedIndex = typedNumber || 1;
    const basePrefix = `${fullPrefix}${selectedIndex}`;

    // No typed tail yet: suggest first segment after CH<x>/REF<x>/...
    if (typedTokens.length === 0) {
      matchingCommands.forEach(cmd => {
        const match = cmd.scpi.match(tailPattern);
        if (!match) return;
        const tailTokens = (match[1] || '').replace(/^:/, '').split(':').filter(Boolean);
        if (tailTokens.length === 0) return;
        const name = tailTokens[0];
        const key = name.toUpperCase();
        if (!subCmdMap.has(key)) {
          subCmdMap.set(key, { name, cmd, resolvedPath: `${basePrefix}:${name}` });
        }
      });
      return Array.from(subCmdMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 20);
    }

    const pos = typedTokens.length - 1;
    const tokenAtPosMatchesExact = matchingCommands.some(cmd => {
      const match = cmd.scpi.match(tailPattern);
      if (!match) return false;
      const tailTokens = (match[1] || '').replace(/^:/, '').split(':').filter(Boolean);
      if (tailTokens.length <= pos) return false;
      for (let i = 0; i < pos; i++) {
        if ((tailTokens[i] || '').toUpperCase() !== typedTokens[i].toUpperCase()) return false;
      }
      return (tailTokens[pos] || '').toUpperCase() === typedTokens[pos].toUpperCase();
    });

    matchingCommands.forEach(cmd => {
      const match = cmd.scpi.match(tailPattern);
      if (!match) return;
      const tailTokens = (match[1] || '').replace(/^:/, '').split(':').filter(Boolean);
      if (tailTokens.length <= pos) return;

      for (let i = 0; i < pos; i++) {
        if ((tailTokens[i] || '').toUpperCase() !== typedTokens[i].toUpperCase()) return;
      }

      if (tokenAtPosMatchesExact) {
        // The current token is complete: suggest the next segment.
        if ((tailTokens[pos] || '').toUpperCase() !== typedTokens[pos].toUpperCase()) return;
        if (tailTokens.length <= pos + 1) return;
        const name = tailTokens[pos + 1];
        const key = name.toUpperCase();
        if (!subCmdMap.has(key)) {
          subCmdMap.set(key, {
            name,
            cmd,
            resolvedPath: `${basePrefix}:${typedTokens.join(':')}:${name}`
          });
        }
      } else {
        // The current token is partial: suggest completion for this token.
        if (!(tailTokens[pos] || '').toUpperCase().startsWith(typedTokens[pos].toUpperCase())) return;
        const name = tailTokens[pos];
        const key = name.toUpperCase();
        if (!subCmdMap.has(key)) {
          const prior = typedTokens.slice(0, pos);
          const rebuilt = prior.length > 0 ? `${prior.join(':')}:${name}` : name;
          subCmdMap.set(key, {
            name,
            cmd,
            resolvedPath: `${basePrefix}:${rebuilt}`
          });
        }
      }
    });

    return Array.from(subCmdMap.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20);
  }, [detected]);

  // Extract options from exact match command (must be before any conditional returns)
  const commandOptions = useMemo(() => {
    return extractCommandOptions(detected?.exactMatchCommand || null);
  }, [detected?.exactMatchCommand]);

  // Early return AFTER all hooks
  if (!detected) {
    return null;
  }

  const { displayName, fullPrefix, typedNumber, maxIndex, matchingCommands, afterParam, exactMatchCommand } = detected;

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-2 mt-2 shadow-sm">
      {/* Header + Index selector on same row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Hash size={14} className="text-purple-600 dark:text-purple-400" />
        <span className="text-xs font-semibold text-purple-900 dark:text-purple-200">
          {displayName}&lt;x&gt;
        </span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          ({matchingCommands.length})
        </span>
        <div className="flex items-center gap-1 flex-wrap ml-auto">
          {Array.from({ length: maxIndex }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              onClick={() => {
                let resolved = `${fullPrefix}${n}`;
                if (afterParam) {
                  resolved += afterParam;
                }
                onSelectParameter(resolved, n);
              }}
              className={`min-w-[26px] h-6 px-1.5 text-xs font-medium rounded transition-all ${
                typedNumber === n
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'bg-white dark:bg-gray-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-800 border border-purple-300 dark:border-purple-600 hover:border-purple-400'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Exact Match Command - Show options */}
      {exactMatchCommand && commandOptions.length > 0 && (
        <div className="pt-2 border-t border-green-200 bg-green-50 -mx-3 -mb-3 px-3 pb-3 rounded-b-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-green-700">
              Matched command: {exactMatchCommand.name}
            </span>
          </div>
          <div className="text-xs text-gray-600 mb-2">Select an option ({commandOptions.length} available):</div>
          <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
            {commandOptions.slice(0, 50).map((option, idx) => (
              <button
                key={`${option}-${idx}`}
                onClick={() => {
                  const num = typedNumber || 1;
                  const resolved = `${fullPrefix}${num}${afterParam} ${option}`;
                  onSelectParameter(resolved, num);
                }}
                className="px-2 py-1 text-xs font-mono bg-white text-green-700 hover:bg-green-100 border border-green-300 hover:border-green-500 rounded transition-all"
              >
                {option}
              </button>
            ))}
            {commandOptions.length > 50 && (
              <span className="text-xs text-gray-500 px-2 py-1">+{commandOptions.length - 50} more</span>
            )}
          </div>
          {exactMatchCommand.description && (
            <p className="text-xs text-gray-500 mt-2 italic line-clamp-2">
              {exactMatchCommand.description}
            </p>
          )}
        </div>
      )}

      {/* Next path segments (only show if no exact match) */}
      {!exactMatchCommand && subCommands.length > 0 && (
        <div className="pt-1.5 mt-1.5 border-t border-purple-200 dark:border-purple-700">
          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
            {subCommands.map(({ name, cmd, resolvedPath }) => (
              <button
                key={name}
                onClick={() => {
                  onSelectParameter(resolvedPath, typedNumber || 1);
                }}
                className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[11px] bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-800 hover:text-purple-700 dark:hover:text-purple-200 border border-gray-200 dark:border-gray-600 hover:border-purple-300 rounded transition-all"
                title={cmd.description || `${displayName}<x>:${name}`}
              >
                <ChevronRight size={8} className="text-gray-400" />
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SCPICommandTreeBuilder;
