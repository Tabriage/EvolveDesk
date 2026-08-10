import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_VIDEO_SECONDS = 2 * 60 * 60;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const MAX_VISUAL_FRAMES = 8;
const MAX_FRAME_BYTES = 450 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIRECTORY = join(ROOT, ".evolve", "models");
const UPLOAD_DIRECTORY = join(ROOT, ".evolve", "uploads");
const MODEL_PATH = join(MODEL_DIRECTORY, "ggml-base.bin");
const MODEL_PART_PATH = `${MODEL_PATH}.part`;
const MODEL_MAX_BYTES = 160 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
const pendingUploads = new Map();
const ALLOWED_MEDIA_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mkv", ".mov", ".mp3", ".mp4", ".ogg", ".wav", ".webm"]);

export const WHISPER_MODEL = Object.freeze({
  name: "Whisper base（多语言）",
  filename: "ggml-base.bin",
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  bytes: 147_951_465,
  sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
});
const SUPPORTED_HOSTS = new Map([
  ["www.youtube.com", "youtube"],
  ["youtube.com", "youtube"],
  ["m.youtube.com", "youtube"],
  ["music.youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["www.bilibili.com", "bilibili"],
  ["bilibili.com", "bilibili"],
  ["m.bilibili.com", "bilibili"],
  ["b23.tv", "bilibili"],
  ["www.xiaohongshu.com", "xiaohongshu"],
  ["xiaohongshu.com", "xiaohongshu"],
  ["xhslink.com", "xiaohongshu"],
  ["www.douyin.com", "douyin"],
  ["douyin.com", "douyin"],
  ["v.douyin.com", "douyin"],
]);

function cleanText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function validateLocalMediaUpload({ name, type, size, contentLength } = {}) {
  let decodedName = String(name || "");
  try {
    decodedName = decodeURIComponent(decodedName);
  } catch {
    throw new Error("本地文件名编码无效");
  }
  const originalName = basename(decodedName.replaceAll("\\", "/")).slice(0, 180);
  const extension = extname(originalName).toLowerCase();
  const declaredSize = Number(size || contentLength || 0);
  const mimeType = cleanText(type, 120).toLowerCase();
  if (!originalName || !ALLOWED_MEDIA_EXTENSIONS.has(extension)) {
    throw new Error("请选择 MP4、MOV、MKV、WebM、MP3、M4A、WAV、OGG、AAC 或 FLAC 文件");
  }
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) throw new Error("本地文件大小无效");
  if (declaredSize > MAX_AUDIO_BYTES) throw new Error("本地音视频超过 500MB 安全上限");
  if (mimeType && !mimeType.startsWith("audio/") && !mimeType.startsWith("video/") && mimeType !== "application/octet-stream") {
    throw new Error("文件类型不是受支持的音频或视频");
  }
  return { originalName, extension, declaredSize, mimeType };
}

async function cleanupExpiredUploads(now = Date.now()) {
  await mkdir(UPLOAD_DIRECTORY, { recursive: true, mode: 0o700 });
  const entries = await readdir(UPLOAD_DIRECTORY, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(UPLOAD_DIRECTORY, entry.name);
    const details = await stat(path).catch(() => null);
    if (details && now - details.mtimeMs > UPLOAD_TTL_MS) await rm(path, { force: true }).catch(() => {});
  }
  for (const [id, upload] of pendingUploads) {
    if (now - upload.createdAt > UPLOAD_TTL_MS) pendingUploads.delete(id);
  }
}

async function probeLocalMedia(path) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:format_tags=title,artist,author:stream=codec_type,width,height",
      "-of", "json",
      path,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const payload = JSON.parse(stdout || "{}");
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    if (!streams.some((stream) => stream?.codec_type === "audio" || stream?.codec_type === "video")) {
      throw new Error("文件中没有可读取的音频或视频轨道");
    }
    const duration = Number(payload.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取本地媒体时长");
    if (duration > MAX_VIDEO_SECONDS) throw new Error("本地音视频最长支持两小时");
    const videoStream = streams.find((stream) => stream?.codec_type === "video");
    return {
      duration: Math.round(duration),
      title: cleanText(payload.format?.tags?.title, 240),
      author: cleanText(payload.format?.tags?.artist || payload.format?.tags?.author, 120),
      hasVideo: Boolean(videoStream),
      width: Number.isFinite(videoStream?.width) ? Math.max(0, Math.round(videoStream.width)) : 0,
      height: Number.isFinite(videoStream?.height) ? Math.max(0, Math.round(videoStream.height)) : 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("缺少 ffprobe，请先安装 ffmpeg");
    const detail = cleanText(error?.stderr || error?.message, 260);
    throw new Error(detail ? `无法读取本地媒体：${detail}` : "无法读取本地媒体");
  }
}

