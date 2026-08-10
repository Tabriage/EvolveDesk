export function saveTranscript(sourceKey: string, value: string): Promise<boolean>;
export function loadTranscript(sourceKey: string): Promise<string>;
export function saveVisualFrames(sourceKey: string, frames: Array<{ id: string; imageDataUrl: string }>): Promise<boolean>;
export function loadVisualFrames(sourceKey: string): Promise<Array<{ id: string; imageDataUrl: string }>>;
