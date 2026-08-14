import type { BackupSources, BackupSummary } from "./backup-core.mjs";
import type { WorkbenchState } from "./workbench-core.mjs";

export type BackupMergeChoice = "local" | "incoming";
export type BackupMergeEntry = {
  key: string;
  categoryKey: string;
  categoryLabel: string;
  objectId: string;
  title: string;
  kind: "unchanged" | "local" | "incoming" | "conflict";
  defaultChoice: BackupMergeChoice;
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
  autoLocalCount: number;
  autoIncomingCount: number;
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
