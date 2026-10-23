import { Platform } from 'react-native';
import * as FS from 'expo-file-system/legacy';
import { createUuid } from '../lib/analytics';
import { captureOwnerPublication } from '../lib/accountDeviceWork';
import { accountWriteBlockedNow, withAccountWriteGuard } from '../lib/accountWriteFence';
import { createOwnedFileUnderGuard } from './ownedDeviceFiles';
import type { WardrobeItem } from '../types/wardrobe';

// Development APK opt-in only. A release build cannot silently enable this path.
export const onDeviceCutoutEnabled = (): boolean =>
  __DEV__ && Platform.OS === 'android' && process.env.EXPO_PUBLIC_WARDROBE_ON_DEVICE_CUTOUT === 'true';

interface NativeResult {
  handle: string;
  preprocessingMs?: number;
  inferenceMs?: number;
  pngEncodeMs?: number;
  modelLoadMs?: number;
  totalMs?: number;
  sampledPssMaxKb?: number;
}
interface NativeCutout {
  isAvailable(): boolean;
  process(source: string, measure: boolean): Promise<NativeResult>;
  write(handle: string, destination: string): Promise<{bytes: number}>;
  release(handle: string): Promise<void>;
}
const failure = (code: string) => Object.assign(new Error('Cihazda arka plan işlemi tamamlanamadı. Orijinal korundu.'), {code});
function report(result: NativeResult): void {
  if (!__DEV__) return;
  const safe: Record<string, number | null | string> = { type: 'wardrobe_on_device_timing', peakMemoryBytes: null };
  for (const key of ['preprocessingMs', 'inferenceMs', 'pngEncodeMs', 'modelLoadMs', 'totalMs', 'sampledPssMaxKb'] as const) {
    const value = result[key];
    safe[key] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }
  try { console.info(JSON.stringify(safe)); } catch { /* Telemetry cannot change a file/journal operation. */ }
}

/** Enclosed by createWardrobeCutout's tracked workflow, including native release. */
export async function createOnDeviceWardrobeCutout(owner: string, item: WardrobeItem): Promise<string> {
  if (!onDeviceCutoutEnabled()) throw failure('CUTOUT_NATIVE_UNAVAILABLE');
  const current = captureOwnerPublication(owner);
  const directory = FS.documentDirectory && `${FS.documentDirectory}wardrobe/${encodeURIComponent(owner)}/`;
  const source = item.imageLocalUri ?? item.imageUrl;
  if (!directory || !source.startsWith(directory) || /[\\?#]|\/\.{1,2}(?:\/|$)|%2e|%2f|%5c/i.test(source))
    throw failure('CUTOUT_LOCAL_SOURCE_REQUIRED');
  // Lazy require is supported by Metro and Jest; OFF must not load native APIs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
  const native = requireOptionalNativeModule<NativeCutout>('VitrifyOnDeviceCutout');
  if (!native?.isAvailable()) throw failure('CUTOUT_NATIVE_UNAVAILABLE');
  if (!current() || accountWriteBlockedNow(owner)) throw failure('CUTOUT_OWNER_CHANGED');
  let result: NativeResult | undefined;
  try {
    // JPEG decode, EXIF, tensors, ONNX and PNG encode all live on a native worker.
    // No file is written before a durable ownership intent and a fresh fence check.
    result = await native.process(source, __DEV__);
    if (!result || typeof result.handle !== 'string' || !result.handle) throw failure('CUTOUT_NATIVE_RESULT_INVALID');
    report(result);
    const ready = result;
    return await withAccountWriteGuard(owner, async () => {
      if (!current()) throw failure('CUTOUT_OWNER_CHANGED');
      const uri = `${directory}${createUuid()}-cutout.png`;
      return createOwnedFileUnderGuard(owner, 'cutout', uri, async () => {
        await FS.makeDirectoryAsync(directory, { intermediates: true });
        const written = await native.write(ready.handle, uri);
        const info = await FS.getInfoAsync(uri);
        if (!info.exists || info.isDirectory || written.bytes < 33 || written.bytes > 12 * 1024 * 1024 || info.size !== written.bytes)
          throw failure('CUTOUT_NATIVE_WRITE_UNVERIFIED');
      });
    });
  } finally {
    // Await actual settlement, even across logout/deletion. Abort is not drain.
    if (result?.handle) await native.release(result.handle);
  }
}
