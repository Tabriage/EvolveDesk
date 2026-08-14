import { MAX_SYNC_PACKET_BYTES, inspectSyncPacketText } from "./sync-core.mjs";

export const REMOTE_TRANSPORT_ID = "http-conditional-object";
export const MAX_REMOTE_TOKEN_CHARS = 8_192;

const STRONG_ETAG = /^"[^"\r\n]{1,510}"$/;

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function normalizeObjectUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("请输入有效的远端对象 URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("远端对象必须使用 HTTPS；只有本机回环地址可以使用 HTTP");
  }
  if (url.username || url.password || url.hash) throw new Error("远端对象 URL 不能包含账号、密码或片段");
  return url.toString();
}

function normalizeToken(value) {
  const token = String(value || "").trim();
  if (token.length > MAX_REMOTE_TOKEN_CHARS || /[\r\n]/.test(token)) throw new Error("访问令牌格式无效");
  return token;
}

function strongEtag(value) {
  const etag = String(value || "").trim();
  return STRONG_ETAG.test(etag) ? etag : "";
}

function requestHeaders(token, additions = {}) {
  const headers = { Accept: "application/json", ...additions };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function requestOptions(method, token, additions = {}) {
  return {
    method,
    headers: requestHeaders(token, additions.headers),
    ...(additions.body === undefined ? {} : { body: additions.body }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  };
}

async function performFetch(fetchImpl, objectUrl, options) {
  try {
    return await fetchImpl(objectUrl, options);
  } catch {
    throw new Error("无法访问远端对象，请检查地址、CORS 与网络权限");
  }
}

function requireAllowedStatus(response, allowed, action) {
  if (response.status === 401 || response.status === 403) throw new Error("远端对象拒绝访问，请检查当前页面内存中的访问令牌");
  if (!allowed.includes(response.status)) throw new Error(`远端对象${action}失败（HTTP ${response.status}）`);
}

export function normalizeRemoteTransportConfig(value) {
  return {
    objectUrl: normalizeObjectUrl(value?.objectUrl),
    bearerToken: normalizeToken(value?.bearerToken),
  };
}

export function createHttpSyncTransport(configValue, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持远端对象传输");
  const config = normalizeRemoteTransportConfig(configValue);

  async function read(channelIdValue) {
    const channelId = String(channelIdValue || "").trim();
    if (!channelId) throw new Error("请先选择同步空间");
    const response = await performFetch(fetchImpl, config.objectUrl, requestOptions("GET", config.bearerToken));
    if (response.status === 404) return { exists: false, packetText: null, revisionId: "", validator: "" };
    requireAllowedStatus(response, [200], "读取");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_SYNC_PACKET_BYTES) throw new Error("远端同步包超过 132MB 上限");
    const packetText = await response.text();
    if (byteLength(packetText) > MAX_SYNC_PACKET_BYTES) throw new Error("远端同步包超过 132MB 上限");
    const packet = inspectSyncPacketText(packetText);
    if (packet.channelId !== channelId) throw new Error("远端对象中的同步包不属于当前同步空间");
    return {
      exists: true,
      packetText,
      revisionId: packet.revisionId,
      validator: strongEtag(response.headers.get("etag")),
    };
  }

  async function write(channelIdValue, expectedRevisionIdValue, packetText) {
    const channelId = String(channelIdValue || "").trim();
    const expectedRevisionId = String(expectedRevisionIdValue || "").trim();
    const packet = inspectSyncPacketText(packetText);
    if (!channelId || packet.channelId !== channelId) throw new Error("待发布同步包不属于当前同步空间");
    if (packet.parentRevisionId !== expectedRevisionId && !packet.mergeParentRevisionIds?.includes(expectedRevisionId)) {
      throw new Error("待发布同步包没有认证当前预期父版本");
    }

    const current = await read(channelId);
    if (current.revisionId !== expectedRevisionId) {
      return { written: false, conflict: true, currentRevisionId: current.revisionId, validator: current.validator };
    }
    if (current.exists && !current.validator) throw new Error("远端对象未提供强 ETag，已拒绝可能覆盖其他设备的写入");

    const conditionalHeader = current.exists ? { "If-Match": current.validator } : { "If-None-Match": "*" };
    const response = await performFetch(fetchImpl, config.objectUrl, requestOptions("PUT", config.bearerToken, {
      headers: { "Content-Type": "application/json;charset=utf-8", ...conditionalHeader },
      body: packetText,
    }));
    if (response.status === 409 || response.status === 412) {
      const latest = await read(channelId);
      return { written: false, conflict: true, currentRevisionId: latest.revisionId, validator: latest.validator };
    }
    requireAllowedStatus(response, [200, 201, 204], "写入");

    const confirmed = await read(channelId);
    if (confirmed.revisionId !== packet.revisionId) throw new Error("远端对象没有返回刚发布的版本，已保留本地版本头不变");
    if (!confirmed.validator) throw new Error("远端对象未提供强 ETag，无法确认后续条件写入能力");
    return { written: true, conflict: false, currentRevisionId: confirmed.revisionId, validator: confirmed.validator };
  }

  return {
    id: REMOTE_TRANSPORT_ID,
    label: "HTTP 条件对象",
    objectUrl: config.objectUrl,
    read,
    write,
  };
}
