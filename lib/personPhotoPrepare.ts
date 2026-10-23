import { captureOwnerPublication, trackOwnerWork } from './accountDeviceWork';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import { withOwnedNativeFileUnderGuard } from '../services/ownedDeviceFiles';
import {
  PERSON_PHOTO_JPEG_QUALITY,
  PERSON_PHOTO_MAX_LONG_EDGE,
  isLowResolutionPersonPhoto,
  scaleLongEdge,
} from './vtonPersonImage';

export interface PersonPhotoSize {
  width: number;
  height: number;
}

export const getPersonPhotoSize = (uri: string): Promise<PersonPhotoSize> =>
  new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => {
        resolve({ width, height });
      },
      (error) => {
        reject(error);
      },
    );
  });

export const preparePersonJpegUri = async (uri: string): Promise<string> => {
  const size = await getPersonPhotoSize(uri);
  const next = scaleLongEdge(
    size.width,
    size.height,
    PERSON_PHOTO_MAX_LONG_EDGE,
  );
  const needsResize =
    next.width !== size.width || next.height !== size.height;
  const result = await ImageManipulator.manipulateAsync(
    uri,
    needsResize ? [{ resize: { width: next.width, height: next.height } }] : [],
    {
      compress: PERSON_PHOTO_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  return result.uri;
};

export const checkLowResolutionPersonPhoto = async (
  uri: string,
  owner?: string,
): Promise<boolean> => {
  if (owner && !captureOwnerPublication(owner)()) return false;
  try {
    const pending = getPersonPhotoSize(uri);
    const size = await (owner ? trackOwnerWork(owner, pending) : pending);
    return isLowResolutionPersonPhoto(size.width, size.height);
  } catch {
    return false;
  }
};

/** Owner-bound native temporary lifetime; callers hold the account write guard. */
export function withPreparedPersonJpeg<T>(owner: string, source: string, consume: (uri: string) => Promise<T>): Promise<T> {
  return withOwnedNativeFileUnderGuard(owner, source, () => preparePersonJpegUri(source), consume);
}
