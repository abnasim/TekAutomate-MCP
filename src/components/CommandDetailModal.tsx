/**
 * Command Detail Modal
 * 
 * Displays detailed information about a SCPI command including:
 * - Full description
 * - Syntax (set and query forms)
 * - Arguments with types and valid values
 * - Code examples (SCPI, Python, tm_devices)
 * - Related commands
 * - Manual reference
 */

import React, { useState } from 'react';
import { X, Copy, Plus, Code2, BookOpen, ExternalLink } from 'lucide-react';
import { ManualCommandEntry, ParsedSCPI, EditableParameter } from '../types/scpi';
import type { CommandLibraryItem, CommandParam } from '../types/commands';
import { parseSCPI } from '../utils/scpiParser';
import { detectEditableParameters } from '../utils/scpiParameterDetector';
import { SCPIParameterSelector } from './SCPIParameterSelector';

/**
 * Fix mixed syntax strings and construct proper SET syntax with arguments.
 * E.g., "CMD {<NR1>|OFF|ON} CMD?" should be split into set and query parts.
 * If params are provided and set syntax is missing arguments, construct them.
 */
const fixSyntaxDisplay = (
  syntax: { set?: string; query?: string } | undefined,
  params?: Array<{ name: string; type?: string; options?: string[] }>
): { set: string | null; query: string | null } => {
  if (!syntax) return { set: null, query: null };
  
  let setSyntax = syntax.set?.trim() || null;
  let querySyntax = syntax.query?.trim() || null;
  
  // Fix case where query contains both SET and QUERY syntax
  if (querySyntax && querySyntax.includes('{') && querySyntax.includes('?')) {
    // Pattern: "COMMAND {args} COMMAND?" - split them
    const queryMatch = querySyntax.match(/^(.+?\})\s+(\S+\?)$/);
    if (queryMatch) {
      if (!setSyntax) {
        setSyntax = queryMatch[1].trim();
      }
      querySyntax = queryMatch[2].trim();
    } else {
      // Try another pattern: find where the query command starts
      const parts = querySyntax.split(/\s+/);
      const queryPart = parts.find(p => p.endsWith('?'));
      if (queryPart) {
        const queryIdx = querySyntax.lastIndexOf(queryPart);
        if (queryIdx > 0) {
          const potentialSet = querySyntax.substring(0, queryIdx).trim();
          if (potentialSet && (potentialSet.includes('{') || potentialSet.includes('<NR'))) {
            if (!setSyntax) {
              setSyntax = potentialSet;
            }
            querySyntax = queryPart;
          }
        }
      }
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
  
  // If set syntax exists but has no arguments, construct them from params
  if (setSyntax && !setSyntax.includes('{') && !/\s*<NR\d*>/i.test(setSyntax) && !/<QString>/i.test(setSyntax) && params && params.length > 0) {
    // Find value parameter (not mnemonic params like 'channel', 'math', etc.)
    const mnemonicNames = ['channel', 'math', 'ref', 'bus', 'cursor', 'search', 'power', 'plot', 'meas', 'source', 'histogram', 'digital_bit', 'mask', 'callout', 'actonevent', 'license', 'rail', 'source_num', 'trigger_type'];
    const valueParam = params.find(p => 
      p.name.toLowerCase() === 'value' || 
      (p.options && p.options.length > 0 && !mnemonicNames.includes(p.name.toLowerCase()))
    );
    
    if (valueParam) {
      let argStr = '';
      if (valueParam.options && valueParam.options.length > 0) {
        // Check if options include numeric types (case-insensitive)
        const numericRegex = /<(number|NR\d*|NRx)>/i;
        const hasNumber = valueParam.options.some(o => numericRegex.test(o));
        const otherOptions = valueParam.options.filter(o => !numericRegex.test(o) && !/<QString>/i.test(o));
        
        if (hasNumber && otherOptions.length > 0) {
          argStr = ` {<NR1>|${otherOptions.join('|')}}`;
        } else if (otherOptions.length > 0) {
          argStr = ` {${otherOptions.join('|')}}`;
        } else if (hasNumber) {
          argStr = ' <NR1>';
        }
      } else if (valueParam.type === 'number' || valueParam.type === 'integer' || valueParam.type === 'enumeration') {
        argStr = valueParam.type === 'enumeration' ? '' : ' <NR1>';
      } else if (valueParam.type === 'string') {
        argStr = ' <QString>';
      }
      
      if (argStr) {
        setSyntax = setSyntax + argStr;
      }
    }
  }

  const normalizeSyntaxText = (value: string | null): string | null => {
    if (!value) return value;
    let out = value
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\|\|+/g, '|')
      .trim();

    // Normalize enum blocks by removing empty and duplicate tokens.
    out = out.replace(/\{([^}]*)\}/g, (_match, inner) => {
      const seen = new Set<string>();
      const values = String(inner)
        .split('|')
        .map((x) => x.trim())
        .filter((x) => {
          if (!x) return false;
          const key = x.toUpperCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return `{${values.join('|')}}`;
    });
    return out;
  };

  setSyntax = normalizeSyntaxText(setSyntax);
  querySyntax = normalizeSyntaxText(querySyntax);
  
  return { set: setSyntax, query: querySyntax };
};

interface CommandDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  command: CommandLibraryItem | null;
  onAddToFlow?: (command: CommandLibraryItem) => void;
  onOpenTestSelector?: () => void;
  categoryColor?: string;
}

