"use client";

import { ChangeEvent, Dispatch, SetStateAction, useRef, useState } from "react";
import {
  MAX_SYNC_CONTROL_BYTES,
  MAX_SYNC_PACKET_BYTES,
  MAX_SYNC_RECOVERY_BYTES,
  SYNC_RECOVERY_KDF_ITERATIONS,
  acceptSyncOwnershipTransfer,
  createSyncRecoveryKit,
  formatDeviceFingerprint,
  inspectSyncOwnershipTransferText,
  inspectSyncPacketText,
  inspectSyncRecoveryKitText,
  recoverSyncOwnership,
  serializeSyncOwnershipTransfer,
  serializeSyncRecoveryKit,
} from "../features/sync-core.mjs";
import type { SyncChannel, SyncIdentity, SyncRecoveryKit, SyncRevisionRelation } from "../features/sync-core.mjs";
import { saveRotatedSyncChannels, saveSyncChannel } from "../features/sync-device-store.mjs";
import type { BackupSources } from "../features/backup-core.mjs";
import type { WorkbenchState } from "../features/workbench-core.mjs";

type StageSyncBackup = {
  channelId: string;
  revisionId: string;
  parentRevisionId: string;
  authorName: string;
  relation: SyncRevisionRelation;
  previousHeadRevisionId: string;
  previousLastPacketAt: string;
  previousMergeParentRevisionIds: string[];
};

type SyncRecoveryConsoleProps = {
  identity: SyncIdentity | null;
  channels: SyncChannel[];
  selectedChannel: SyncChannel | null;
  busy: string;
  setBusy: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  onRecoveredChannels: (retiredChannel: SyncChannel, nextChannel: SyncChannel) => void;
  onRetiredChannel: (channel: SyncChannel) => void;
  onStageBackup: (raw: string, fileName: string, fileBytes: number, sync: StageSyncBackup, mergeBase?: { workspace: WorkbenchState; sources: BackupSources }) => Promise<void>;
};

type RecoveryPacket = {
  raw: string;
  fileName: string;
  fileBytes: number;
  packet: ReturnType<typeof inspectSyncPacketText>;
};

type RecoveryCandidate = Awaited<ReturnType<typeof recoverSyncOwnership>>;

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

async function readBoundedFile(file: File, maxBytes: number, label: string) {
  if (file.size > maxBytes) throw new Error(`${label}超过大小上限`);
  return file.text();
}