export async function importLocalMedia(stream, metadata) {
  const file = validateLocalMediaUpload(metadata);
  await cleanupExpiredUploads();
  const id = randomUUID();
  const path = join(UPLOAD_DIRECTORY, `${id}${file.extension}`);
  let handle;
  let receivedBytes = 0;
  try {
    handle = await open(path, "wx", 0o600);
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > MAX_AUDIO_BYTES || receivedBytes > file.declaredSize) throw new Error("接收到的本地文件超过声明大小或安全上限");
      await handle.write(buffer);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (receivedBytes !== file.declaredSize) throw new Error("本地文件传输不完整，请重新选择文件");
    const probed = await probeLocalMedia(path);
    pendingUploads.set(id, { path, createdAt: Date.now(), originalName: file.originalName });
    return {
      inputUrl: `local-media://${id}`,
      url: `local-media://${id}`,
      platform: "local",
      sourceId: id,
      title: probed.title || file.originalName.replace(/\.[^.]+$/, "") || "本地媒体",
      author: probed.author,
      description: `本地文件 · ${file.originalName}`,
      duration: probed.duration,
      thumbnail: "",
      hasVideo: probed.hasVideo,
      width: probed.width,
      height: probed.height,
      transcript: null,
      transcriptSource: "unavailable",
      importedAt: new Date().toISOString(),
      uploadId: id,
      localFileName: file.originalName,
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
    throw error;
  }
}

export function whisperModelIntegrity(size, sha1) {
  if (size !== WHISPER_MODEL.bytes) return { ready: false, reason: "size-mismatch" };
  if (String(sha1 || "").toLowerCase() !== WHISPER_MODEL.sha1) return { ready: false, reason: "checksum-mismatch" };
  return { ready: true, reason: null };
}

