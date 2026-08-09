const MAX_TRANSCRIPT_CHARS = 100_000;
const TARGET_SEGMENT_CHARS = 720;
const MAX_SEGMENTS = 180;

function cleanText(value, limit = MAX_TRANSCRIPT_CHARS) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function timestampToSeconds(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  if (minutes >= 60 || seconds >= 60) return null;
  return Math.round(hours * 3600 + minutes * 60 + seconds);
}

function timestampLabel(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function splitPlainText(text) {
  const pieces = text.split(/(?<=[。！？!?；;])\s*|\n{2,}/).map((item) => cleanText(item)).filter(Boolean);
  return pieces.length ? pieces : [cleanText(text)].filter(Boolean);
}

export function segmentTranscript(value) {
  const transcript = String(value || "").slice(0, MAX_TRANSCRIPT_CHARS).replace(/\r/g, "");
  if (!transcript.trim()) return [];

  const cues = [];
  let inheritedSeconds = null;
  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\s*(.*)$/);
    if (match) {
      inheritedSeconds = timestampToSeconds(match[1]);
      const text = cleanText(match[2]);
      if (text) cues.push({ seconds: inheritedSeconds, text });
    } else {
      for (const text of splitPlainText(line)) cues.push({ seconds: inheritedSeconds, text });
    }
  }

  const segments = [];
  let current = null;
  const flush = () => {
    if (!current?.text) return;
    segments.push({
      id: `T${segments.length + 1}`,
      timestamp: timestampLabel(current.seconds),
      seconds: current.seconds,
      text: cleanText(current.text, TARGET_SEGMENT_CHARS * 2),
    });
    current = null;
  };

  for (const cue of cues) {
    if (segments.length >= MAX_SEGMENTS) break;
    if (!current) {
      current = { seconds: cue.seconds, text: cue.text };
      continue;
    }
    const crossesTimeWindow = cue.seconds !== null && current.seconds !== null && cue.seconds - current.seconds >= 30;
    if (crossesTimeWindow || current.text.length + cue.text.length + 1 > TARGET_SEGMENT_CHARS) flush();
    if (!current) current = { seconds: cue.seconds, text: cue.text };
    else current.text += ` ${cue.text}`;
  }
  if (segments.length < MAX_SEGMENTS) flush();
  return segments;
}

function queryTokens(value) {
  const normalized = cleanText(value, 600).toLocaleLowerCase("zh-CN");
  const latin = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const chineseRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const chinese = [];
  for (const run of chineseRuns) {
    if (run.length <= 4) chinese.push(run);
    for (let index = 0; index < run.length - 1; index += 1) chinese.push(run.slice(index, index + 2));
  }
  return [...new Set([...latin, ...chinese])].slice(0, 32);
}

export function searchTranscript(value, query, limit = 8) {
  const segments = Array.isArray(value) ? value : segmentTranscript(value);
  const normalizedQuery = cleanText(query, 600).toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return segments.slice(0, Math.max(1, limit)).map((segment) => ({ ...segment, score: 0 }));
  const tokens = queryTokens(normalizedQuery);
  return segments
    .map((segment, index) => {
      const text = segment.text.toLocaleLowerCase("zh-CN");
      let score = text.includes(normalizedQuery) ? 20 : 0;
      for (const token of tokens) {
        const occurrences = text.split(token).length - 1;
        score += Math.min(occurrences, 4) * (token.length > 2 ? 4 : 2);
      }
      return { ...segment, score, index };
    })
    .filter((segment) => segment.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map(({ id, timestamp, seconds, text, score }) => ({ id, timestamp, seconds, text, score }));
}

export function selectTranscriptEvidence(value, question, limit = 12, charLimit = 18_000) {
  const segments = segmentTranscript(value);
  if (!segments.length) return [];
  const ranked = searchTranscript(segments, question, Math.max(4, limit));
  const selected = new Map(ranked.map((segment) => [segment.id, segment]));
  const structuralIndexes = [0, Math.floor(segments.length / 3), Math.floor(segments.length * 2 / 3), segments.length - 1];
  for (const index of structuralIndexes) {
    const segment = segments[index];
    if (segment) selected.set(segment.id, segment);
  }
  let characters = 0;
  return [...selected.values()]
    .sort((left, right) => segments.findIndex((segment) => segment.id === left.id) - segments.findIndex((segment) => segment.id === right.id))
    .filter((segment) => {
      if (characters + segment.text.length > charLimit) return false;
      characters += segment.text.length;
      return true;
    })
    .slice(0, Math.max(1, limit));
}

export function videoTimestampUrl(value, seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null;
  if (safeSeconds === null) return String(value || "");
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return String(value || "");
  }
  if (url.protocol !== "https:") return url.toString();
  if (url.hostname === "youtu.be" || url.hostname.endsWith("youtube.com") || url.hostname.endsWith("bilibili.com")) {
    url.searchParams.set("t", String(safeSeconds));
  }
  return url.toString();
}
