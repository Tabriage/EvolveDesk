import type { WorkbenchState } from "./workbench-core.mjs";

export const BACKUP_FORMAT: "evolve-desk.backup";
export const BACKUP_FORMAT_VERSION: 1;
export const MAX_BACKUP_BYTES: number;
export const CURRENT_WORKSPACE_VERSION: 11;

export type BackupTranscript = { sourceKey: string; transcript: string; updatedAt: string };
export type BackupVisualFrames = { sourceKey: string; frames: Array<{ id: string; imageDataUrl: string }>; updatedAt: string };
export type BackupSources = { transcripts: BackupTranscript[]; visualFrames: BackupVisualFrames[] };
export type BackupSummary = {
  workspaceVersion: number;
  modules: Record<string, number>;
  objectCount: number;
  transcriptCount: number;
  transcriptChars: number;
  visualSourceCount: number;
  frameCount: number;
  frameBytes: number;
};
export type BackupDiffRow = {
  key: string;
  label: string;
  current: number;
  incoming: number;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
};
export type BackupDiff = {
  rows: BackupDiffRow[];
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  currentVersion: number;
  incomingVersion: number;
};
export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  workspaceVersion: number;
  exportedAt: string;
  checksumAlgorithm: "SHA-256";
  checksum: string;
  payload: { workspace: WorkbenchState; sources: BackupSources };
};

export function sha256Text(value: string): Promise<string>;
export function sanitizeBackupSources(value: unknown, workspace: WorkbenchState): BackupSources;
export function summarizeBackup(workspace: WorkbenchState, sources?: BackupSources): BackupSummary;
export function compareBackupStates(current: WorkbenchState, incoming: WorkbenchState): BackupDiff;
export function createBackupEnvelope(workspace: WorkbenchState, sources: BackupSources, exportedAt?: string): Promise<BackupEnvelope>;
export function serializeBackupEnvelope(envelope: BackupEnvelope): string;
export function parseBackupText(raw: string): Promise<{
  envelope: BackupEnvelope;
  workspace: WorkbenchState;
  sources: BackupSources;
  summary: BackupSummary;
}>;
