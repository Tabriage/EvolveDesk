export const MAX_EXTERNAL_MEDIA_BYTES: number;
export function createExternalMediaFullHash(file: File, onProgress?: (processedBytes: number, totalBytes: number) => void): Promise<string>;
