import type { ExternalMediaInfo } from "./external-media-store.mjs";

export type ExternalMediaDuplicateAuditSummary = {
  indexedRecords: number;
  completeHashRecords: number;
  duplicateGroups: number;
  duplicateRecords: number;
  duplicateBytes: number;
};

export type ExternalMediaDuplicateAuditReceipt = {
  format: "evolve-desk.external-media-duplicate-audit";
  formatVersion: 1;
  auditId: string;
  createdAt: string;
  basis: { match: "size+full-sha256"; fullHashRequired: true; deletionPolicy: "none" };
  summary: ExternalMediaDuplicateAuditSummary;
  manifest: { algorithm: "SHA-256"; groupSetDigest: string; groupCount: number };
  integrity: { algorithm: "SHA-256"; digest: string };
};

export type ExternalMediaDuplicateAuditInspection = {
  receipt: ExternalMediaDuplicateAuditReceipt;
  digest: string;
  hasDuplicates: boolean;
  contentIdentifiersDisclosed: false;
};

export type ExternalMediaDuplicateAuditComparison = {
  matches: boolean;
  manifestMatches: boolean;
  summaryMatches: boolean;
  reasons: string[];
  localSummary: ExternalMediaDuplicateAuditSummary;
};

export const MAX_EXTERNAL_MEDIA_DUPLICATE_AUDIT_BYTES: number;
export function createExternalMediaDuplicateAudit(records: ExternalMediaInfo[], createdAt?: string): Promise<ExternalMediaDuplicateAuditReceipt>;
export function serializeExternalMediaDuplicateAudit(receipt: ExternalMediaDuplicateAuditReceipt): string;
export function inspectExternalMediaDuplicateAuditText(raw: string): Promise<ExternalMediaDuplicateAuditInspection>;
export function compareExternalMediaDuplicateAuditToIndex(receipt: ExternalMediaDuplicateAuditReceipt, records: ExternalMediaInfo[]): Promise<ExternalMediaDuplicateAuditComparison>;
