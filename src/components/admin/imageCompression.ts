// Pure parts of the ImagePicker compression, kept apart from the canvas code
// so the tests can run them.

export interface CompressionPass {
  /** Longest side of the output, in pixels. */
  maxDimension: number;
  /** JPEG quality, 0 to 1. */
  quality: number;
}

/** Default target for a data URL: fits in a Firestore document with the other fields. */
export const DEFAULT_IMAGE_MAX_CHARS = 700_000;

const DEFAULT_PASSES: CompressionPass[] = [
  { maxDimension: 1024, quality: 0.82 },
  { maxDimension: 800, quality: 0.7 },
  { maxDimension: 640, quality: 0.55 }
];

// For a smaller target (site photos, about 250 KB). The steps go down slowly
// so a photo keeps as much detail as the target permits.
const SMALL_TARGET_PASSES: CompressionPass[] = [
  { maxDimension: 1024, quality: 0.82 },
  { maxDimension: 1024, quality: 0.7 },
  { maxDimension: 800, quality: 0.7 },
  { maxDimension: 800, quality: 0.6 },
  { maxDimension: 640, quality: 0.55 },
  { maxDimension: 560, quality: 0.5 },
  { maxDimension: 480, quality: 0.5 }
];

/** The passes to try, in sequence, until the data URL is at or below maxChars. */
export function compressionPasses(maxChars: number = DEFAULT_IMAGE_MAX_CHARS): CompressionPass[] {
  return maxChars < DEFAULT_IMAGE_MAX_CHARS ? SMALL_TARGET_PASSES : DEFAULT_PASSES;
}

/** Output size for a pass. Keeps the ratio and does not make an image larger. */
export function scaledSize(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  const longest = Math.max(width, height, 1);
  const scale = Math.min(1, maxDimension / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}
