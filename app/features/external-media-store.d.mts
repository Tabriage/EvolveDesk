export type ExternalMediaInfo = {
  sourceKey: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  fingerprint: string;
  boundAt: string;
  fullHash: string;
  fullHashAt: string;
  relocatedAt: string;
};

export type ExternalMediaHealthStatus = "ready" | "permission" | "changed" | "missing" | "orphaned";
export type ExternalMediaHealth = ExternalMediaInfo & {
  status: ExternalMediaHealthStatus;
  permission: "granted" | "prompt" | "denied" | "unknown";
  checkedAt: string;
  detail: string;
};

export type ExternalMediaRelocationProgress = {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  processedBytes: number;
  totalBytes: number;
};

export type ExternalMediaRelocationResult = {
  matched: Array<{ sourceKey: string; name: string; method: "sample" | "full" }>;
  unresolvedSourceKeys: string[];
  unmatchedFiles: string[];
};

export type ExternalMediaDuplicateReport = {
  hashedRecords: number;
  duplicateRecords: number;
  groups: Array<{ fullHash: string; size: number; records: Array<{ sourceKey: string; name: string }> }>;
};

export const EXTERNAL_MEDIA_INDEX_CHANGED_EVENT: "evolve-desk-external-media-changed";
export function supportsExternalMediaHandles(): boolean;
export function createExternalMediaFingerprint(file: File): Promise<string>;
export function createExternalMediaRecord(sourceKey: string, file: File, handle: FileSystemFileHandle, boundAt?: string): Promise<ExternalMediaInfo & { recordVersion: number; handle: FileSystemFileHandle; sampleBytes: number }>;
export function verifyExternalMediaFile(record: ExternalMediaInfo, file: File): Promise<boolean>;
export function saveExternalMediaHandle(sourceKey: string, handle: FileSystemFileHandle): Promise<ExternalMediaInfo>;
export function listExternalMediaInfo(): Promise<ExternalMediaInfo[]>;
export function loadExternalMediaInfo(sourceKey: string): Promise<ExternalMediaInfo | null>;
export function scanExternalMediaIndex(validSourceKeys?: string[]): Promise<ExternalMediaHealth[]>;
export function openExternalMediaFile(sourceKey: string): Promise<{ file: File; info: ExternalMediaInfo }>;
export function calculateExternalMediaFullHash(sourceKey: string, onProgress?: (processedBytes: number, totalBytes: number) => void, control?: { signal?: AbortSignal; waitIfPaused?: () => Promise<void> }): Promise<ExternalMediaInfo>;
export function createExternalMediaDuplicateReport(records: ExternalMediaInfo[]): ExternalMediaDuplicateReport;
export function planExternalMediaRelocations(
  records: Array<Pick<ExternalMediaInfo, "sourceKey" | "name" | "size" | "lastModified" | "fingerprint" | "fullHash">>,
  candidates: Array<{ candidateId: string; name: string; size: number; lastModified: number; fingerprint: string; fullHash: string }>,
): { matches: Array<{ sourceKey: string; candidateId: string; method: "sample" | "full" }>; unresolvedSourceKeys: string[]; unmatchedCandidateIds: string[] };
export function relocateExternalMediaHandles(sourceKeys: string[], handles: FileSystemFileHandle[], onProgress?: (progress: ExternalMediaRelocationProgress) => void): Promise<ExternalMediaRelocationResult>;
export function removeExternalMediaHandles(sourceKeys: string[]): Promise<number>;
