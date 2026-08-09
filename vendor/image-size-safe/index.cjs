"use strict";

// This intentionally small compatibility layer supports the web image formats
// vinext needs for local static assets. Every parser is bounded by input length
// and a hard iteration ceiling; container formats named in unresolved upstream
// infinite-loop advisories are rejected instead of parsed.

const MAX_STEPS = 4_096;
const supportedTypes = ["bmp", "gif", "ico", "jpg", "png", "pnm", "svg", "webp"];
let disabledTypes = new Set();

function bytes(input) {
  if (input instanceof Uint8Array) return input;
  throw new TypeError("imageSize expects a Uint8Array");
}

function requireRange(input, offset, length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > input.length) {
    throw new TypeError("truncated or invalid image data");
  }
}

function view(input, offset, length) {
  requireRange(input, offset, length);
  return new DataView(input.buffer, input.byteOffset + offset, length);
}

function ascii(input, start, end) {
  requireRange(input, start, end - start);
  return String.fromCharCode(...input.subarray(start, end));
}

function result(type, width, height, extra = {}) {
  if (disabledTypes.has(type)) throw new TypeError(`disabled file type: ${type}`);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError(`invalid ${type} dimensions`);
  }
  return { width: Math.round(width), height: Math.round(height), type, ...extra };
}

function png(input) {
  if (input.length < 24 || ascii(input, 1, 4) !== "PNG") return null;
  const data = view(input, 16, 8);
  return result("png", data.getUint32(0, false), data.getUint32(4, false));
}

function gif(input) {
  if (input.length < 10 || !/^GIF8[79]a$/.test(ascii(input, 0, 6))) return null;
  const data = view(input, 6, 4);
  return result("gif", data.getUint16(0, true), data.getUint16(2, true));
}

function bmp(input) {
  if (input.length < 26 || ascii(input, 0, 2) !== "BM") return null;
  const data = view(input, 18, 8);
  return result("bmp", data.getInt32(0, true), Math.abs(data.getInt32(4, true)));
}

function ico(input) {
  if (input.length < 6) return null;
  const header = view(input, 0, 6);
  const kind = header.getUint16(2, true);
  const count = header.getUint16(4, true);
  if (header.getUint16(0, true) !== 0 || (kind !== 1 && kind !== 2) || count < 1) return null;
  if (count > MAX_STEPS) throw new TypeError("invalid ico entry count");
  requireRange(input, 6, count * 16);
  const images = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    images.push({ width: input[offset] || 256, height: input[offset + 1] || 256 });
  }
  const largest = images.reduce((best, item) => item.width * item.height > best.width * best.height ? item : best);
  return result("ico", largest.width, largest.height, images.length > 1 ? { images } : {});
}

const JPEG_SIZE_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  let offset = 2;
  for (let steps = 0; offset < input.length && steps < MAX_STEPS; steps += 1) {
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    requireRange(input, offset, 1);
    const marker = input[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    requireRange(input, offset, 2);
    const segmentLength = view(input, offset, 2).getUint16(0, false);
    if (segmentLength < 2) throw new TypeError("invalid jpg segment length");
    requireRange(input, offset, segmentLength);
    if (JPEG_SIZE_MARKERS.has(marker)) {
      if (segmentLength < 7) throw new TypeError("invalid jpg size segment");
      const dimensions = view(input, offset + 3, 4);
      return result("jpg", dimensions.getUint16(2, false), dimensions.getUint16(0, false));
    }
    offset += segmentLength;
  }
  throw new TypeError("invalid jpg, no size marker found");
}

function readUInt24LE(input, offset) {
  requireRange(input, offset, 3);
  return input[offset] | input[offset + 1] << 8 | input[offset + 2] << 16;
}

function webp(input) {
  if (input.length < 30 || ascii(input, 0, 4) !== "RIFF" || ascii(input, 8, 12) !== "WEBP") return null;
  const subtype = ascii(input, 12, 16);
  if (subtype === "VP8X") return result("webp", readUInt24LE(input, 24) + 1, readUInt24LE(input, 27) + 1);
  if (subtype === "VP8 " && input[23] === 0x9d && input[24] === 0x01 && input[25] === 0x2a) {
    const dimensions = view(input, 26, 4);
    return result("webp", dimensions.getUint16(0, true) & 0x3fff, dimensions.getUint16(2, true) & 0x3fff);
  }
  if (subtype === "VP8L" && input[20] === 0x2f) {
    const width = 1 + input[21] + ((input[22] & 0x3f) << 8);
    const height = 1 + (input[22] >> 6) + (input[23] << 2) + ((input[24] & 0x0f) << 10);
    return result("webp", width, height);
  }
  throw new TypeError("unsupported or invalid webp encoding");
}

function svg(input) {
  const sample = new TextDecoder().decode(input.subarray(0, Math.min(input.length, 65_536)));
  const openTag = sample.match(/<svg\b[^>]*>/i)?.[0];
  if (!openTag) return null;
  const numeric = (name) => {
    const match = openTag.match(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return match ? Number(match[1]) : null;
  };
  let width = numeric("width");
  let height = numeric("height");
  const box = openTag.match(/\bviewBox\s*=\s*["']\s*[-+0-9.e]+[ ,]+[-+0-9.e]+[ ,]+([-+0-9.e]+)[ ,]+([-+0-9.e]+)/i);
  const boxWidth = box ? Number(box[1]) : null;
  const boxHeight = box ? Number(box[2]) : null;
  if (!width && height && boxWidth && boxHeight) width = height * boxWidth / boxHeight;
  if (!height && width && boxWidth && boxHeight) height = width * boxHeight / boxWidth;
  width ||= boxWidth;
  height ||= boxHeight;
  return result("svg", width, height);
}

function pnm(input) {
  if (input.length < 3 || input[0] !== 0x50 || input[1] < 0x31 || input[1] > 0x37) return null;
  const sample = new TextDecoder().decode(input.subarray(0, Math.min(input.length, 65_536))).replace(/#[^\r\n]*/g, " ");
  const values = sample.trim().split(/\s+/);
  if (values.length < 3) throw new TypeError("invalid pnm header");
  return result("pnm", Number(values[1]), Number(values[2]));
}

const parsers = [png, gif, bmp, ico, jpg, webp, svg, pnm];
function imageSize(rawInput) {
  const input = bytes(rawInput);
  // Explicitly reject the three container families in the upstream advisories.
  if ((input.length >= 4 && ascii(input, 0, 4) === "icns") || (input.length >= 8 && ascii(input, 4, 8) === "JXL ")) {
    throw new TypeError("unsupported container image format");
  }
  for (const parser of parsers) {
    const size = parser(input);
    if (size) return size;
  }
  throw new TypeError("unsupported file type");
}

function disableTypes(types) {
  disabledTypes = new Set(Array.isArray(types) ? types : []);
}

module.exports = { imageSize, default: imageSize, disableTypes, types: supportedTypes };
