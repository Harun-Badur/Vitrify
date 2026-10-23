import type { WardrobeItem, WardrobeItemConfirmation } from '../types/wardrobe';
import { validWardrobeOriginalPath } from '../types/wardrobe';
export const WARDROBE_CUTOUT_V2_ENABLED=false;
export function itemCutoutV2Confirmed(owner:string,item:WardrobeItem,c?:WardrobeItemConfirmation): c is WardrobeItemConfirmation & {originalVersion:string} {
  return !!c && c.owner===owner && c.cutoutProtocol===2 && item.cutoutProtocol===2 &&
    /^[a-f0-9-]{36}$/i.test(c.cloudItemId) && c.originalPath===item.imageStoragePath &&
    validWardrobeOriginalPath(owner,c.originalPath) && c.originalPath.split('/')[1]===c.cloudItemId &&
    /^[a-f0-9]{64}$/.test(c.originalVersion??'') && c.originalVersion===item.originalVersion;
}
