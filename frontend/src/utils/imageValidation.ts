export const MAX_BYTES = 12_582_912;
export const MAX_PIXELS = 20_000_000;
export interface SelectedImage { file: File; width: number; height: number; url: string }
export function validateFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a JPEG, PNG, or WebP image.';
  if (!file.size) return 'This file is empty. Choose another image.';
  if (file.size > MAX_BYTES) return 'The image must be 12 MiB or smaller.';
  return null;
}
export function validateDimensions(width: number, height: number): string | null {
  if (width < 64 || height < 64) return 'The image must be at least 64 × 64 pixels.';
  if (width * height > MAX_PIXELS) return 'The image exceeds 20 megapixels. Choose a smaller original image and recalibrate it.';
  return null;
}
export async function inspectImage(file: File): Promise<SelectedImage> {
  const error = validateFile(file);
  if (error) throw new Error(error);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const dimensionError = validateDimensions(image.naturalWidth, image.naturalHeight);
    if (dimensionError) throw new Error(dimensionError);
    return { file, url, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (error instanceof Error && error.message.includes('image')) throw error;
    throw new Error('This image could not be decoded. Choose a valid JPEG, PNG, or WebP.');
  }
}
export function optionalNumber(raw: string, kind: 'scale' | 'pitch'): { value?: number; error?: string } {
  if (!raw.trim()) return {};
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: 'Enter a finite number.' };
  if (kind === 'scale' && (value <= 0 || value > 1000)) return { error: 'Scale must be greater than 0 and at most 1000.' };
  if (kind === 'pitch' && (value < -90 || value > 90)) return { error: 'Pitch must be between −90° and 90°.' };
  return { value };
}