export function SyncRecoveryConsole({
  identity,
  channels,
  selectedChannel,
  busy,
  setBusy,
  setMessage,
  onRecoveredChannels,
  onRetiredChannel,
  onStageBackup,
}: SyncRecoveryConsoleProps) {
  const recoveryInput = useRef<HTMLInputElement>(null);
  const recoveryPacketInput = useRef<HTMLInputElement>(null);
  const transferInput = useRef<HTMLInputElement>(null);
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState("");
  const [exportArmed, setExportArmed] = useState(false);
  const [recoveryKit, setRecoveryKit] = useState<{ envelope: SyncRecoveryKit; fileName: string } | null>(null);
  const [recoveryPacket, setRecoveryPacket] = useState<RecoveryPacket | null>(null);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState("");
  const [candidate, setCandidate] = useState<RecoveryCandidate | null>(null);

  const canExport = Boolean(selectedChannel && selectedChannel.role === "owner" && !selectedChannel.retiredAt);

  function resetExportArm() {
    setExportArmed(false);
  }

  async function exportRecoveryKit() {
    if (!identity || !selectedChannel || !canExport) return;
    if (exportPassphrase !== exportPassphraseConfirm) {
      setExportArmed(false);
      setMessage("两次恢复口令不一致；尚未生成任何恢复材料。 ");
      return;
    }
    if (!exportArmed) {
      setExportArmed(true);
      setMessage("已进入恢复材料确认状态：再次点击才会包装空间密钥与一次性恢复私钥。请把文件和口令分开离线保存。 ");
      return;
    }
    setBusy("recovery-export");
    try {
      const recovery = await createSyncRecoveryKit(selectedChannel, identity, exportPassphrase);
      downloadText(serializeSyncRecoveryKit(recovery), `evolve-owner-recovery-${safeFilePart(selectedChannel.label)}-${fileStamp(new Date(recovery.delegation.createdAt))}.json`);
      setExportPassphrase("");
      setExportPassphraseConfirm("");
      setExportArmed(false);
      setMessage("离线恢复材料已下载。它不含工作台数据；请另存最新加密同步包，并把恢复文件与口令分开放置。 ");
    } catch (error) {
      setExportArmed(false);
      setMessage(error instanceof Error ? error.message : "无法生成离线恢复材料");
    } finally {
      setBusy("");
    }
  }

  async function readRecoveryKit(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("recovery-read");
    setCandidate(null);
    try {
      const envelope = await inspectSyncRecoveryKitText(await readBoundedFile(file, MAX_SYNC_RECOVERY_BYTES, "离线恢复材料"));
      setRecoveryKit({ envelope, fileName: file.name });
      if (recoveryPacket && recoveryPacket.packet.channelId !== envelope.delegation.channel.channelId) setRecoveryPacket(null);
      setMessage("恢复材料的原创建设备签名有效，但加密密钥尚未解锁。再选择旧空间的最新同步包并输入恢复口令。 ");
    } catch (error) {
      setRecoveryKit(null);
      setMessage(error instanceof Error ? error.message : "无法读取离线恢复材料");
    } finally {
      setBusy("");
    }
  }

  async function readRecoveryPacket(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("recovery-packet");
    setCandidate(null);
    try {
      const raw = await readBoundedFile(file, MAX_SYNC_PACKET_BYTES, "恢复同步包");
      const packet = inspectSyncPacketText(raw);
      if (recoveryKit && packet.channelId !== recoveryKit.envelope.delegation.channel.channelId) throw new Error("同步包不属于当前恢复材料绑定的旧空间");
      setRecoveryPacket({ raw, fileName: file.name, fileBytes: file.size, packet });
      setMessage("恢复同步包已读取但尚未解密；准备恢复时会同时验证作者签名、空间密钥与版本时间。 ");
    } catch (error) {
      setRecoveryPacket(null);
      setMessage(error instanceof Error ? error.message : "无法读取恢复同步包");
    } finally {
      setBusy("");
    }
  }

  async function prepareRecovery() {
    if (!identity || !recoveryKit || !recoveryPacket) return;
    setBusy("recovery-prepare");
    setCandidate(null);
    try {
      const result = await recoverSyncOwnership(recoveryKit.envelope, recoveryPassphrase, identity, recoveryPacket.raw);
      const localOldChannel = channels.find((channel) => channel.channelId === result.transfer.previous.channelId);
      if (localOldChannel?.retiredAt) throw new Error("本机旧空间已经停用，不能用恢复材料建立另一条所有权分支");
      if (localOldChannel?.headRevisionId && localOldChannel.headRevisionId !== result.transfer.previous.headRevisionId) {
        throw new Error("本机旧空间版本头与恢复同步包不一致，拒绝建立可能回退的所有权分支");
      }
      if (localOldChannel) {
        const localDevices = localOldChannel.authorizedDevices.map((device) => `${device.deviceId}:${device.fingerprint}`).sort();
        const recoveryDevices = result.retiredChannel.authorizedDevices.map((device) => `${device.deviceId}:${device.fingerprint}`).sort();
        if (JSON.stringify(localDevices) !== JSON.stringify(recoveryDevices)) throw new Error("恢复材料的授权设备清单已过期，请使用设备清单变化后重新生成的材料");
      }
      setCandidate(result);
      setRecoveryPassphrase("");
      setMessage("恢复材料、旧空间密钥、同步包作者和内容均已验证；候选新空间只在当前页面内存，确认前没有写入密钥库。 ");
    } catch (error) {
      setRecoveryPassphrase("");
      setMessage(error instanceof Error ? error.message : "无法准备所有权恢复");
    } finally {
      setBusy("");
    }
  }

  async function confirmRecovery() {
    if (!candidate || !recoveryPacket) return;
    setBusy("recovery-confirm");
    try {
      await saveRotatedSyncChannels(candidate.retiredChannel, candidate.nextChannel);
      onRecoveredChannels(candidate.retiredChannel, candidate.nextChannel);
      downloadText(
        serializeSyncOwnershipTransfer(candidate.transfer),
        `evolve-owner-transfer-${safeFilePart(candidate.nextChannel.label)}-${fileStamp(new Date(candidate.transfer.transferredAt))}.json`,
      );
      let staged = true;
      try {
        await onStageBackup(candidate.recovered.backupText, recoveryPacket.fileName, recoveryPacket.fileBytes, {
          channelId: candidate.retiredChannel.channelId,
          revisionId: candidate.recovered.packet.revisionId,
          parentRevisionId: candidate.recovered.packet.parentRevisionId,
          authorName: candidate.recovered.author.name,
          relation: "initial",
          previousHeadRevisionId: "",
          previousLastPacketAt: "",
          previousMergeParentRevisionIds: [],
        });
      } catch {
        staged = false;
      }
      setCandidate(null);
      setRecoveryKit(null);
      setRecoveryPacket(null);
      setMessage(staged
        ? `所有权已迁移到第 ${candidate.nextChannel.generation} 代新空间；旧空间停用，恢复出的工作台已送入下方预检。请把迁移记录交给旧成员验签并重新授权。`
        : `所有权已迁移到第 ${candidate.nextChannel.generation} 代新空间，但工作台预检未能建立；请保留迁移记录，并用“读取同步包”再次导入旧空间密文。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法写入所有权迁移结果");
    } finally {
      setBusy("");
    }
  }

  async function readOwnershipTransfer(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !identity) return;
    setBusy("transfer-read");
    try {
      const transfer = await inspectSyncOwnershipTransferText(await readBoundedFile(file, MAX_SYNC_CONTROL_BYTES, "所有权迁移记录"));
      const oldChannel = channels.find((channel) => channel.channelId === transfer.previous.channelId);
      if (!oldChannel) throw new Error("当前设备没有迁移记录对应的旧同步空间");
      const result = await acceptSyncOwnershipTransfer(transfer, oldChannel, identity);
      await saveSyncChannel(result.channel);
      onRetiredChannel(result.channel);
      setMessage(result.status === "owner-replaced"
        ? "离线恢复授权和迁移签名有效：当前原创建设备已被新所有者替代，旧空间只读且没有获得新密钥。 "
        : `离线恢复授权和迁移签名有效：旧空间已停用。请向新所有者“${transfer.nextOwner.name}”提交本机授权请求，加入第 ${transfer.next.generation} 代空间。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取所有权迁移记录");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="sync-recovery-console">
      <header>
        <div><span>OWNER RECOVERY / 预签离线接管</span><h3>设备可以遗失，所有权不能靠冒充找回。</h3><p>原创建设备预先签发加密恢复材料；接任设备必须同时验证恢复材料与旧空间同步包，随后轮换新密钥。</p></div>
        <strong>{candidate ? "READY TO TRANSFER" : recoveryKit ? "SEALED KIT READ" : "OFFLINE ONLY"}</strong>
      </header>
      <div className="sync-recovery-grid">
        <section>
          <span>01 / 创建设备预先准备</span>
          <h4>封存恢复授权</h4>
          <p>恢复文件不含工作台内容，但口令被猜中后可解锁旧空间密钥。文件、口令和最新同步包应分开保存。</p>
          <label><small>恢复口令</small><input type="password" value={exportPassphrase} onChange={(event) => { setExportPassphrase(event.target.value); resetExportArm(); }} autoComplete="new-password" placeholder="至少 12 个字符" disabled={!canExport || Boolean(busy)} /></label>
          <label><small>再次输入</small><input type="password" value={exportPassphraseConfirm} onChange={(event) => { setExportPassphraseConfirm(event.target.value); resetExportArm(); }} autoComplete="new-password" placeholder="不写入浏览器存储" disabled={!canExport || Boolean(busy)} /></label>
          <button className={exportArmed ? "armed" : ""} onClick={() => void exportRecoveryKit()} disabled={!canExport || !exportPassphrase || !exportPassphraseConfirm || Boolean(busy)}>{busy === "recovery-export" ? "正在本地加密…" : exportArmed ? "再次点击，下载恢复材料" : "准备离线恢复材料"}<span>{exportArmed ? "!" : "↓"}</span></button>
          <small className="recovery-kdf">AES-256-GCM · PBKDF2-SHA-256 × {SYNC_RECOVERY_KDF_ITERATIONS.toLocaleString("en-US")}</small>
        </section>
        <section>
          <span>02 / 接任设备双文件验证</span>
          <h4>解锁迁移候选</h4>
          <p>先读恢复材料，再读旧空间最新同步包。准备动作只在内存验证，不会更改当前设备或空间。</p>
          <div className="recovery-file-pair"><button onClick={() => recoveryInput.current?.click()} disabled={Boolean(busy)}>读取恢复材料 <span>{recoveryKit ? "✓" : "↙"}</span></button><button onClick={() => recoveryPacketInput.current?.click()} disabled={Boolean(busy)}>读取旧同步包 <span>{recoveryPacket ? "✓" : "↙"}</span></button></div>
          <label><small>恢复口令</small><input type="password" value={recoveryPassphrase} onChange={(event) => { setRecoveryPassphrase(event.target.value); setCandidate(null); }} autoComplete="off" placeholder="只进入当前页面内存" disabled={!recoveryKit || !recoveryPacket || Boolean(busy)} /></label>
          <button onClick={() => void prepareRecovery()} disabled={!identity || !recoveryKit || !recoveryPacket || !recoveryPassphrase || Boolean(busy)}>{busy === "recovery-prepare" ? "正在验签并解密…" : "验证并准备接管"}<span>→</span></button>
          <input ref={recoveryInput} type="file" accept="application/json,.json" onChange={readRecoveryKit} hidden />
          <input ref={recoveryPacketInput} type="file" accept="application/json,.json" onChange={readRecoveryPacket} hidden />
        </section>
        <section>
          <span>03 / 旧成员验证迁移</span>
          <h4>接受新所有者证据</h4>
          <p>旧成员以本地信任的原创建设备公钥验证恢复授权，再验证迁移签名；验证后仍需向新所有者重新授权。</p>
          <button onClick={() => transferInput.current?.click()} disabled={!identity || !channels.length || Boolean(busy)}>读取所有权迁移记录<span>↻</span></button>
          <input ref={transferInput} type="file" accept="application/json,.json" onChange={readOwnershipTransfer} hidden />
        </section>
      </div>

      {recoveryKit && (
        <div className="recovery-kit-proof">
          <div><span>SIGNED RECOVERY AUTHORITY</span><strong>{recoveryKit.envelope.delegation.channel.label} · 第 {recoveryKit.envelope.delegation.channel.generation} 代</strong><small>{recoveryKit.fileName} · 创建于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(recoveryKit.envelope.delegation.createdAt))}</small></div>
          <code>{formatDeviceFingerprint(recoveryKit.envelope.delegation.owner.fingerprint)}</code>
          <small>{recoveryPacket ? `同步包 ${recoveryPacket.packet.revisionId.slice(0, 20)}…` : "尚未选择旧空间同步包"}</small>
        </div>
      )}

      {candidate && (
        <div className="ownership-transfer-proof">
          <div><span>OWNERSHIP TRANSFER / 尚未写入</span><h4>{candidate.transfer.previousOwner.name} → {candidate.transfer.nextOwner.name}</h4><p>旧空间第 {candidate.transfer.previous.generation} 代将只读；新设备成为第 {candidate.transfer.next.generation} 代唯一初始所有者，其他旧成员必须重新授权。</p></div>
          <div className="transfer-lineage"><small>已验证旧版本</small><code>{candidate.transfer.previous.headRevisionId}</code><small>新空间</small><code>{candidate.transfer.next.channelId}</code></div>
          <footer><button onClick={() => { setCandidate(null); setMessage("已丢弃内存中的所有权迁移候选，没有写入密钥库。 "); }} disabled={Boolean(busy)}>丢弃候选</button><button onClick={() => void confirmRecovery()} disabled={Boolean(busy)}>{busy === "recovery-confirm" ? "正在轮换并写入…" : "确认迁移所有权"}<span>→</span></button></footer>
        </div>
      )}
    </article>
  );
}
