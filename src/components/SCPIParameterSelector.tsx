/**
 * SCPI Parameter Selector Component
 * 
 * Reusable component for selecting SCPI command parameters (channels, modes, numeric values, etc.)
 * Used across Blockly, Steps UI, and Command Browser.
 */

import React from 'react';
import { EditableParameter, ParsedSCPI } from '../types/scpi';
import { replaceParameter } from '../utils/scpiParameterDetector';
import type { CommandParam } from '../types/commands';

interface SCPIParameterSelectorProps {
  command: string;
  editableParameters?: EditableParameter[];
  parsed?: ParsedSCPI;
  commandParams?: CommandParam[]; // From command library
  onCommandChange: (newCommand: string) => void;
  title?: string;
  className?: string;
  compact?: boolean; // Compact mode for modals
}

export const SCPIParameterSelector: React.FC<SCPIParameterSelectorProps> = ({
  command,
  editableParameters = [],
  parsed,
  commandParams = [],
  onCommandChange,
  title = 'Parameters',
  className = '',
  compact = false
}) => {
  // If no editable parameters, check if we should show command params anyway
  const hasEditableParams = editableParameters.length > 0;
  const hasCommandParams = commandParams.length > 0;
  
  if (!hasEditableParams && !hasCommandParams) {
    return null;
  }

  // Get label for parameter
  const getParameterLabel = (param: EditableParameter, idx: number): string => {
    if (param.mnemonicType) {
      // Mnemonic parameter (CH1, MATH1, B1, etc.)
      switch (param.mnemonicType) {
        case 'channel':
          return 'Channel';
        case 'bus':
          return 'Bus';
        case 'measurement':
          return 'Measurement';
        case 'reference':
          return 'Reference';
        case 'math':
          return 'Math';
        case 'cursor':
          return 'Cursor';
        case 'search':
          return 'Search';
        case 'power':
          return 'Power';
        case 'source':
          return 'Source';
        case 'trace':
          return 'Trace';
        case 'marker':
          return 'Marker';
        default:
          return param.description || `Parameter ${idx + 1}`;
      }
    }
    
    // Try to match with command params from library
    if (commandParams.length > 0) {
      // Filter out mnemonic params from library
      const valueParams = commandParams.filter(p => 
        p.name && !['channel', 'math', 'ref', 'bus', 'measurement', 'cursor', 'search', 'power', 'source', 'trace', 'marker', 'measview'].includes(p.name.toLowerCase())
      );
      
      const libraryParam = valueParams[param.position];
      if (libraryParam) {
        return libraryParam.name || param.description || `Parameter ${idx + 1}`;
      }
    }
    
    return param.description || `Parameter ${idx + 1}`;
  };

  // Get current value from command string
  const getCurrentValue = (param: EditableParameter): string => {
    const currentValueInCommand = command.slice(param.startIndex, param.endIndex);
    
    if (currentValueInCommand.includes('<x>')) {
      // If command has <x> placeholder, use first option
      return param.validOptions[0] || param.currentValue || '';
    }
    
    // Return actual value from command
    return currentValueInCommand;
  };

  // Enrich editable parameters with library data
  const enrichedParams = editableParameters.map((param) => {
    if (commandParams.length === 0 || param.position < 0) {
      return param; // No library data or mnemonic param
    }
    
    // Filter out mnemonic params from library
    const valueParams = commandParams.filter(p => 
      p.name && !['channel', 'math', 'ref', 'bus', 'measurement', 'cursor', 'search', 'power', 'source', 'trace', 'marker', 'measview'].includes(p.name.toLowerCase())
    );
    
    const libraryParam = valueParams[param.position];
    
    if (libraryParam) {
      // For enumeration arguments, populate options
      if (param.type === 'enumeration' && libraryParam.options && libraryParam.options.length > 0) {
        // Filter out type placeholders like <NR1>, <QString>, etc.
        const filteredOptions = libraryParam.options.filter(opt => 
          !(opt.startsWith('<') && opt.endsWith('>'))
        );
        
        if (filteredOptions.length > 0) {
          return {
            ...param,
            validOptions: filteredOptions,
            description: libraryParam.description || param.description
          };
        }
      }
      
      // For other types, also enrich with library data
      return {
        ...param,
        description: libraryParam.description || param.description,
        validOptions: param.validOptions.length > 0 
          ? param.validOptions 
          : (libraryParam.options?.filter(opt => 
              !(opt.startsWith('<') && opt.endsWith('>'))
            ) || [])
      };
    }
    
    return param;
  });

  return (
    <div className={`${className}`}>
      <div className={`${compact ? 'text-xs' : 'text-sm'} font-semibold mb-2 text-gray-700 dark:text-gray-300`}>
        {title}
      </div>
      <div className="space-y-2">
        {enrichedParams.map((param, idx) => {
          const label = getParameterLabel(param, idx);
          const currentValue = getCurrentValue(param);
          
          return (
            <div key={idx}>
              <label className={`block ${compact ? 'text-xs' : 'text-sm'} mb-1 text-gray-600 dark:text-gray-400 font-medium`}>
                {label}
                {param.description && param.description !== label && (
                  <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                    ({param.description})
                  </span>
                )}
              </label>
              {param.validOptions.length > 0 ? (
                <select
                  value={currentValue}
                  onChange={(e) => {
                    const newCommand = replaceParameter(command, param, e.target.value);
                    onCommandChange(newCommand);
                  }}
                  className={`w-full px-2 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
                >
                  {param.validOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={currentValue}
                  onChange={(e) => {
                    const newCommand = replaceParameter(command, param, e.target.value);
                    onCommandChange(newCommand);
                  }}
                  className={`w-full px-2 ${compact ? 'py-1 text-xs' : 'py-1.5 text-sm'} border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500 dark:placeholder-gray-400`}
                  placeholder={param.description || 'Enter value'}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
