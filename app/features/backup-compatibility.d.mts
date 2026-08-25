import type { BackupEnvelope, BackupSources, BackupSummary } from "./backup-core.mjs";
import type { WorkbenchState } from "./workbench-core.mjs";

export type CompatibilityChange = {
  key: string;
  label: string;
  before: number;
  after: number;
  dropped: number;
  normalized: number;
  severity: "info" | "warning";
};

export type BackupCompatibilityReport = {
  sourceVersion: number;
  targetVersion: 11;
  migrationRequired: boolean;
  status: "ready" | "migration" | "attention";
  droppedObjects: number;
  normalizedObjects: number;
  repairedReferences: number;
  droppedFrames: number;
  warningCount: number;
  changes: CompatibilityChange[];
};

export function createCompatibilityReport(
  rawWorkspace: unknown,
  rawSources: unknown,
  normalizedWorkspace: WorkbenchState,
  normalizedSources: BackupSources,
  sourceVersion: number,
): BackupCompatibilityReport;
export function inspectBackupCompatibility(raw: string): Promise<{
  parsed: { envelope: BackupEnvelope; workspace: WorkbenchState; sources: BackupSources; summary: BackupSummary };
  report: BackupCompatibilityReport;
}>;
