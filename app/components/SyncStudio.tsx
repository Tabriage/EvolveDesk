"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createBackupEnvelope, serializeBackupEnvelope } from "../features/backup-core.mjs";
import type { BackupSources } from "../features/backup-core.mjs";
import {
  MAX_SYNC_CONTROL_BYTES,
  MAX_SYNC_PACKET_BYTES,
  acceptDeviceGrant,
  createDeviceGrant,
  createPairingRequest,
  createSyncChannel,
  createSyncPacket,
  decryptSyncPacket,
  formatDeviceFingerprint,
  inspectDeviceGrantText,
  inspectPairingRequestText,
  inspectSyncPacketText,
  serializeDeviceGrant,
  serializePairingRequest,
  serializeSyncPacket,
} from "../features/sync-core.mjs";
import type {
  DeviceGrant,
  PairingRequest,
  SyncChannel,
  SyncIdentity,
  SyncRevisionRelation,
} from "../features/sync-core.mjs";
import {
  SYNC_CHANNELS_CHANGED_EVENT,
  listSyncChannels,
  loadOrCreateSyncIdentity,
  renameSyncIdentity,
  saveSyncChannel,
  setSyncChannelHead,
} from "../features/sync-device-store.mjs";
import type { WorkbenchState } from "../features/workbench-core.mjs";

export type StagedSyncBackup = {
  channelId: string;
  revisionId: string;
  parentRevisionId: string;
  authorName: string;
  relation: SyncRevisionRelation;
  previousHeadRevisionId: string;
  previousLastPacketAt: string;
};

type SyncStudioProps = {
  state: WorkbenchState;
  sources: BackupSources;
  onStageBackup: (raw: string, fileName: string, fileBytes: number, sync: StagedSyncBackup) => Promise<void>;
};

type IncomingReceipt = {
  fileName: string;
  authorName: string;
  relation: SyncRevisionRelation;
  revisionId: string;
};

const relationLabels: Record<SyncRevisionRelation, string> = {
  initial: "首次收到",
  forward: "顺序后继",
  duplicate: "已处理版本",
  diverged: "发现版本分叉",
};

function defaultDeviceName() {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  if (/Mac/i.test(platform)) return "这台 Mac";
  if (/Win/i.test(platform)) return "这台 Windows 设备";
  if (/Linux/i.test(platform)) return "这台 Linux 设备";
  return "这台设备";
}

function fileStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").slice(0, 13);
}

function safeFilePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "workspace";
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readJsonFile(file: File, maxBytes: number, label: string) {
  if (file.size > maxBytes) throw new Error(`${label}超过大小上限`);
  return file.text();
}

