export function saveTranscript(sourceKey: string, value: string): Promise<boolean>;
export function loadTranscript(sourceKey: string): Promise<string>;
export function saveVisualFrames(sourceKey: string, frames: Array<{ id: string; imageDataUrl: string }>): Promise<boolean>;
export function loadVisualFrames(sourceKey: string): Promise<Array<{ id: string; imageDataUrl: string }>>;
export type SourceArchive = {
  transcripts: Array<{ sourceKey: string; transcript: string; updatedAt: string }>;
  visualFrames: Array<{ sourceKey: string; frames: Array<{ id: string; imageDataUrl: string }>; updatedAt: string }>;
};
export function exportSourceArchive(): Promise<SourceArchive>;
export function replaceSourceArchive(value: SourceArchive): Promise<boolean>;