async function fileSha1(path) {
  const hash = createHash("sha1");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function modelStatus() {
  try {
    const details = await stat(MODEL_PATH);
    if (!details.isFile()) return { ready: false, bytes: 0, reason: "not-a-file" };
    if (details.size !== WHISPER_MODEL.bytes) {
      return { ready: false, bytes: details.size, reason: "size-mismatch" };
    }
    const sha1 = await fileSha1(MODEL_PATH);
    const integrity = whisperModelIntegrity(details.size, sha1);
    return { ...integrity, bytes: details.size };
  } catch (error) {
    if (error?.code === "ENOENT") return { ready: false, bytes: 0, reason: "missing" };
    return { ready: false, bytes: 0, reason: "unreadable" };
  }
}

async function commandAvailable(command, args) {
  try {
    await execFileAsync(command, args, { timeout: 8_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function visualRuntimeStatus() {
  const [ffmpeg, ytDlp, tesseract] = await Promise.all([
    commandAvailable("ffmpeg", ["-version"]),
    commandAvailable("yt-dlp", ["--version"]),
    commandAvailable("tesseract", ["--version"]),
  ]);
  let ocrLanguages = [];
  if (tesseract) {
    try {
      const { stdout } = await execFileAsync("tesseract", ["--list-langs"], { timeout: 8_000, maxBuffer: 512 * 1024, windowsHide: true });
      const available = new Set(String(stdout || "").split(/\r?\n/).map((line) => line.trim()));
      ocrLanguages = ["chi_sim", "chi_tra", "eng"].filter((language) => available.has(language));
    } catch {
      ocrLanguages = [];
    }
  }
  return {
    ffmpeg,
    ytDlp,
    tesseract,
    ocrLanguages,
    visualReady: ffmpeg,
    ocrReady: tesseract && ocrLanguages.length > 0,
  };
}

export async function transcriptionStatus() {
  const [whisper, visualRuntime, model] = await Promise.all([
    commandAvailable("whisper-cli", ["--version"]),
    visualRuntimeStatus(),
    modelStatus(),
  ]);
  return {
    runtime: {
      whisper,
      ...visualRuntime,
      ready: whisper && visualRuntime.ffmpeg && visualRuntime.ytDlp,
      localReady: whisper && visualRuntime.ffmpeg,
    },
    model: {
      name: WHISPER_MODEL.name,
      filename: WHISPER_MODEL.filename,
      expectedBytes: WHISPER_MODEL.bytes,
      ...model,
    },
  };
}

export async function downloadWhisperModel() {
  const current = await modelStatus();
  if (current.ready) return transcriptionStatus();
  await mkdir(MODEL_DIRECTORY, { recursive: true });
  await rm(MODEL_PART_PATH, { force: true }).catch(() => {});
  let handle;
  try {
    const response = await fetch(WHISPER_MODEL.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`模型源返回 ${response.status}`);
    const declaredBytes = Number(response.headers.get("content-length") || 0);
    if (declaredBytes && declaredBytes !== WHISPER_MODEL.bytes) throw new Error("模型源返回了异常文件大小");

    handle = await open(MODEL_PART_PATH, "w", 0o600);
    const hash = createHash("sha1");
    let bytes = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MODEL_MAX_BYTES) throw new Error("模型下载超过安全大小上限");
      hash.update(buffer);
      await handle.write(buffer);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;

    const integrity = whisperModelIntegrity(bytes, hash.digest("hex"));
    if (!integrity.ready) throw new Error(integrity.reason === "checksum-mismatch" ? "模型校验失败" : "模型文件大小不正确");
    await rename(MODEL_PART_PATH, MODEL_PATH);
    return transcriptionStatus();
  } catch (error) {
    const detail = cleanText(error?.message, 240);
    throw new Error(detail ? `模型下载失败：${detail}` : "模型下载失败");
  } finally {
    await handle?.close().catch(() => {});
    await rm(MODEL_PART_PATH, { force: true }).catch(() => {});
  }
}

export function parseVideoUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("请输入完整的视频链接");
  }
  if (url.protocol !== "https:") throw new Error("视频链接必须使用 HTTPS");
  const platform = SUPPORTED_HOSTS.get(url.hostname.toLowerCase());
  if (!platform) throw new Error("当前支持 B站、YouTube、小红书和抖音链接");
  url.username = "";
  url.password = "";
  url.hash = "";
  return { url: url.toString(), platform };
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function shortTimestamp(value) {
  const normalized = value.replace(",", ".").split(".")[0];
  return normalized.startsWith("00:") ? normalized.slice(3) : normalized;
}

export function vttToTranscript(vtt) {
  const blocks = String(vtt || "").replace(/^\uFEFF/, "").split(/\r?\n\r?\n+/);
  const cues = [];
  let lastText = "";
  let totalChars = 0;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => /(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s+-->/.test(line));
    if (timingIndex < 0) continue;
    const start = lines[timingIndex].match(/((?:\d{2}:)?\d{2}:\d{2})[.,]\d{3}/)?.[1] || "";
    const text = decodeEntities(lines.slice(timingIndex + 1).join(" "))
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]+}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text === lastText) continue;
    lastText = text;
    const cue = `[${shortTimestamp(start)}] ${text}`;
    cues.push(cue);
    totalChars += cue.length + 1;
    if (totalChars >= MAX_TRANSCRIPT_CHARS) break;
  }
  return cues.join("\n").slice(0, MAX_TRANSCRIPT_CHARS);
}

function subtitleScore(name) {
  const lower = name.toLowerCase();
  if (/zh[-_.]hans|zh[-_.]cn/.test(lower)) return 0;
  if (/zh[-_.]hant|zh[-_.]tw/.test(lower)) return 1;
  if (/\.zh(?:[-_.]|\.)/.test(lower)) return 2;
  if (/\.en(?:[-_.]|\.)/.test(lower)) return 3;
  return 10;
}

async function findSubtitle(directory) {
  const names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".vtt"));
  names.sort((left, right) => subtitleScore(left) - subtitleScore(right) || left.localeCompare(right));
  return names[0] ? join(directory, names[0]) : null;
}

