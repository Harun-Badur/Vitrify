import { recordDiscoverStage } from '../lib/discoverStageTiming';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Image, type ImageProps, type ImageLoadEventData } from 'expo-image';
import {
  getDiscoverImageFit,
  hasImageDimensions,
  type DiscoverImageSlot,
  type ImageDimensions,
} from '../lib/discoverImageFit';

interface DiscoverProductImageProps extends Omit<
  ImageProps,
  'source' | 'contentFit' | 'contentPosition'
> {
  uri: string;
  slot: DiscoverImageSlot;
}

interface LoadedDimensions {
  uri: string;
  size: ImageDimensions;
}

/** The clipping surface stays fixed; only the bitmap is fitted inside it. */
export default function DiscoverProductImage({
  uri,
  slot,
  style,
  onLoad,
  onLoadStart,
  onError,
  ...imageProps
}: DiscoverProductImageProps) {
  const [viewport, setViewport] = useState<ImageDimensions>({
    width: 0,
    height: 0,
  });
  const [loaded, setLoaded] = useState<LoadedDimensions | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const loadStart = useRef<{ uri: string; at: number } | null>(null);
  const currentUri = useRef(uri);
  useLayoutEffect(() => {
    currentUri.current = uri;
  }, [uri]);
  const fit =
    loaded?.uri === uri
      ? getDiscoverImageFit(loaded.size, viewport, slot)
      : null;

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((previous) =>
      previous.width === width && previous.height === height
        ? previous
        : { width, height },
    );
  }, []);

  const handleLoad = useCallback(
    (event: ImageLoadEventData): void => {
      if (currentUri.current !== uri) return;
      if (__DEV__ && loadStart.current?.uri === uri) { recordDiscoverStage(event.cacheType === 'memory' ? 'image.memory' : event.cacheType === 'none' ? 'image.none' : 'image.disk', performance.now() - loadStart.current.at); loadStart.current = null; }
      const size = { width: event.source.width, height: event.source.height };
      if (hasImageDimensions(size)) {
        setLoaded((previous) =>
          previous?.uri === uri &&
          previous.size.width === size.width &&
          previous.size.height === size.height
            ? previous
            : { uri, size },
        );
      }
      setFailedUri(null);
      onLoad?.(event);
    },
    [uri, onLoad],
  );

  const handleError = useCallback<NonNullable<ImageProps['onError']>>((event) => {
    if (currentUri.current !== uri) return;
    setFailedUri(uri);
    onError?.(event);
  }, [uri, onError]);

  return (
    <View style={[style, styles.frame]} onLayout={handleLayout}>
      {(!uri.trim() || failedUri === uri) ? (
        <View style={styles.unavailable} testID="discover-image-unavailable">
          <Text accessibilityRole="text">Görsel yüklenemedi</Text>
        </View>
      ) : null}
      <Image
        {...imageProps}
        key={uri}
        source={{ uri }}
        style={
          fit
            ? {
                position: 'absolute',
                width: fit.width,
                height: fit.height,
                left: fit.left,
                top: fit.top,
              }
            : StyleSheet.absoluteFill
        }
        contentFit="cover"
        contentPosition="center"
        onLoadStart={() => { if (__DEV__) loadStart.current = { uri, at: performance.now() }; onLoadStart?.(); }}
        onLoad={handleLoad}
        onError={handleError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  unavailable: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
});
