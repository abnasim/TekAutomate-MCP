import React, { useState, useEffect, useMemo } from 'react';
import { Search, ArrowRight, ChevronDown, ChevronRight, AlertCircle, Info, X, Copy, Check } from 'lucide-react';
import { publicAssetUrl } from '../utils/publicUrl';

interface Translation {
  header: string;
  addedArgument?: boolean;
  reuseArgument?: boolean;
  reuseSuffix?: boolean;
  sensitiveArgument?: string;
  countOfArguments?: string;
  sendInQuery?: boolean;
}

interface LegacyCommand {
  legacyPath: string;
  modernTranslations: Translation[];
  isCommand: boolean;
  isQuery: boolean;
  hasArgument: boolean;
  comment?: string;
}

interface LegacyCommandsViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LegacyCommandsViewer: React.FC<LegacyCommandsViewerProps> = ({ isOpen, onClose }) => {
  const [commands, setCommands] = useState<LegacyCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set());
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  // Parse the XML file on mount
  useEffect(() => {
    if (!isOpen) return;
    
    const loadXML = async () => {
      try {
        setLoading(true);
        const response = await fetch(publicAssetUrl('commands/Compatibility.xml'));
        if (!response.ok) {
          throw new Error('Failed to load Compatibility.xml');
        }
        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
          throw new Error('Invalid XML format');
        }
        
        const parsedCommands = parseXMLCommands(xmlDoc);
        setCommands(parsedCommands);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load compatibility data');
      } finally {
        setLoading(false);
      }
    };
    
    loadXML();
  }, [isOpen]);

  // Parse XML into structured commands
  const parseXMLCommands = (xmlDoc: Document): LegacyCommand[] => {
    const result: LegacyCommand[] = [];
    const translationsRoot = xmlDoc.querySelector('translations');
    if (!translationsRoot) return result;

    // Recursive function to build command paths
    const parseKeyword = (element: Element, pathParts: string[], parentComment?: string) => {
      const keywords = element.querySelectorAll(':scope > keyword');
      
      keywords.forEach(keyword => {
        const name = keyword.getAttribute('name') || '';
        const currentPath = [...pathParts, name];
        const isCommand = keyword.getAttribute('command') === '1';
        const isQuery = keyword.getAttribute('query') === '1';
        const hasArgument = keyword.getAttribute('argument') === '1';
        
        // Get any comment that precedes this keyword
        let comment: string | undefined;
        let prevSibling = keyword.previousSibling;
        while (prevSibling) {
          if (prevSibling.nodeType === Node.COMMENT_NODE) {
            comment = prevSibling.textContent?.trim();
            break;
          }
          if (prevSibling.nodeType === Node.ELEMENT_NODE) break;
          prevSibling = prevSibling.previousSibling;
        }
        
        // Get translations
        const translations = keyword.querySelectorAll(':scope > translation');
        if (translations.length > 0) {
          const modernTranslations: Translation[] = [];
          
          translations.forEach(trans => {
            const header = trans.getAttribute('header') || '';
            if (header && header !== '&#10;' && header.trim() !== '') {
              modernTranslations.push({
                header: header.replace(/&#10;/g, '').trim(),
                addedArgument: trans.getAttribute('addedArgument') === '1',
                reuseArgument: trans.getAttribute('reuseArgument') === '1',
                reuseSuffix: trans.getAttribute('reuseSuffix') === '1',
                sensitiveArgument: trans.getAttribute('sensitiveArgument') || undefined,
                countOfArguments: trans.getAttribute('countOfArguments') || undefined,
                sendInQuery: trans.getAttribute('sendInQuery') === '1',
              });
            }
          });
          
          if (modernTranslations.length > 0) {
            result.push({
              legacyPath: currentPath.join(':'),
              modernTranslations,
              isCommand,
              isQuery,
              hasArgument,
              comment: comment || parentComment,
            });
          }
        }
        
        // Recurse into nested keywords
        parseKeyword(keyword, currentPath, comment || parentComment);
      });
    };

    parseKeyword(translationsRoot, []);
    return result;
  };

  // Filter commands based on search
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands;
    
    const query = searchQuery.toLowerCase();
    return commands.filter(cmd => {
      const legacyMatch = cmd.legacyPath.toLowerCase().includes(query);
      const modernMatch = cmd.modernTranslations.some(t => 
        t.header.toLowerCase().includes(query)
      );
      const commentMatch = cmd.comment?.toLowerCase().includes(query);
      return legacyMatch || modernMatch || commentMatch;
    });
  }, [commands, searchQuery]);

  // Group commands by top-level keyword
  const groupedCommands = useMemo(() => {
    const groups: Record<string, LegacyCommand[]> = {};
    
    filteredCommands.forEach(cmd => {
      const topLevel = cmd.legacyPath.split(':')[0];
      if (!groups[topLevel]) {
        groups[topLevel] = [];
      }
      groups[topLevel].push(cmd);
    });
    
    return groups;
  }, [filteredCommands]);

  const toggleExpanded = (path: string) => {
    setExpandedCommands(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCommand(text);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <AlertCircle className="text-amber-600" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Legacy Command Translator</h2>
              <p className="text-sm text-gray-500">DPO7kC/70kC → MSO 4/5/6 Series Command Mapping</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Info Banner */}
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
          <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            This table shows how legacy DPO5000/7000/70000 series commands are translated to modern 
            MSO 4/5/6 Series equivalents using the PI Translator feature. Some commands expand to 
            multiple modern commands.
          </p>
        </div>

        {/* Search */}
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search legacy or modern commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <div className="mt-2 text-sm text-gray-500">
            {filteredCommands.length} command translations found
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
              <span className="ml-3 text-gray-500">Loading compatibility data...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-48 text-red-500">
              <AlertCircle size={48} className="mb-2" />
              <p>{error}</p>
              <p className="text-sm text-gray-500 mt-2">
                Make sure Compatibility.xml is in public/commands/
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedCommands).map(([group, cmds]) => (
                <div key={group} className="border rounded-lg overflow-hidden">
                  <div 
                    className="bg-gray-50 px-4 py-2 font-medium text-gray-700 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                    onClick={() => toggleExpanded(group)}
                  >
                    <div className="flex items-center gap-2">
                      {expandedCommands.has(group) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span className="font-mono">{group}</span>
                    </div>
                    <span className="text-sm text-gray-500">{cmds.length} translations</span>
                  </div>
                  
                  {expandedCommands.has(group) && (
                    <div className="divide-y">
                      {cmds.map((cmd, idx) => (
                        <div key={idx} className="px-4 py-3 hover:bg-gray-50">
                          {cmd.comment && (
                            <div className="text-xs text-gray-500 italic mb-1">
                              {cmd.comment}
                            </div>
                          )}
                          <div className="flex items-start gap-3">
                            {/* Legacy Command */}
                            <div className="flex-1">
                              <div className="text-xs text-gray-400 mb-1">Legacy Command</div>
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-sm bg-red-50 text-red-700 px-2 py-1 rounded">
                                  {cmd.legacyPath}
                                  {cmd.hasArgument && ' <arg>'}
                                  {cmd.isQuery && '?'}
                                </code>
                                <button
                                  onClick={() => copyToClipboard(cmd.legacyPath)}
                                  className="p-1 hover:bg-gray-100 rounded"
                                  title="Copy legacy command"
                                >
                                  {copiedCommand === cmd.legacyPath ? (
                                    <Check size={14} className="text-green-500" />
                                  ) : (
                                    <Copy size={14} className="text-gray-400" />
                                  )}
                                </button>
                              </div>
                              <div className="flex gap-2 mt-1">
                                {cmd.isCommand && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                    SET
                                  </span>
                                )}
                                {cmd.isQuery && (
                                  <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                    QUERY
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Arrow */}
                            <ArrowRight className="text-gray-300 mt-6 flex-shrink-0" size={20} />

                            {/* Modern Commands */}
                            <div className="flex-1">
                              <div className="text-xs text-gray-400 mb-1">Modern Translation(s)</div>
                              <div className="space-y-1">
                                {cmd.modernTranslations.map((trans, tidx) => (
                                  <div key={tidx} className="flex items-center gap-2">
                                    <code className="font-mono text-sm bg-green-50 text-green-700 px-2 py-1 rounded flex-1">
                                      {trans.header}
                                    </code>
                                    <button
                                      onClick={() => copyToClipboard(trans.header)}
                                      className="p-1 hover:bg-gray-100 rounded"
                                      title="Copy modern command"
                                    >
                                      {copiedCommand === trans.header ? (
                                        <Check size={14} className="text-green-500" />
                                      ) : (
                                        <Copy size={14} className="text-gray-400" />
                                      )}
                                    </button>
                                    {trans.sensitiveArgument && (
                                      <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                                        when: {trans.sensitiveArgument}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t bg-gray-50 text-center text-sm text-gray-500">
          PI Translator compatibility file • Use <code className="bg-gray-100 px-1 rounded">*ESR?</code> to verify file loaded on instrument
        </div>
      </div>
    </div>
  );
};



