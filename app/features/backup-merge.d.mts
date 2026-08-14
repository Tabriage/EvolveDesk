import type { BackupSources, BackupSummary } from "./backup-core.mjs";
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
  formatVersion: 1;
  createdAt: string;
  context: { baseRevisionId: string; localRevisionId: string; incomingRevisionId: string; sourceChecksum: string };
  totals: { conflictDecisions: number; autoLocalObjects: number; autoIncomingObjects: number; fieldMergedObjects: number };
  decisions: Array<
    | { categoryKey: string; objectId: string; resolution: "fields"; fields: Array<{ path: string[]; choice: BackupMergeChoice }> }
    | { categoryKey: string; objectId: string; resolution: "object"; choice: BackupMergeChoice }
  >;
};

export function createBackupMergePreview(
  baseWorkspace: WorkbenchState,
  localWorkspace: WorkbenchState,
  incomingWorkspace: WorkbenchState,
  baseSources?: BackupSources,
  localSources?: BackupSources,
  incomingSources?: BackupSources,
): BackupMergePreview;
export function applyBackupMerge(preview: BackupMergePreview, choices?: Record<string, BackupMergeChoice>): { workspace: WorkbenchState; sources: BackupSources; summary: BackupSummary };
export function createBackupMergeDecisionReceipt(
  preview: BackupMergePreview,
  choices?: Record<string, BackupMergeChoice>,
  context?: Partial<BackupMergeDecisionReceipt["context"]>,
  createdAt?: string,
): BackupMergeDecisionReceipt;
