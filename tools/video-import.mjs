import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_VIDEO_SECONDS = 2 * 60 * 60;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIRECTORY = join(ROOT, ".evolve", "models");
const MODEL_PATH = join(MODEL_DIRECTORY, "ggml-base.bin");
const MODEL_PART_PATH = `${MODEL_PATH}.part`;
const MODEL_MAX_BYTES = 160 * 1024 * 1024;

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

export async function transcriptionStatus() {
  const [whisper, ffmpeg, ytDlp, model] = await Promise.all([
    commandAvailable("whisper-cli", ["--version"]),
    commandAvailable("ffmpeg", ["-version"]),
    commandAvailable("yt-dlp", ["--version"]),
    modelStatus(),
  ]);
  return {
    runtime: { whisper, ffmpeg, ytDlp, ready: whisper && ffmpeg && ytDlp },
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

export async function transcribeVideo(value) {
  const target = parseVideoUrl(value);
  const status = await transcriptionStatus();
  if (!status.runtime.ytDlp) throw new Error("缺少 yt-dlp，无法读取视频音频");
  if (!status.runtime.ffmpeg) throw new Error("缺少 ffmpeg，无法转换本地音频");
  if (!status.runtime.whisper) throw new Error("缺少 whisper-cli，请先安装 whisper-cpp");
  if (!status.model.ready) throw new Error("本地 Whisper 模型尚未就绪，请先明确下载模型");

  const temporary = await mkdtemp(join(tmpdir(), "evolve-transcribe-"));
  const wavePath = join(temporary, "audio.wav");
  const outputPath = join(temporary, "transcript");
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
  } catch (error) {
    if (error?.killed || error?.signal === "SIGTERM") throw new Error("本地转录超时，已清理临时音频");
    const detail = cleanText(error?.stderr || error?.message, 360);
    throw new Error(detail ? `本地转录失败：${detail}` : "本地转录失败");
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}