function parseMetadata(stdout) {
  const lines = String(stdout || "").trim().split(/\r?\n/).reverse();
  const jsonLine = lines.find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("视频平台没有返回可读取的元数据");
  return JSON.parse(jsonLine);
}

export async function importVideo(value) {
  const target = parseVideoUrl(value);
  const temporary = await mkdtemp(join(tmpdir(), "evolve-video-"));
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--no-playlist",
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs", "zh-Hans,zh-Hant,zh-CN,zh-TW,zh.*,en.*,en",
      "--sub-format", "vtt/best",
      "--convert-subs", "vtt",
      "--paths", temporary,
      "--output", "%(id)s.%(ext)s",
      "--dump-single-json",
      "--no-warnings",
      "--socket-timeout", "20",
      "--retries", "2",
      target.url,
    ], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    const metadata = parseMetadata(stdout);
    const subtitlePath = await findSubtitle(temporary);
    const transcript = subtitlePath ? vttToTranscript(await readFile(subtitlePath, "utf8")) : "";
    return {
      inputUrl: target.url,
      url: cleanText(metadata.webpage_url || target.url, 2_000),
      platform: target.platform,
      sourceId: cleanText(metadata.id, 120),
      title: cleanText(metadata.title, 240) || "未命名视频",
      author: cleanText(metadata.uploader || metadata.channel || metadata.creator, 120),
      description: cleanText(metadata.description, 800),
      duration: Number.isFinite(metadata.duration) ? Math.max(0, Math.round(metadata.duration)) : null,
      thumbnail: cleanText(metadata.thumbnail, 2_000),
      hasVideo: true,
      width: Number.isFinite(metadata.width) ? Math.max(0, Math.round(metadata.width)) : 0,
      height: Number.isFinite(metadata.height) ? Math.max(0, Math.round(metadata.height)) : 0,
      transcript: transcript || null,
      transcriptSource: transcript ? "platform" : "unavailable",
      importedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("视频导入超过两分钟，已停止本次处理");
    const detail = cleanText(error?.stderr || error?.message, 360);
    throw new Error(detail ? `视频导入失败：${detail}` : "视频导入失败");
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

function frameTimestamp(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function selectVisualTimestamps(duration, candidates = [], maxFrames = MAX_VISUAL_FRAMES) {
  const safeDuration = Math.min(MAX_VIDEO_SECONDS, Math.max(1, Math.round(Number(duration) || 1)));
  const limit = Math.min(MAX_VISUAL_FRAMES, Math.max(1, Math.round(Number(maxFrames) || MAX_VISUAL_FRAMES)));
  const latest = Math.max(0, safeDuration - 1);
  const uniqueCandidates = [...new Set((Array.isArray(candidates) ? candidates : [])
    .map((value) => Math.min(latest, Math.max(0, Math.round(Number(value)))))
    .filter((value) => Number.isFinite(value)))]
    .sort((left, right) => left - right);
  const selected = [];
  if (uniqueCandidates.length) {
    const count = Math.min(limit, uniqueCandidates.length);
    for (let index = 0; index < count; index += 1) {
      const position = count === 1 ? 0 : Math.round(index * (uniqueCandidates.length - 1) / (count - 1));
      selected.push(uniqueCandidates[position]);
    }
  }
  const fallbackFractions = [0.06, 0.18, 0.32, 0.48, 0.64, 0.8, 0.94, 0.99];
  for (const fraction of fallbackFractions) {
    if (selected.length >= limit) break;
    const value = Math.min(latest, Math.max(0, Math.round(safeDuration * fraction)));
    if (!selected.some((current) => Math.abs(current - value) < Math.min(3, safeDuration / 10))) selected.push(value);
  }
  if (!selected.length) selected.push(0);
  return [...new Set(selected)].sort((left, right) => left - right).slice(0, limit);
}

async function extractFrameImage(sourcePath, outputPath, seconds) {
  const render = async (width, quality) => {
    await rm(outputPath, { force: true }).catch(() => {});
    await execFileAsync("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-ss", String(seconds),
      "-i", sourcePath,
      "-map", "0:v:0",
      "-frames:v", "1",
      "-vf", `scale=${width}:-2:force_original_aspect_ratio=decrease`,
      "-q:v", String(quality),
      outputPath,
    ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  };
  await render(960, 5);
  let image = await readFile(outputPath);
  if (image.length > MAX_FRAME_BYTES) {
    await render(720, 8);
    image = await readFile(outputPath);
  }
  if (!image.length || image.length > MAX_FRAME_BYTES) throw new Error("关键帧图片超过本地安全上限");
  return image;
}

async function recognizeFrameText(path, languages) {
  if (!languages.length) return "";
  try {
    const { stdout } = await execFileAsync("tesseract", [path, "stdout", "-l", languages.join("+"), "--psm", "6"], {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return cleanText(stdout, 1_200);
  } catch {
    return "";
  }
}

async function extractVisualFramesFromPath(sourcePath, candidates = []) {
  const runtime = await visualRuntimeStatus();
  if (!runtime.ffmpeg) throw new Error("缺少 ffmpeg，无法抽取视频画面");
  const probed = await probeLocalMedia(sourcePath);
  if (!probed.hasVideo) throw new Error("这个文件只有音频轨道，没有可抽取的画面");
  const timestamps = selectVisualTimestamps(probed.duration, candidates);
  const temporary = await mkdtemp(join(tmpdir(), "evolve-frames-"));
  const frames = [];
  const seenHashes = new Set();
  try {
    for (const seconds of timestamps) {
      const path = join(temporary, `frame-${String(seconds).padStart(5, "0")}.jpg`);
      const image = await extractFrameImage(sourcePath, path, seconds);
      const hash = createHash("sha256").update(image).digest("hex");
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const ocrText = runtime.ocrReady ? await recognizeFrameText(path, runtime.ocrLanguages) : "";
      frames.push({
        id: `frame-${seconds}-${hash.slice(0, 8)}`,
        seconds,
        timestamp: frameTimestamp(seconds),
        ocrText,
        imageDataUrl: `data:image/jpeg;base64,${image.toString("base64")}`,
      });
    }
    if (!frames.length) throw new Error("没有从视频中抽取到可用画面");
    return {
      frames,
      ocr: {
        available: runtime.ocrReady,
        languages: runtime.ocrLanguages,
      },
      duration: probed.duration,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadedVideoPath(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const source = entries.find((entry) => entry.isFile() && entry.name.startsWith("source.") && !entry.name.endsWith(".part"));
  if (!source) throw new Error("视频平台没有返回可读取的画面文件");
  const path = join(directory, source.name);
  const details = await stat(path);
  if (!details.size) throw new Error("下载到的视频为空");
  if (details.size > MAX_AUDIO_BYTES) throw new Error("视频文件超过 500MB 安全上限");
  return path;
}

export async function extractVideoVisualEvidence(value, candidates = []) {
  const target = parseVideoUrl(value);
  const runtime = await visualRuntimeStatus();
  if (!runtime.ytDlp) throw new Error("缺少 yt-dlp，无法读取视频画面");
  if (!runtime.ffmpeg) throw new Error("缺少 ffmpeg，无法抽取视频画面");
  const temporary = await mkdtemp(join(tmpdir(), "evolve-visual-"));
  try {
    await execFileAsync("yt-dlp", [
      "--no-playlist",
      "--format", "bestvideo[height<=720]/best[height<=720]/best",
      "--match-filter", `duration <= ${MAX_VIDEO_SECONDS}`,
      "--max-filesize", "500M",
      "--paths", temporary,
      "--output", "source.%(ext)s",
      "--no-warnings",
      "--socket-timeout", "20",
      "--retries", "2",
      target.url,
    ], { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return await extractVisualFramesFromPath(await downloadedVideoPath(temporary), candidates);
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("画面抽取超时，已清理临时视频");
    const detail = cleanText(error?.stderr || error?.message, 360);
    throw new Error(detail ? `画面抽取失败：${detail}` : "画面抽取失败");
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function extractLocalVisualEvidence(uploadId, candidates = []) {
  const id = String(uploadId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("本地文件标识无效，请重新选择文件");
  await cleanupExpiredUploads();
  const upload = pendingUploads.get(id);
  if (!upload) throw new Error("临时文件已经失效，请重新选择本地文件");
  return extractVisualFramesFromPath(upload.path, candidates);
}

async function downloadedAudioPath(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const audio = entries.find((entry) => entry.isFile() && entry.name.startsWith("source.") && !entry.name.endsWith(".part"));
  if (!audio) throw new Error("视频平台没有返回可转录的音频");
  const path = join(directory, audio.name);
  const details = await stat(path);
  if (!details.size) throw new Error("下载到的音频为空");
  if (details.size > MAX_AUDIO_BYTES) throw new Error("视频音频超过 500MB 安全上限");
  return path;
}

async function transcribeMediaPath(sourcePath) {
  const temporary = await mkdtemp(join(tmpdir(), "evolve-transcribe-"));
  const wavePath = join(temporary, "audio.wav");
  const outputPath = join(temporary, "transcript");
  try {
    await execFileAsync("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", sourcePath,
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      wavePath,
    ], {
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    await execFileAsync("whisper-cli", [
      "-m", MODEL_PATH,
      "-f", wavePath,
      "-l", "auto",
      "-ovtt",
      "-of", outputPath,
      "-np",
    ], {
      timeout: 30 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const transcript = vttToTranscript(await readFile(`${outputPath}.vtt`, "utf8"));
    if (transcript.length < 20) throw new Error("本地转录没有生成足够的可读文本");
    return {
      transcript,
      transcriptSource: "local-whisper",
      model: WHISPER_MODEL.name,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function transcribeVideo(value) {
  const target = parseVideoUrl(value);
  const status = await transcriptionStatus();
  if (!status.runtime.ytDlp) throw new Error("缺少 yt-dlp，无法读取视频音频");
  if (!status.runtime.ffmpeg) throw new Error("缺少 ffmpeg，无法转换本地音频");
  if (!status.runtime.whisper) throw new Error("缺少 whisper-cli，请先安装 whisper-cpp");
  if (!status.model.ready) throw new Error("本地 Whisper 模型尚未就绪，请先明确下载模型");

  const temporary = await mkdtemp(join(tmpdir(), "evolve-transcribe-"));
  try {
    await execFileAsync("yt-dlp", [
      "--no-playlist",
      "--format", "bestaudio/best",
      "--match-filter", `duration <= ${MAX_VIDEO_SECONDS}`,
      "--max-filesize", "500M",
      "--paths", temporary,
      "--output", "source.%(ext)s",
      "--no-warnings",
      "--socket-timeout", "20",
      "--retries", "2",
      target.url,
    ], {
      timeout: 10 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    const sourcePath = await downloadedAudioPath(temporary);
    return await transcribeMediaPath(sourcePath);
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("本地转录超时，已清理临时音频");
    const detail = cleanText(error?.stderr || error?.message, 360);
    throw new Error(detail ? `本地转录失败：${detail}` : "本地转录失败");
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function transcribeLocalMedia(uploadId) {
  const id = String(uploadId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("本地文件标识无效，请重新选择文件");
  const status = await transcriptionStatus();
  if (!status.runtime.ffmpeg) throw new Error("缺少 ffmpeg，无法转换本地音频");
  if (!status.runtime.whisper) throw new Error("缺少 whisper-cli，请先安装 whisper-cpp");
  if (!status.model.ready) throw new Error("本地 Whisper 模型尚未就绪，请先明确下载模型");
  await cleanupExpiredUploads();
  const upload = pendingUploads.get(id);
  if (!upload) throw new Error("临时文件已经失效，请重新选择本地文件");
  try {
    return await transcribeMediaPath(upload.path);
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("本地转录超时，已清理临时文件");
    const detail = cleanText(error?.stderr || error?.message, 360);
    throw new Error(detail ? `本地转录失败：${detail}` : "本地转录失败");
  } finally {
    pendingUploads.delete(id);
    await rm(upload.path, { force: true }).catch(() => {});
  }
}

export async function discardLocalMedia(uploadId) {
  const id = String(uploadId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const upload = pendingUploads.get(id);
  pendingUploads.delete(id);
  if (!upload) return false;
  await rm(upload.path, { force: true }).catch(() => {});
  return true;
}
