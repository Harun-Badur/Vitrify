/** Matches the existing private model-photos bucket. Shared by app and Edge;
 * checked against actual prepared JPEG bytes, never the original picker size. */
export const MODEL_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const MODEL_PHOTO_TOO_LARGE = 'MODEL_PHOTO_TOO_LARGE';
export const MODEL_PHOTO_SIZE_MESSAGE = 'Model fotoğrafı en fazla 5 MiB olabilir. Daha küçük bir fotoğraf seç.';