export function SyncStudio({ state, sources, onStageBackup }: SyncStudioProps) {
  const pairingInput = useRef<HTMLInputElement>(null);
  const grantInput = useRef<HTMLInputElement>(null);
  const packetInput = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<SyncIdentity | null>(null);
  const [channels, setChannels] = useState<SyncChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [channelName, setChannelName] = useState("我的工作台");
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  const [pendingGrant, setPendingGrant] = useState<DeviceGrant | null>(null);
  const [incoming, setIncoming] = useState<IncomingReceipt | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("先确认这台设备的指纹；授权和传输都只在你明确操作时发生。 ");

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.channelId === selectedChannelId) || null,
    [channels, selectedChannelId],
  );

  useEffect(() => {
    let active = true;
    async function initialize() {
      const nextIdentity = await loadOrCreateSyncIdentity(defaultDeviceName());
      if (!nextIdentity) throw new Error("当前浏览器不支持 IndexedDB，无法保存不可导出的设备私钥");
      const nextChannels = await listSyncChannels();
      if (!active) return;
      setIdentity(nextIdentity);
      setDeviceName(nextIdentity.device.name);
      setChannels(nextChannels);
      setSelectedChannelId((current) => current || nextChannels[0]?.channelId || "");
    }
    async function refreshChannels() {
      const nextChannels = await listSyncChannels();
      if (active) setChannels(nextChannels);
    }
    void initialize().catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "无法打开本地设备密钥库");
    });
    const handleChannelsChanged = () => { void refreshChannels(); };
    globalThis.addEventListener(SYNC_CHANNELS_CHANGED_EVENT, handleChannelsChanged);
    return () => {
      active = false;
      globalThis.removeEventListener(SYNC_CHANNELS_CHANGED_EVENT, handleChannelsChanged);
    };
  }, []);

  function replaceChannel(channel: SyncChannel) {
    setChannels((current) => [...current.filter((item) => item.channelId !== channel.channelId), channel]);
    setSelectedChannelId(channel.channelId);
  }

  async function renameDevice() {
    if (!identity || deviceName.trim() === identity.device.name) return;
    setBusy("rename");
    try {
      const updated = await renameSyncIdentity(identity, deviceName);
      const renamedChannels = await Promise.all(channels.map(async (channel) => {
        const authorizedDevices = channel.authorizedDevices.map((device) => device.deviceId === updated.device.deviceId
          ? { ...device, name: updated.device.name }
          : device);
        return saveSyncChannel({ ...channel, authorizedDevices });
      }));
      setIdentity(updated);
      setDeviceName(updated.device.name);
      setChannels(renamedChannels);
      setMessage("设备名称已更新；公钥与指纹没有改变。 ");
    } catch (error) {
      setDeviceName(identity.device.name);
      setMessage(error instanceof Error ? error.message : "无法更新设备名称");
    } finally {
      setBusy("");
    }
  }

  async function makeChannel() {
    if (!identity) return;
    setBusy("channel");
    try {
      const channel = await createSyncChannel(identity, channelName);
      await saveSyncChannel(channel);
      replaceChannel(channel);
      setChannelName("我的工作台");
      setMessage("加密同步空间已创建。它还没有连接存储，也没有授权其他设备。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法创建同步空间");
    } finally {
      setBusy("");
    }
  }

  async function exportPairingRequest() {
    if (!identity) return;
    setBusy("request");
    try {
      const request = await createPairingRequest(identity);
      downloadText(serializePairingRequest(request), `evolve-device-request-${safeFilePart(identity.device.name)}-${fileStamp()}.json`);
      setMessage("授权请求已生成，24 小时内把它交给同步空间的创建设备，并当面核对指纹。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成设备授权请求");
    } finally {
      setBusy("");
    }
  }

  async function readPairingRequest(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("pairing");
    setPairing(null);
    try {
      const request = await inspectPairingRequestText(await readJsonFile(file, MAX_SYNC_CONTROL_BYTES, "设备授权请求"));
      if (request.device.deviceId === identity?.device.deviceId) throw new Error("这是当前设备自己的授权请求");
      setPairing(request);
      setMessage("授权请求已读取，尚未共享同步密钥。请与目标设备核对名称和完整指纹。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取设备授权请求");
    } finally {
      setBusy("");
    }
  }

  async function authorizePairing() {
    if (!identity || !selectedChannel || !pairing) return;
    setBusy("authorize");
    try {
      const result = await createDeviceGrant(selectedChannel, identity, pairing);
      await saveSyncChannel(result.channel);
      replaceChannel(result.channel);
      downloadText(serializeDeviceGrant(result.grant), `evolve-device-grant-${safeFilePart(pairing.device.name)}-${fileStamp()}.json`);
      setPairing(null);
      setMessage("设备已明确授权，回执已生成。只有目标设备的本地私钥能够解锁其中的同步密钥。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法授权这台设备");
    } finally {
      setBusy("");
    }
  }

  async function readGrant(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !identity) return;
    setBusy("grant");
    try {
      const grant = await inspectDeviceGrantText(await readJsonFile(file, MAX_SYNC_CONTROL_BYTES, "设备授权回执"));
      if (grant.recipient.deviceId !== identity.device.deviceId || grant.recipient.fingerprint !== identity.device.fingerprint) throw new Error("这份授权回执不属于当前设备");
      setPendingGrant(grant);
      setMessage("授权回执签名有效，但尚未加入同步空间。请核对创建设备的完整指纹。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取设备授权回执");
    } finally {
      setBusy("");
    }
  }

  async function acceptImportedGrant() {
    if (!identity || !pendingGrant) return;
    setBusy("accept-grant");
    try {
      const channel = await acceptDeviceGrant(pendingGrant, identity);
      await saveSyncChannel(channel);
      replaceChannel(channel);
      setPendingGrant(null);
      setMessage(`已加入“${channel.label}”；设备私钥和同步密钥只保存在本地 IndexedDB。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法接受设备授权回执");
    } finally {
      setBusy("");
    }
  }

  async function exportPacket() {
    if (!identity || !selectedChannel) return;
    setBusy("export");
    try {
      const backup = await createBackupEnvelope(state, sources);
      const packet = await createSyncPacket(serializeBackupEnvelope(backup), selectedChannel, identity);
      const serialized = serializeSyncPacket(packet);
      downloadText(serialized, `evolve-sync-${safeFilePart(selectedChannel.label)}-${fileStamp(new Date(packet.createdAt))}.json`);
      const updated = await setSyncChannelHead(selectedChannel.channelId, packet.revisionId, packet.createdAt);
      if (updated) replaceChannel(updated);
      setIncoming(null);
      setMessage("加密同步包已生成。存储位置只能看到认证版本头和密文，看不到工作台内容。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成加密同步包");
    } finally {
      setBusy("");
    }
  }

  async function readPacket(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("packet");
    setIncoming(null);
    try {
      const raw = await readJsonFile(file, MAX_SYNC_PACKET_BYTES, "加密同步包");
      const packet = inspectSyncPacketText(raw);
      const channel = channels.find((item) => item.channelId === packet.channelId);
      if (!channel) throw new Error("当前设备尚未加入这个同步空间，不能解锁该同步包");
      const opened = await decryptSyncPacket(packet, channel);
      if (opened.relation === "duplicate") throw new Error("这个同步版本已经是当前版本，无需重复恢复");
      await onStageBackup(opened.backupText, file.name, file.size, {
        channelId: channel.channelId,
        revisionId: packet.revisionId,
        parentRevisionId: packet.parentRevisionId,
        authorName: opened.author.name,
        relation: opened.relation,
        previousHeadRevisionId: channel.headRevisionId,
        previousLastPacketAt: channel.lastPacketAt,
      });
      replaceChannel(channel);
      setIncoming({ fileName: file.name, authorName: opened.author.name, relation: opened.relation, revisionId: packet.revisionId });
      setMessage(opened.relation === "diverged"
        ? "同步包已解锁，但版本链已经分叉。下方只展示整体替换预检，不会自动合并或写入。 "
        : "同步包已解锁并送入恢复预检；再次确认前，当前工作台没有变化。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取加密同步包");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="sync-studio">
      <header className="sync-heading">
        <div><span>ENCRYPTED TRANSIT / 可插拔传输层</span><h2>让密文移动，<em>不让存储接管你的工作台。</em></h2><p>当前先以文件作为传输适配器；网盘目录、U 盘或未来对象存储只负责搬运同一种不透明同步包。</p></div>
        <b><i /> USER-ARMED</b>
      </header>

      <div className="sync-status" role="status"><i className={busy ? "working" : ""} /><span>{message}</span><code>{busy ? "WORKING" : identity ? "KEYS LOCAL" : "NO KEYSTORE"}</code></div>

      <article className="device-passport">
        <div className="device-key-mark" aria-hidden="true"><span>ECDH</span><i /><i /><i /><i /><b>256</b></div>
        <div className="device-passport-copy"><span>THIS DEVICE / 本机身份证</span><label><input value={deviceName} maxLength={60} onChange={(event) => setDeviceName(event.target.value)} onBlur={() => void renameDevice()} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={!identity || Boolean(busy)} aria-label="设备名称" /></label><small>{identity ? identity.device.deviceId : "正在建立本地身份…"}</small></div>
        <div className="fingerprint-tape"><span>当面核对完整指纹</span><code>{identity ? formatDeviceFingerprint(identity.device.fingerprint) : "---- ---- ---- ----"}</code></div>
      </article>

      <div className="sync-channel-bar">
        <label><span>当前同步空间</span><select value={selectedChannelId} onChange={(event) => setSelectedChannelId(event.target.value)} disabled={Boolean(busy)}><option value="">尚未加入</option>{channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.label} · {channel.role === "owner" ? "创建设备" : "已授权设备"}</option>)}</select></label>
        <div><span>版本头</span><code>{selectedChannel?.headRevisionId ? `${selectedChannel.headRevisionId.slice(0, 19)}…` : "尚无本地版本"}</code></div>
        <div><span>已知设备</span><strong>{selectedChannel?.authorizedDevices.length || 0}</strong></div>
      </div>

      <div className="sync-flow-grid">
        <article className="sync-step-card create">
          <header><i>01</i><div><span>CREATE</span><strong>建立加密空间</strong></div></header>
          <p>第一台设备本地生成随机同步密钥；创建动作不会连接账户、网络或存储供应商。</p>
          <label><span>空间名称</span><input value={channelName} maxLength={60} onChange={(event) => setChannelName(event.target.value)} placeholder="例如：私人工作台" /></label>
          <button onClick={() => void makeChannel()} disabled={!identity || Boolean(busy)}>{busy === "channel" ? "正在生成本地密钥…" : "在这台设备创建"}<span>＋</span></button>
        </article>

        <article className="sync-step-card authorize">
          <header><i>02</i><div><span>AUTHORIZE</span><strong>授权另一台设备</strong></div></header>
          <p>目标设备先生成请求；创建设备核对指纹并确认后，才生成只能由目标私钥解锁的授权回执。</p>
          <div className="sync-button-pair"><button onClick={() => void exportPairingRequest()} disabled={!identity || Boolean(busy)}>生成本机请求 <span>↓</span></button><button onClick={() => grantInput.current?.click()} disabled={!identity || Boolean(busy)}>导入授权回执 <span>↙</span></button></div>
          <button className="secondary" onClick={() => pairingInput.current?.click()} disabled={!selectedChannel || selectedChannel.role !== "owner" || Boolean(busy)}>读取新设备请求 <span>→</span></button>
          <input ref={pairingInput} type="file" accept="application/json,.json" onChange={readPairingRequest} hidden />
          <input ref={grantInput} type="file" accept="application/json,.json" onChange={readGrant} hidden />
        </article>

        <article className="sync-step-card transfer">
          <header><i>03</i><div><span>TRANSFER</span><strong>搬运加密快照</strong></div></header>
          <p>同步包包含父版本和密文。导入后先检查来源与版本关系，再复用迁移舱的整体差异预检。</p>
          <div className="sync-chain-readout"><span><i /> AES-256-GCM</span><span><i /> AUTHENTICATED HEAD</span></div>
          <div className="sync-button-pair"><button onClick={() => void exportPacket()} disabled={!selectedChannel || !identity || Boolean(busy)}>{busy === "export" ? "正在封装…" : "生成同步包"} <span>↗</span></button><button onClick={() => packetInput.current?.click()} disabled={!channels.length || Boolean(busy)}>{busy === "packet" ? "正在解锁…" : "读取同步包"} <span>↙</span></button></div>
          <input ref={packetInput} type="file" accept="application/json,.json" onChange={readPacket} hidden />
        </article>
      </div>

      {pairing && (
        <article className="pairing-proof">
          <div><span>PAIRING PROOF / 尚未授权</span><h3>{pairing.device.name}</h3><p>请求有效至 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(pairing.expiresAt))}</p></div>
          <code>{formatDeviceFingerprint(pairing.device.fingerprint)}</code>
          <footer><button onClick={() => { setPairing(null); setMessage("已丢弃设备请求，没有共享同步密钥。 "); }} disabled={Boolean(busy)}>丢弃请求</button><button onClick={() => void authorizePairing()} disabled={!selectedChannel || selectedChannel.role !== "owner" || Boolean(busy)}>{busy === "authorize" ? "正在包装同步密钥…" : "指纹一致，授权设备"}<span>→</span></button></footer>
        </article>
      )}

      {pendingGrant && (
        <article className="pairing-proof grant-proof">
          <div><span>GRANT PROOF / 尚未加入</span><h3>{pendingGrant.channel.label}</h3><p>创建设备：{pendingGrant.grantor.name} · 回执签名已验证</p></div>
          <code>{formatDeviceFingerprint(pendingGrant.grantor.fingerprint)}</code>
          <footer><button onClick={() => { setPendingGrant(null); setMessage("已丢弃授权回执，没有保存同步密钥。 "); }} disabled={Boolean(busy)}>丢弃回执</button><button onClick={() => void acceptImportedGrant()} disabled={Boolean(busy)}>{busy === "accept-grant" ? "正在解锁同步密钥…" : "指纹一致，加入空间"}<span>→</span></button></footer>
        </article>
      )}

      {selectedChannel && (
        <div className="authorized-device-strip">
          <span>AUTHORIZED DEVICES</span>
          {selectedChannel.authorizedDevices.map((device) => <div key={device.deviceId} className={device.deviceId === identity?.device.deviceId ? "current" : ""}><i>{device.deviceId === selectedChannel.ownerDeviceId ? "O" : "D"}</i><strong>{device.name}</strong><code>{device.fingerprint.slice(0, 8).toUpperCase()}</code></div>)}
          <small>v1 采用创建设备逐台授权；撤销某台设备需要新建空间并重新授权剩余设备，避免把“从列表隐藏”伪装成密钥撤销。</small>
        </div>
      )}

      {incoming && <div className={`sync-incoming-receipt ${incoming.relation}`}><span>{relationLabels[incoming.relation]}</span><strong>{incoming.fileName}</strong><small>来自 {incoming.authorName} · {incoming.revisionId.slice(0, 20)}… · 已送入下方整体替换预检</small></div>}
    </section>
  );
}
