import { useState, type ReactNode } from 'react';
import ProductPrefOptions from './ProductPrefOptions';
import ProfileSheet from './ProfileSheet';
import { effectiveProductPref, productPrefLabel, type ProductPref } from '../lib/productPreference';
import { chooseProductPref } from '../services/productPrefSync';
import { useAppStore } from '../store/useAppStore';

interface ProductPrefSettingProps {
  userId: string | null;
  /** Renders the Profile menu row; valueLabel is "Hepsi" while nothing is chosen. */
  children: (row: { valueLabel: string; open: () => void }) => ReactNode;
}

/** Profile "Ürün tercihi": the row plus a sheet with the same three options as the choice screen. */
export default function ProductPrefSetting({ userId, children }: ProductPrefSettingProps) {
  const productPref = useAppStore((state) => state.productPref);
  const [open, setOpen] = useState(false);
  const select = (pref: ProductPref): void => {
    setOpen(false);
    if (userId) void chooseProductPref(userId, pref);
  };
  return (
    <>
      {children({ valueLabel: productPrefLabel(productPref), open: () => setOpen(true) })}
      <ProfileSheet visible={open} title="Ürün tercihi" onClose={() => setOpen(false)}>
        <ProductPrefOptions value={effectiveProductPref(productPref)} onSelect={select} disabled={!userId} />
      </ProfileSheet>
    </>
  );
}
