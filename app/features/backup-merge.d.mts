import type { BackupSources, BackupSummary } from "./backup-core.mjs";
import type { DeviceProof, SyncChannel, SyncIdentity, SyncPublicDevice } from "./sync-core.mjs";
import type { WorkbenchState } from "./workbench-core.mjs";

export type BackupMergeChoice = "local" | "incoming";
export type BackupMergeFieldConflict = {
  key: string;
  path: string[];
  label: string;
  baseValue: unknown;
  localValue: unknown;
  incomingValue: unknown;
  localState: "存在" | "不存在";
  incomingState: "存在" | "不存在";
};
export type BackupMergeEntry = {
  key: string;
  categoryKey: string;
  categoryLabel: string;
  objectId: string;
  title: string;
  kind: "unchanged" | "local" | "incoming" | "merged" | "conflict";
  defaultChoice: BackupMergeChoice;
  resolution: "object" | "fields";
  fieldConflicts: BackupMergeFieldConflict[];
  mergedValue: unknown;
  autoLocalFields: number;
  autoIncomingFields: number;
  conflictCount: number;
  baseState: "存在" | "不存在";
  localState: "存在" | "不存在";
  incomingState: "存在" | "不存在";
  baseValue: unknown;
  localValue: unknown;
  incomingValue: unknown;
};

export type BackupMergeRow = {
  key: string;
  label: string;
  total: number;
  changed: number;
  conflicts: number;
  local: number;
  incoming: number;
  merged: number;
};

export type BackupMergePreview = {
  baseWorkspace: WorkbenchState;
  localWorkspace: WorkbenchState;
  incomingWorkspace: WorkbenchState;
  baseSources: BackupSources;
  localSources: BackupSources;
  incomingSources: BackupSources;
  groups: Array<{ spec: { key: string; label: string; path: string[]; idKey?: string }; target: "workspace" | "workspace-singleton" | "sources"; entries: BackupMergeEntry[] }>;
  rows: BackupMergeRow[];
  entries: BackupMergeEntry[];
  conflictCount: number;
  conflictKeys: string[];
  autoLocalCount: number;
  autoIncomingCount: number;
  autoFieldMergedCount: number;
};

export type BackupMergeDecisionReceipt = {
  format: "evolve-desk.merge-decision";
  formatVersion: 2;
  receiptId: string;
  createdAt: string;
  context: { baseRevisionId: string; localRevisionId: string; incomingRevisionId: string; sourceChecksum: string };
  manifest: { algorithm: "SHA-256"; conflictSetHash: string; conflictCount: number };
  totals: { conflictDecisions: number; autoLocalObjects: number; autoIncomingObjects: number; fieldMergedObjects: number };
  decisions: Array<
    | { categoryKey: string; objectId: string; resolution: "fields"; fields: Array<{ path: string[]; choice: BackupMergeChoice }> }
    | { categoryKey: string; objectId: string; resolution: "object"; choice: BackupMergeChoice }
  >;
  integrity: { algorithm: "SHA-256"; digest: string };
};

export type SignedBackupMergeDecisionReceipt = Omit<BackupMergeDecisionReceipt, "formatVersion" | "context"> & {
  formatVersion: 3;
  context: BackupMergeDecisionReceipt["context"] & { channelId: string };
  signer: SyncPublicDevice;
  proof: DeviceProof;
};
export type LegacyBackupMergeDecisionReceipt = Omit<BackupMergeDecisionReceipt, "formatVersion" | "receiptId" | "manifest" | "integrity"> & { formatVersion: 1 };
export type AnyBackupMergeDecisionReceipt = SignedBackupMergeDecisionReceipt | BackupMergeDecisionReceipt | LegacyBackupMergeDecisionReceipt;
export type BackupMergeDecisionInspection = {
  receipt: AnyBackupMergeDecisionReceipt;
  sealed: boolean;
  signed: boolean;
  signatureValid: boolean;
  signer: SyncPublicDevice | null;
  digest: string;
  conflictDecisions: number;
  objectDecisions: number;
  categoryCount: number;
};
export type BackupMergeDecisionComparison = {
  matches: boolean;
  contextMatches: boolean;
  conflictSetMatches: boolean;
  reasons: string[];
  expectedConflictDecisions: number;
  receiptConflictDecisions: number;
};
export type BackupMergeDecisionTrustAssessment = {
  signed: boolean;
  signatureValid: boolean;
  trusted: boolean;
  channelKnown: boolean;
  channelLabel: string;
  channelRetired: boolean;
  signer: SyncPublicDevice | null;
  reason: string;
};

export const MAX_MERGE_DECISION_RECEIPT_BYTES: number;

export function createBackupMergePreview(
  baseWorkspace: WorkbenchState,
  localWorkspace: WorkbenchState,
  incomingWorkspace: WorkbenchState,
  baseSources?: BackupSources,
  localSources?: BackupSources,
  incomingSources?: BackupSources,
): BackupMergePreview;
export function applyBackupMerge(preview: BackupMergePreview, choices?: Record<string, BackupMergeChoice>): { workspace: WorkbenchState; sources: BackupSources; summary: BackupSummary };
export function applyBackupMergeChoiceBatch(
  preview: BackupMergePreview,
  choices: Record<string, BackupMergeChoice>,
  keys: string[],
  choice: BackupMergeChoice,
): { choices: Record<string, BackupMergeChoice>; appliedKeys: string[] };
export function createBackupMergeDecisionReceipt(
  preview: BackupMergePreview,
  choices?: Record<string, BackupMergeChoice>,
  context?: Partial<BackupMergeDecisionReceipt["context"]>,
  createdAt?: string,
): Promise<BackupMergeDecisionReceipt>;
export function createSignedBackupMergeDecisionReceipt(
  preview: BackupMergePreview,
  choices: Record<string, BackupMergeChoice>,
  context: BackupMergeDecisionReceipt["context"] & { channelId: string },
  identity: SyncIdentity,
  createdAt?: string,
): Promise<SignedBackupMergeDecisionReceipt>;
export function serializeBackupMergeDecisionReceipt(receipt: AnyBackupMergeDecisionReceipt): string;
export function inspectBackupMergeDecisionReceiptText(raw: string): Promise<BackupMergeDecisionInspection>;
export function compareBackupMergeDecisionReceiptToPreview(receipt: AnyBackupMergeDecisionReceipt, preview: BackupMergePreview, context: BackupMergeDecisionReceipt["context"] & { channelId?: string }): Promise<BackupMergeDecisionComparison>;
export function assessBackupMergeDecisionReceiptTrust(receipt: AnyBackupMergeDecisionReceipt, channels?: SyncChannel[]): Promise<BackupMergeDecisionTrustAssessment>;
