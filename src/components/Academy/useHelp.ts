import { useAcademyContext } from './AcademyContext';

/**
 * Hook for easy access to Academy functionality from any component.
 * 
 * @example
 * ```tsx
 * const { openArticle, close, isOpen } = useHelp();
 * 
 * <button onClick={() => openArticle('backend_comparison')}>
 *   Learn More
 * </button>
 * ```
 */
export const useHelp = () => {
  const context = useAcademyContext();
  return context;
};












