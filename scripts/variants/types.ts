export type VariantProvider = 'lcw' | 'flo';

export interface VariantColor {
  name: string;
  url: string;
  imageUrl?: string;
}

export interface VariantSize {
  label: string;
  inStock?: boolean;
}

export interface ParsedVariants {
  colors: VariantColor[];
  sizes: VariantSize[];
}

export interface VariantRecord {
  product_id: string;
  provider: string;
  product_url: string;
  fetched_at: string;
  colors: VariantColor[];
  sizes: VariantSize[];
  found: boolean;
  error?: string;
}

export type VariantParser = (html: string, pageUrl: string) => ParsedVariants;
