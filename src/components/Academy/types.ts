export type CategoryId = 
  | 'connection_hardware'
  | 'engine_room'
  | 'measurements_commands'
  | 'scripting_workflow'
  | 'troubleshooting';

export type SubcategoryId =
  | 'physical_connectivity'
  | 'visa_protocol'
  | 'instrument_quirks'
  | 'driver_deep_dives'
  | 'comparison_guides'
  | 'query_write_concept'
  | 'waveform_acquisition'
  | 'screenshots_files'
  | 'ui_to_code'
  | 'advanced_patterns'
  | 'connection_errors'
  | 'data_errors'
  | 'driver_issues';

export type ContentBlockType = 
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code'
  | 'table'
  | 'image'
  | 'callout'
  | 'divider';

export interface ContentBlock {
  type: ContentBlockType;
  level?: number; // For headings (1-6)
  text?: string;
  items?: string[]; // For lists
  language?: string; // For code blocks
  code?: string; // For code blocks
  data?: TableData; // For tables
  src?: string; // For images
  alt?: string; // For images
  variant?: 'info' | 'warning' | 'tip' | 'error'; // For callouts
  title?: string; // For callouts
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface FAQ {
  question: string;
  answer: string | ContentBlock[];
}

export interface CodeExample {
  title: string;
  language: string;
  code: string;
  description?: string;
}

export interface Article {
  id: string;
  title: string;
  category: CategoryId;
  subcategory?: SubcategoryId;
  content: ContentBlock[];
  faqs?: FAQ[];
  relatedArticles?: string[];
  codeExamples?: CodeExample[];
  screenshots?: Array<{ src: string; alt: string; caption?: string }>;
}

export interface Category {
  id: CategoryId;
  title: string;
  description?: string;
  icon?: string;
  subcategories?: Subcategory[];
}

export interface Subcategory {
  id: SubcategoryId;
  title: string;
  articles: Article[];
}

export interface AcademyState {
  isOpen: boolean;
  currentArticleId: string | null;
  searchQuery: string;
}

export interface AcademyContextValue {
  isOpen: boolean;
  currentArticleId: string | null;
  searchQuery: string;
  openArticle: (articleId?: string) => void;
  close: () => void;
  setSearchQuery: (query: string) => void;
}












