export type ExternalMediaInfo = {
  sourceKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  boundAt: string;
};

export function supportsExternalMediaHandles(): boolean;
export function createExternalMediaFingerprint(file: File): Promise<string>;
export function createExternalMediaRecord(sourceKey: string, file: File, handle: FileSystemFileHandle, boundAt?: string): Promise<ExternalMediaInfo & { handle: FileSystemFileHandle; sampleBytes: number }>;
export function verifyExternalMediaFile(record: ExternalMediaInfo, file: File): Promise<boolean>;
export function saveExternalMediaHandle(sourceKey: string, handle: FileSystemFileHandle): Promise<ExternalMediaInfo>;
export function loadExternalMediaInfo(sourceKey: string): Promise<ExternalMediaInfo | null>;
export function openExternalMediaFile(sourceKey: string): Promise<{ file: File; info: ExternalMediaInfo }>;
