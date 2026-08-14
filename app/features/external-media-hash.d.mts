export const MAX_EXTERNAL_MEDIA_BYTES: number;
export type ExternalMediaHashControl = { signal?: AbortSignal; waitIfPaused?: () => Promise<void> };
export function createExternalMediaFullHash(file: File, onProgress?: (processedBytes: number, totalBytes: number) => void, control?: ExternalMediaHashControl): Promise<string>;
