import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AcademyContextValue } from './types';

const AcademyContext = createContext<AcademyContextValue | undefined>(undefined);

interface AcademyProviderProps {
  children: ReactNode;
}

export const AcademyProvider: React.FC<AcademyProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const openArticle = useCallback((articleId?: string) => {
    if (articleId) {
      setCurrentArticleId(articleId);
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Optionally clear article ID when closing
    // setCurrentArticleId(null);
  }, []);

  const handleSetSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const value: AcademyContextValue = {
    isOpen,
    currentArticleId,
    searchQuery,
    openArticle,
    close,
    setSearchQuery: handleSetSearchQuery,
  };

  return (
    <AcademyContext.Provider value={value}>
      {children}
    </AcademyContext.Provider>
  );
};

export const useAcademyContext = (): AcademyContextValue => {
  const context = useContext(AcademyContext);
  if (context === undefined) {
    throw new Error('useAcademyContext must be used within an AcademyProvider');
  }
  return context;
};












