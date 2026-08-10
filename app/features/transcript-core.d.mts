export type TranscriptSegment = {
  id: string;
  timestamp: string | null;
  seconds: number | null;
  text: string;
};

export type TranscriptSearchResult = TranscriptSegment & { score: number };

export function timestampToSeconds(value: string): number | null;
export function segmentTranscript(value: string): TranscriptSegment[];
export function searchTranscript(value: string | TranscriptSegment[], query: string, limit?: number): TranscriptSearchResult[];
export function selectTranscriptEvidence(value: string, question: string, limit?: number, charLimit?: number): TranscriptSegment[];
export function selectVisualEvidence<T extends { id: string; seconds: number; ocrText?: string; modelText?: string; observation?: string; uncertainty?: string }>(value: T[], question: string, limit?: number): T[];
export function videoTimestampUrl(value: string, seconds: number | null): string;