export const CommandDetailModal: React.FC<CommandDetailModalProps> = ({
  isOpen,
  onClose,
  command,
  onAddToFlow,
  onOpenTestSelector,
  categoryColor = 'bg-blue-100 text-blue-700 border-blue-300',
}) => {
  const [activeExampleTab, setActiveExampleTab] = useState<'scpi' | 'python' | 'tm_devices'>('scpi');
  const [editedCommand, setEditedCommand] = useState<string>(command?.scpi || '');
  const [showRawSyntax, setShowRawSyntax] = useState(false);

  // Reset edited command when command changes or modal opens
  React.useEffect(() => {
    if (command) {
      // Use syntax from manualEntry if available (includes argument placeholders like {GRATICULE|BADGE})
      let initialCommand = command.scpi;
      
      // Check if manualEntry has better syntax with arguments
      if (command.manualEntry?.syntax) {
        const syntax = command.manualEntry.syntax;
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
      const isSetCommand = command.manualEntry?.commandType === 'set' || 
                           command.manualEntry?.commandType === 'both';
      
      // If it's a set command but ends with ?, remove the ?
      if (isSetCommand && isQueryCommand && command.manualEntry?.commandType !== 'query') {
        initialCommand = initialCommand.trim().slice(0, -1);
      }
      
      setEditedCommand(initialCommand);
      setShowRawSyntax(false);
    }
  }, [command, isOpen]);

  if (!isOpen || !command) return null;

  const manualEntry = command.manualEntry as ManualCommandEntry | undefined;
  
  // Parse command to detect editable parameters
  const parsed: ParsedSCPI | null = editedCommand ? parseSCPI(editedCommand) : null;
  const editableParameters: EditableParameter[] = parsed ? detectEditableParameters(parsed) : [];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add toast notification here
  };

  const getSyntaxDisplay = () => {
    const extractEnumTokensFromArgumentsText = (text: string): string[] => {
      return text
        .split(/\r?\n|\.\s+/)
        .map((line) => line.trim())
        .map(
          (line) =>
            line.match(
              /^([A-Z][A-Z0-9_]+)\s+(creates|specifies|sets|enables|selects|indicates|turns|defines|determines|controls)\b/i
            )?.[1] || ''
        )
        .filter(Boolean);
    };
    const mergeSyntaxEnumFromArgumentsText = (setSyntax: string | null, argsText: string | undefined): string | null => {
      if (!setSyntax || !argsText) return setSyntax;
      const enumMatch = setSyntax.match(/\{([^}]*)\}/);
      const hasOpenEnum = setSyntax.includes('{');

      const syntaxValues = enumMatch
        ? enumMatch[1]
            .split('|')
            .map((v) => v.trim())
            .filter(Boolean)
        : hasOpenEnum
          ? setSyntax
              .split('{')[1]
              ?.split('|')
              .map((v) => v.trim())
              .filter(Boolean) || []
          : [];
      const seen = new Set(syntaxValues.map((v) => v.toUpperCase()));
      const fromArgs = extractEnumTokensFromArgumentsText(argsText)
        .filter((token) => !seen.has(token.toUpperCase()));
      if (fromArgs.length === 0 && enumMatch) return setSyntax;
      if (fromArgs.length === 0 && !enumMatch) return setSyntax;

      const merged = `{${[...syntaxValues, ...fromArgs].join('|')}}`;
      if (enumMatch) {
        return setSyntax.replace(/\{[^}]*\}/, merged);
      }
      if (hasOpenEnum) {
        return `${setSyntax.split('{')[0].trim()} ${merged}`.trim();
      }
      return `${setSyntax.trim()} ${merged}`.trim();
    };

    if (manualEntry?.syntax) {
      // Use the fixed syntax helper to properly split mixed syntax and add arguments
      const fixed = fixSyntaxDisplay(manualEntry.syntax, command.params);
      const mergedSetSyntax = mergeSyntaxEnumFromArgumentsText(
        fixed.set,
        typeof manualEntry.arguments === 'string' ? manualEntry.arguments : undefined
      );
      return {
        set: mergedSetSyntax,
        query: fixed.query,
      };
    }
    // Fallback: construct from command
    const header = command.scpi.split(/\s/)[0];
    return {
      set: header,
      query: header + '?',
    };
  };

  const getRawSyntaxDisplay = () => {
    const rawSyntax: unknown = manualEntry?.syntax as unknown;
    if (rawSyntax) {
      const syntax = rawSyntax;
      if (typeof syntax === 'object') {
        return {
          set:
            syntax &&
            typeof (syntax as Record<string, unknown>).set === 'string'
              ? String((syntax as Record<string, unknown>).set).trim()
              : null,
          query:
            syntax &&
            typeof (syntax as Record<string, unknown>).query === 'string'
              ? String((syntax as Record<string, unknown>).query).trim()
              : null,
        };
      }
      if (typeof syntax === 'string') {
        const s = syntax.trim();
        return {
          set: s.endsWith('?') ? null : s,
          query: s.endsWith('?') ? s : null,
        };
      }
    }
    const header = command.scpi.split(/\s/)[0];
    return {
      set: header,
      query: header + '?',
    };
  };

  const syntax = showRawSyntax ? getRawSyntaxDisplay() : getSyntaxDisplay();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-800">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{command.name}</h2>
              <span className={`text-xs px-3 py-1 rounded-full border font-medium ${categoryColor} dark:bg-gray-700 dark:text-gray-200 dark:border-gray-500`}>
                {command.category}
              </span>
              {command.subcategory && (
                <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600">
                  {command.subcategory}
                </span>
              )}
              {manualEntry?.commandType && (
                <>
                  {(manualEntry.commandType === 'set' || manualEntry.commandType === 'both') && (
                    <span className="text-xs px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 font-semibold border border-emerald-200 dark:border-emerald-700">
                      Set
                    </span>
                  )}
                  {(manualEntry.commandType === 'query' || manualEntry.commandType === 'both') && (
                    <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-semibold border border-blue-200 dark:border-blue-700">
                      Query
                    </span>
                  )}
                </>
              )}
            </div>
            <div className="font-mono text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded border border-blue-200 dark:border-blue-800 break-all">
              {editedCommand}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            {onAddToFlow && (
              <button
                onClick={() => {
                  const modifiedCommand = {
                    ...command,
                    scpi: editedCommand
                  };
                  onAddToFlow(modifiedCommand);
                  onClose();
                }}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 flex items-center gap-2 transition"
                title={editedCommand !== command.scpi ? `Will add: ${editedCommand}` : 'Add to Flow'}
              >
                <Plus size={14} />
                Add to Flow
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition text-gray-600 dark:text-gray-400"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <BookOpen size={18} />
              Description
            </h3>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              {manualEntry?.description || command.description || 'No description available.'}
            </p>
          </div>

          {/* Editable Parameters - Always visible if parameters exist */}
          {editableParameters.length > 0 && (
            <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <SCPIParameterSelector
                command={editedCommand}
                editableParameters={editableParameters}
                parsed={parsed || undefined}
                commandParams={command.params}
                onCommandChange={setEditedCommand}
                title="Parameters"
                compact={false}
              />
              {editedCommand !== command.scpi && (
                <div className="mt-3 p-2 bg-white dark:bg-gray-700/50 border border-purple-200 dark:border-purple-700 rounded">
                  <div className="text-xs text-purple-600 dark:text-purple-300 font-medium mb-1">Updated Command:</div>
                  <code className="text-sm font-mono text-purple-900 dark:text-purple-200 break-all">{editedCommand}</code>
                </div>
              )}
            </div>
          )}

          {/* Parameters */}
          {command.params && command.params.length > 0 && (() => {
            // Filter out value parameters for query-only commands
            const isQueryOnly = manualEntry?.commandType === 'query' || 
                               (command.scpi.trim().endsWith('?') && !syntax.set);
            const filteredParams = isQueryOnly 
              ? command.params?.filter((p: CommandParam) => p.name.toLowerCase() !== 'value') || []
              : command.params || [];
            
            if (filteredParams.length === 0) return null;
            
            return (
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-gray-100">
                  <Code2 size={18} />
                  Parameters
                </h3>
                <div className="space-y-2">
                  {filteredParams.map((p: CommandParam, idx: number) => (
                  <div key={`${p.name}-${idx}`} className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                      {p.required && <span className="text-xs text-red-500 font-semibold">required</span>}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 font-mono">
                        {p.type || 'text'}
                      </span>
                    </div>
                    {p.description && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{p.description}</p>}
                    {p.options && p.options.length > 0 && (() => {
                      // Filter out type placeholders - they're not selectable options
                      const placeholderRegex = /^<(NR\d*|number|NRx|QString)>$/i;
                      const filteredOpts = p.options.filter((opt: string) => !placeholderRegex.test(opt));
                      const hasNumeric = p.options.some((opt: string) => /^<(NR\d*|number|NRx)>$/i.test(opt));
                      
                      if (filteredOpts.length === 0 && !hasNumeric) return null;
                      
                      return (
                        <div className="mt-2">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {hasNumeric && filteredOpts.length > 0 ? 'Options (or numeric value):' : 'Options:'}
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {hasNumeric && (
                              <span className="px-2 py-0.5 rounded text-xs font-mono bg-blue-50 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300">
                                &lt;number&gt;
                              </span>
                            )}
                            {filteredOpts.map((opt: string) => (
                              <span
                                key={opt}
                                className="px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 text-gray-700 dark:text-gray-300"
                              >
                                {opt}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {p.default !== undefined && p.default !== null && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Default: {String(p.default)}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            );
          })()}

          {/* Syntax */}
          {(syntax.set || syntax.query) && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
                  <Code2 size={18} />
                  Syntax
                </h3>
                {manualEntry?.syntax && (
                  <button
                    type="button"
                    onClick={() => setShowRawSyntax((s) => !s)}
                    className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition"
                    title="Toggle between source manual syntax and cleaned display syntax"
                  >
                    {showRawSyntax ? 'Show cleaned syntax' : 'Show raw manual syntax'}
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {syntax.set && (
                  <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                    <div className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">Set Command</div>
                    <div className="bg-gray-900 dark:bg-gray-950 px-3 py-2 font-mono text-sm relative">
                      <div className="overflow-x-auto pr-8">
                        <code className="text-green-400 whitespace-pre-wrap break-all">{syntax.set}</code>
                      </div>
                      <button
                        onClick={() => handleCopy(syntax.set!)}
                        className="absolute top-2 right-2 p-1 hover:bg-gray-700 rounded transition text-gray-400 hover:text-white"
                        title="Copy"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}
                {syntax.query && (
                  <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                    <div className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">Query Command</div>
                    <div className="bg-gray-900 dark:bg-gray-950 px-3 py-2 font-mono text-sm relative">
                      <div className="overflow-x-auto pr-8">
                        <code className="text-blue-400 whitespace-pre-wrap break-all">{syntax.query}</code>
                      </div>
                      <button
                        onClick={() => handleCopy(syntax.query!)}
                        className="absolute top-2 right-2 p-1 hover:bg-gray-700 rounded transition text-gray-400 hover:text-white"
                        title="Copy"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Arguments */}
          {manualEntry?.arguments && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Arguments</h3>
                {/* Show bulk selector button for TEKEXP:SELECT TEST command */}
                {command.scpi.includes('TEKEXP:SELECT TEST') && 
                 onOpenTestSelector &&
                 Array.isArray(manualEntry.arguments) &&
                 (manualEntry.arguments.find((arg: any) => arg.name === 'testname')?.validValues?.values?.length || 0) > 10 && (
                  <button
                    onClick={onOpenTestSelector}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white text-xs rounded-lg shadow-sm transition-all"
                    title="Bulk select and add multiple tests at once"
                  >
                    <Plus size={14} />
                    Bulk Add Tests
                  </button>
                )}
              </div>
              {/* Handle string format (new JSON) */}
              {typeof manualEntry.arguments === 'string' ? (
                <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-4">
                  {(() => {
                    // Parse arguments text into structured format
                    const text = manualEntry.arguments as string;
                    
                    // Split by sentence endings (. followed by space and capital letter)
                    const sentences = text.split(/\.\s+(?=[A-Z])/);
                    
                    return (
                      <ul className="space-y-2">
                        {sentences.map((sentence: string, idx: number) => {
                          if (!sentence.trim()) return null;
                          
                          // Add period back if missing
                          const cleanSentence = sentence.trim();
                          const displaySentence = cleanSentence.endsWith('.') ? cleanSentence : cleanSentence + '.';
                          
                          // Check if this sentence defines a specific value (e.g., "SOF specifies...")
                          const valueMatch = displaySentence.match(/^([A-Z][A-Za-z0-9_]+)\s+(specifies|sets|enables|selects|indicates|turns|defines|determines|controls)/i);
                          
                          if (valueMatch) {
                            const valueName = valueMatch[1];
                            const restOfSentence = displaySentence.substring(valueName.length).trim();
                            
                            return (
                              <li key={idx} className="flex gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-mono bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 font-semibold h-fit">
                                  {valueName}
                                </span>
                                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{restOfSentence}</span>
                              </li>
                            );
                          }
                          
                          // Regular sentence
                          return (
                            <li key={idx} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                              {displaySentence}
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              ) : Array.isArray(manualEntry.arguments) && manualEntry.arguments.length > 0 ? (
                /* Handle array format (old JSON) */
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                        <th className="text-left p-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Name</th>
                        <th className="text-left p-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Type</th>
                        <th className="text-left p-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Required</th>
                        <th className="text-left p-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Valid Values</th>
                        <th className="text-left p-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualEntry.arguments.map((arg: any, idx: number) => (
                        <tr key={idx} className="border-b border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="p-2 text-sm font-mono text-gray-900 dark:text-gray-100">{arg.name}</td>
                          <td className="p-2 text-sm">
                            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded text-xs">
                              {arg.type}
                            </span>
                          </td>
                          <td className="p-2 text-sm">
                            {arg.required ? (
                              <span className="text-red-600 dark:text-red-400 font-medium">Yes</span>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400">No</span>
                            )}
                          </td>
                          <td className="p-2 text-sm">
                            {arg.validValues?.values && (
                              <div className="flex flex-wrap gap-1">
                                {arg.validValues.values.slice(0, 5).map((val: string, i: number) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded text-xs font-mono"
                                  >
                                    {val}
                                  </span>
                                ))}
                                {arg.validValues.values.length > 5 && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    +{arg.validValues.values.length - 5} more
                                  </span>
                                )}
                              </div>
                          )}
                          {arg.validValues?.range && (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              Range: {Object.entries(arg.validValues.range).map(([key, val]: [string, any]) => (
                                <span key={key}>
                                  {key}: {val.min}-{val.max}
                                </span>
                              ))}
                            </div>
                          )}
                          {arg.validValues?.min !== undefined && arg.validValues?.max !== undefined && (
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {arg.validValues.min} to {arg.validValues.max}
                              {arg.validValues.unit && ` ${arg.validValues.unit}`}
                            </div>
                          )}
                          {!arg.validValues?.values && !arg.validValues?.range && arg.validValues?.min === undefined && (
                            <span className="text-gray-400 dark:text-gray-500 text-xs">Any valid {arg.type}</span>
                          )}
                        </td>
                          <td className="p-2 text-sm text-gray-600 dark:text-gray-400">{arg.description || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}

          {/* Examples */}
          {manualEntry?.examples && manualEntry.examples.length > 0 && (() => {
            // Get the base command header (without ? or arguments)
            const cmdHeader = command.scpi.split(/[\s?]/)[0].replace(/<x>/gi, '').toUpperCase();

            // Normalise to {scpiCode, description, rawExample} regardless of format
            type NormEx = { scpiCode: string; description: string; rawExample: any };
            const normalised: NormEx[] = (manualEntry.examples as any[]).map((ex: any) => ({
              scpiCode: ex.codeExamples?.scpi?.code || (ex as any).scpi || '',
              description: ex.description || '',
              rawExample: ex,
            }));
            
            // Filter out corrupted examples that belong to other commands
            const validExamples = normalised.filter(({ scpiCode }) => {
              const code = scpiCode;
              if (!code.trim()) return false;
              if (/^(This command|Sets or|Queries|Returns|Specifies)/i.test(code.trim())) return false;
              const codeHeader = code.split(/[\s?]/)[0].replace(/<x>/gi, '').replace(/\d+/g, '').toUpperCase();
              const cmdBase = cmdHeader.replace(/\d+/g, '');
              if (codeHeader && cmdBase && !codeHeader.includes(cmdBase.split(':').slice(-1)[0])) {
                return false;
              }
              return true;
            });
            
            if (validExamples.length === 0) return null;
            
            return (
              <div>
                <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Examples</h3>
                {validExamples.map(({ scpiCode, description, rawExample: example }, idx: number) => (
                <div key={idx} className="mb-4 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                  {/* SCPI Code Block - shown first */}
                  {scpiCode && (
                    <div className="bg-gray-900 dark:bg-gray-950 text-green-400 p-3 font-mono text-sm relative group">
                      <code>{scpiCode}</code>
                      <button
                        onClick={() => handleCopy(scpiCode)}
                        className="absolute top-2 right-2 p-1 bg-gray-700 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition"
                        title="Copy code"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  )}
                  
                  {/* Description - formatted below the SCPI code */}
                  {description && (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600">
                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed italic">
                        {description}
                      </p>
                    </div>
                  )}

                  {/* Additional code examples (Python, tm_devices) */}
                  {example.codeExamples && (example.codeExamples.python || example.codeExamples.tm_devices) && (
                    <div className="border-t border-gray-200 dark:border-gray-600">
                      {/* Example tabs */}
                      <div className="bg-gray-100 dark:bg-gray-700 px-3 py-2 border-b border-gray-200 dark:border-gray-600">
                        <div className="flex gap-2">
                          {example.codeExamples.python && (
                            <button
                              onClick={() => setActiveExampleTab('python')}
                              className={`px-3 py-1 text-xs font-medium rounded transition ${
                                activeExampleTab === 'python'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              Python
                            </button>
                          )}
                          {example.codeExamples.tm_devices && (
                            <button
                              onClick={() => setActiveExampleTab('tm_devices')}
                              className={`px-3 py-1 text-xs font-medium rounded transition ${
                                activeExampleTab === 'tm_devices'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              tm_devices
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Example code */}
                      {example.codeExamples?.python && activeExampleTab === 'python' && (
                        <div className="bg-gray-900 text-gray-100 p-3 font-mono text-sm relative group">
                          <code>{example.codeExamples.python.code}</code>
                          <button
                            onClick={() => handleCopy(example.codeExamples!.python!.code)}
                            className="absolute top-2 right-2 p-1 bg-gray-700 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition"
                            title="Copy code"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      )}
                      {example.codeExamples?.tm_devices && activeExampleTab === 'tm_devices' && (
                        <div className="bg-gray-900 text-gray-100 p-3 font-mono text-sm relative group">
                          <code>{example.codeExamples.tm_devices.code}</code>
                          <button
                            onClick={() => handleCopy(example.codeExamples!.tm_devices!.code)}
                            className="absolute top-2 right-2 p-1 bg-gray-700 hover:bg-gray-600 rounded opacity-0 group-hover:opacity-100 transition"
                            title="Copy code"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Result */}
                  {example.result && (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border-t border-green-200 dark:border-green-800">
                      <div className="text-xs text-green-700 dark:text-green-300 font-medium mb-1">Result:</div>
                      <div className="font-mono text-sm text-green-900 dark:text-green-200">{String(example.result)}</div>
                      {example.resultDescription && (
                        <div className="text-xs text-green-700 dark:text-green-300 mt-1">{example.resultDescription}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            );
          })()}

          {/* Related Commands */}
          {manualEntry?.relatedCommands && manualEntry.relatedCommands.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Related Commands</h3>
              <div className="flex flex-wrap gap-2">
                {manualEntry.relatedCommands.map((related, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600 text-sm font-mono hover:bg-gray-200 dark:hover:bg-gray-600 transition cursor-pointer"
                  >
                    {related}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Manual Reference */}
          {manualEntry?.manualReference && (
            <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <ExternalLink size={16} />
                <span>
                  Manual Reference: {manualEntry.manualReference.section}
                  {manualEntry.manualReference.page && ` (Page ${manualEntry.manualReference.page})`}
                </span>
              </div>
            </div>
          )}

          {/* Notes */}
          {manualEntry?.notes && manualEntry.notes.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Notes</h3>
              <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                {manualEntry.notes.map((note, idx) => (
                  <li key={idx} className="text-sm">{note}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {manualEntry?.commandType && (
              <span className="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded text-gray-700 dark:text-gray-300">
                {manualEntry.commandType === 'both' ? 'Set & Query' : manualEntry.commandType === 'query' ? 'Query Only' : 'Set Only'}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

