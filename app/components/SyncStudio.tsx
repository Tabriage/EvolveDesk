"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createBackupEnvelope, serializeBackupEnvelope } from "../features/backup-core.mjs";
import type { BackupSources } from "../features/backup-core.mjs";
import {
  MAX_SYNC_CONTROL_BYTES,
  MAX_SYNC_PACKET_BYTES,
  acceptDeviceGrant,
  acceptSyncRotation,
  createDeviceGrant,
  createPairingRequest,
  createSyncChannel,
  createSyncPacket,
  decryptSyncPacket,
  formatDeviceFingerprint,
  inspectDeviceGrantText,
  inspectPairingRequestText,
  inspectSyncPacketText,
  inspectSyncRotationText,
  rotateSyncChannel,
  serializeDeviceGrant,
  serializePairingRequest,
  serializeSyncPacket,
  serializeSyncRotation,
} from "../features/sync-core.mjs";
import type {
  DeviceGrant,
  PairingRequest,
  SyncChannel,
  SyncIdentity,
  SyncRevisionRelation,
} from "../features/sync-core.mjs";
import { inspectAwsCredentialLifecycle } from "../features/aws-sigv4.mjs";
import type { AwsCredentialLifecycle } from "../features/aws-sigv4.mjs";
import {
  MAX_CREDENTIAL_TTL_SECONDS,
  MIN_CREDENTIAL_TTL_SECONDS,
  inspectCredentialBrokerHealth,
  renewSyncStorageCredentials,
} from "../features/sync-credential-broker.mjs";
import type { CredentialBrokerHealth } from "../features/sync-credential-broker.mjs";
import {
  createSyncConnectionDiagnostic,
  serializeSyncConnectionDiagnostic,
} from "../features/sync-connection-diagnostic.mjs";
import { createHttpSyncTransport } from "../features/sync-remote-transport.mjs";
import {
  SYNC_STORAGE_RECIPES,
  buildSyncStorageObjectUrl,
  createSyncStorageCorsPolicy,
  getSyncStorageRecipe,
} from "../features/sync-storage-recipes.mjs";
import type { SyncStorageRecipeId } from "../features/sync-storage-recipes.mjs";
import { createSyncStorageScopeTicket } from "../features/sync-storage-scope.mjs";
import type { SyncStorageScopeTicket } from "../features/sync-storage-scope.mjs";
import {
  MAX_STORAGE_BROKER_DEPLOYMENT_PROOF_BYTES,
  inspectStorageBrokerDeploymentProofText,
  verifyStorageBrokerDeploymentRun,
} from "../features/storage-broker-deployment-proof.mjs";
import type { StorageBrokerDeploymentProof, StorageBrokerDeploymentRunVerification } from "../features/storage-broker-deployment-proof.mjs";
import {
  MAX_STORAGE_BROKER_RELEASE_PROOF_BYTES,
  inspectStorageBrokerReleaseProofText,
} from "../features/storage-broker-release-proof.mjs";
import type { StorageBrokerReleaseProof } from "../features/storage-broker-release-proof.mjs";
import { SyncRecoveryConsole } from "./SyncRecoveryConsole";
import {
  SYNC_CHANNELS_CHANGED_EVENT,
  listSyncChannels,
  loadOrCreateSyncIdentity,
  getSyncRevisionPacket,
  renameSyncIdentity,
  saveSyncChannel,
  saveRotatedSyncChannels,
  saveSyncRevisionPacket,
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
  previousMergeParentRevisionIds: string[];
};

export type StagedSyncMergeBase = {
  workspace: WorkbenchState;
  sources: BackupSources;
};

type SyncStudioProps = {
  state: WorkbenchState;
  sources: BackupSources;
  onStageBackup: (raw: string, fileName: string, fileBytes: number, sync: StagedSyncBackup, mergeBase?: StagedSyncMergeBase) => Promise<void>;
};

type IncomingReceipt = {
  fileName: string;
  authorName: string;
  relation: SyncRevisionRelation;
  revisionId: string;
  mergeAvailable: boolean;
};

type RemoteProof = {
  exists: boolean;
  revisionId: string;
  validator: string;
  checkedAt: string;
};

type RemoteProbeFailure = {
  checkedAt: string;
  failureCode: "access-denied" | "network-or-cors" | "invalid-object" | "conditional-conflict" | "unknown";
};

type RemoteBrokerReleaseReceipt = {
  proof: StorageBrokerReleaseProof;
  providerMatches: boolean;
  endpointMatches: boolean;
  originMatches: boolean;
};

type RemoteBrokerDeploymentReceipt = {
  proof: StorageBrokerDeploymentProof;
  providerMatches: boolean;
  endpointMatches: boolean;
  originMatches: boolean;
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

function localDateTimeValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function classifyRemoteFailure(error: unknown): RemoteProbeFailure["failureCode"] {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/拒绝访问|401|403|凭据/.test(message)) return "access-denied";
  if (/无法访问|CORS|网络/.test(message)) return "network-or-cors";
  if (/409|412|冲突/.test(message)) return "conditional-conflict";
  if (/同步包|ETag|对象|版本/.test(message)) return "invalid-object";
  return "unknown";
}

function credentialLifeCopy(lifecycle: AwsCredentialLifecycle) {
  if (lifecycle.status === "long-lived") return { label: "期限未声明", detail: "未提供 Session Token；如为长期密钥，请改用服务端签发的短期凭据。" };
  if (lifecycle.status === "unknown") return { label: "短期 · 到期未知", detail: "Session Token 已装载，但需要补充到期时间才能主动阻断。" };
  if (lifecycle.status === "expired") return { label: "已经到期", detail: "连接已停止；续签后必须重新取得远端版本证据。" };
  const minutes = Math.max(1, Math.ceil((lifecycle.remainingMs || 0) / 60_000));
  if (lifecycle.status === "expiring") return { label: `剩余约 ${minutes} 分钟`, detail: "已进入 5 分钟警戒区；建议现在续签。" };
  const hours = Math.floor(minutes / 60);
  return { label: hours ? `剩余约 ${hours} 小时 ${minutes % 60} 分` : `剩余约 ${minutes} 分钟`, detail: "到期前 5 分钟提醒，剩余不足 30 秒时停止发网。" };
}

export function SyncStudio({ state, sources, onStageBackup }: SyncStudioProps) {
  const pairingInput = useRef<HTMLInputElement>(null);
  const grantInput = useRef<HTMLInputElement>(null);
  const packetInput = useRef<HTMLInputElement>(null);
  const rotationInput = useRef<HTMLInputElement>(null);
  const brokerReleaseInput = useRef<HTMLInputElement>(null);
  const brokerDeploymentInput = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<SyncIdentity | null>(null);
  const [channels, setChannels] = useState<SyncChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [channelName, setChannelName] = useState("我的工作台");
  const [pairing, setPairing] = useState<PairingRequest | null>(null);
  const [pendingGrant, setPendingGrant] = useState<DeviceGrant | null>(null);
  const [pendingRevocationId, setPendingRevocationId] = useState("");
  const [incoming, setIncoming] = useState<IncomingReceipt | null>(null);
  const [remoteRecipeId, setRemoteRecipeId] = useState<SyncStorageRecipeId>("http-gateway");
  const [remoteObjectUrl, setRemoteObjectUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteAccountId, setRemoteAccountId] = useState("");
  const [remoteBucket, setRemoteBucket] = useState("");
  const [remoteObjectKey, setRemoteObjectKey] = useState("");
  const [remoteRegion, setRemoteRegion] = useState("us-east-1");
  const [remoteAccessKeyId, setRemoteAccessKeyId] = useState("");
  const [remoteSecretAccessKey, setRemoteSecretAccessKey] = useState("");
  const [remoteSessionToken, setRemoteSessionToken] = useState("");
  const [remoteExpiresAt, setRemoteExpiresAt] = useState("");
  const [remoteCredentialSource, setRemoteCredentialSource] = useState<"manual" | "broker">("manual");
  const [remoteBrokerUrl, setRemoteBrokerUrl] = useState("");
  const [remoteBrokerToken, setRemoteBrokerToken] = useState("");
  const [remoteBrokerTtlSeconds, setRemoteBrokerTtlSeconds] = useState(900);
  const [remoteBrokerHealth, setRemoteBrokerHealth] = useState<CredentialBrokerHealth | null>(null);
  const [remoteBrokerReleaseReceipt, setRemoteBrokerReleaseReceipt] = useState<RemoteBrokerReleaseReceipt | null>(null);
  const [remoteBrokerDeploymentReceipt, setRemoteBrokerDeploymentReceipt] = useState<RemoteBrokerDeploymentReceipt | null>(null);
  const [remoteBrokerRunVerification, setRemoteBrokerRunVerification] = useState<StorageBrokerDeploymentRunVerification | null>(null);
  const [remoteClock, setRemoteClock] = useState(() => Date.now());
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [remoteProof, setRemoteProof] = useState<RemoteProof | null>(null);
  const [remoteProbeFailure, setRemoteProbeFailure] = useState<RemoteProbeFailure | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("先确认这台设备的指纹；授权和传输都只在你明确操作时发生。 ");

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.channelId === selectedChannelId) || null,
    [channels, selectedChannelId],
  );

  const selectedRemoteRecipe = useMemo(() => getSyncStorageRecipe(remoteRecipeId), [remoteRecipeId]);
  const defaultRemoteObjectKey = selectedChannel ? `evolve-desk/${selectedChannel.channelId}.json` : "evolve-desk/channel-id.json";
  const preparedRemoteObjectUrl = useMemo(() => {
    try {
      return buildSyncStorageObjectUrl(remoteRecipeId, {
        objectUrl: remoteObjectUrl,
        accountId: remoteAccountId,
        bucket: remoteBucket,
        objectKey: remoteObjectKey.trim() || defaultRemoteObjectKey,
        region: remoteRegion,
      });
    } catch {
      return "";
    }
  }, [defaultRemoteObjectKey, remoteAccountId, remoteBucket, remoteObjectKey, remoteObjectUrl, remoteRecipeId, remoteRegion]);
  const remoteCredentialLifecycle = useMemo<AwsCredentialLifecycle>(() => {
    if (selectedRemoteRecipe.authType !== "aws-sigv4") return { status: "long-lived", expiresAt: "", remainingMs: null, usable: true, renewalRecommended: false };
    try {
      return inspectAwsCredentialLifecycle({ sessionToken: remoteSessionToken, expiresAt: remoteExpiresAt }, new Date(remoteClock));
    } catch {
      return { status: "expired", expiresAt: remoteExpiresAt, remainingMs: null, usable: false, renewalRecommended: true };
    }
  }, [remoteClock, remoteExpiresAt, remoteSessionToken, selectedRemoteRecipe.authType]);
  const hasRemoteSigV4Credential = Boolean(remoteAccessKeyId.trim() && remoteSecretAccessKey.trim());
  const remoteCredentialLifeCopy = hasRemoteSigV4Credential
    ? credentialLifeCopy(remoteCredentialLifecycle)
    : { label: "尚未装载凭据", detail: "手动输入短期凭据，或由可信续签服务按当前对象签发。" };
  const remoteCredentialReady = selectedRemoteRecipe.authType === "bearer" || Boolean(hasRemoteSigV4Credential && remoteRegion.trim() && remoteCredentialLifecycle.usable);
  const remoteConnectionReady = Boolean(preparedRemoteObjectUrl && remoteCredentialReady);
  const remoteScopeTicket = useMemo<SyncStorageScopeTicket | null>(() => {
    if (selectedRemoteRecipe.id !== "cloudflare-r2" && selectedRemoteRecipe.id !== "amazon-s3") return null;
    try {
      return createSyncStorageScopeTicket(selectedRemoteRecipe.id, {
        accountId: remoteAccountId,
        bucket: remoteBucket,
        objectKey: remoteObjectKey.trim() || defaultRemoteObjectKey,
        region: remoteRegion,
        ttlSeconds: remoteBrokerTtlSeconds,
      });
    } catch {
      return null;
    }
  }, [defaultRemoteObjectKey, remoteAccountId, remoteBrokerTtlSeconds, remoteBucket, remoteObjectKey, remoteRegion, selectedRemoteRecipe]);
  const checkedBrokerSupportsProvider = !remoteBrokerHealth || (selectedRemoteRecipe.id === "cloudflare-r2"
    ? remoteBrokerHealth.providers.cloudflareR2
    : remoteBrokerHealth.providers.amazonS3);
  const remoteBrokerReleaseBound = Boolean(remoteBrokerReleaseReceipt
    && remoteBrokerReleaseReceipt.providerMatches
    && remoteBrokerReleaseReceipt.endpointMatches
    && remoteBrokerReleaseReceipt.originMatches);
  const remoteBrokerDeploymentBound = Boolean(remoteBrokerDeploymentReceipt
    && remoteBrokerDeploymentReceipt.providerMatches
    && remoteBrokerDeploymentReceipt.endpointMatches
    && remoteBrokerDeploymentReceipt.originMatches);
  const remoteRenewalReady = Boolean(
    selectedRemoteRecipe.authType === "aws-sigv4"
    && remoteScopeTicket
    && remoteBrokerUrl.trim()
    && checkedBrokerSupportsProvider
    && Number.isInteger(remoteBrokerTtlSeconds)
    && remoteBrokerTtlSeconds >= MIN_CREDENTIAL_TTL_SECONDS
    && remoteBrokerTtlSeconds <= MAX_CREDENTIAL_TTL_SECONDS,
  );
  const remoteCorsPolicy = useMemo(() => {
    if (!currentOrigin || selectedRemoteRecipe.authType !== "aws-sigv4") return "";
    try {
      return JSON.stringify(createSyncStorageCorsPolicy(currentOrigin), null, 2);
    } catch {
      return "";
    }
  }, [currentOrigin, selectedRemoteRecipe.authType]);

  const remotePublishReady = Boolean(
    selectedChannel
    && !selectedChannel.retiredAt
    && remoteProof
    && remoteConnectionReady
    && (!remoteProof.exists || (remoteProof.revisionId === selectedChannel.headRevisionId && remoteProof.validator)),
  );

  useEffect(() => {
    let active = true;
    async function initialize() {
      if (globalThis.location?.origin) setCurrentOrigin(globalThis.location.origin);
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

  useEffect(() => {
    if (selectedRemoteRecipe.authType !== "aws-sigv4" || !remoteExpiresAt) return undefined;
    const interval = globalThis.setInterval(() => setRemoteClock(Date.now()), 30_000);
    return () => globalThis.clearInterval(interval);
  }, [remoteExpiresAt, selectedRemoteRecipe.authType]);

  function clearRemoteProbe() {
    setRemoteProof(null);
    setRemoteProbeFailure(null);
  }

  function markManualCredential() {
    setRemoteCredentialSource("manual");
    clearRemoteProbe();
  }

  function invalidateRemoteScope() {
    if (remoteCredentialSource === "broker") {
      setRemoteAccessKeyId("");
      setRemoteSecretAccessKey("");
      setRemoteSessionToken("");
      setRemoteExpiresAt("");
      setRemoteCredentialSource("manual");
    }
    clearRemoteProbe();
  }

  function replaceChannel(channel: SyncChannel) {
    setChannels((current) => [...current.filter((item) => item.channelId !== channel.channelId), channel]);
    if (channel.channelId !== selectedChannelId) invalidateRemoteScope();
    setSelectedChannelId(channel.channelId);
  }

  function selectChannel(channelId: string) {
    setSelectedChannelId(channelId);
    invalidateRemoteScope();
    setPendingRevocationId("");
  }

  function installRecoveredChannels(retiredChannel: SyncChannel, nextChannel: SyncChannel) {
    setChannels((current) => [...current.filter((item) => item.channelId !== retiredChannel.channelId && item.channelId !== nextChannel.channelId), retiredChannel, nextChannel]);
    setSelectedChannelId(nextChannel.channelId);
    invalidateRemoteScope();
    setIncoming(null);
    setPendingRevocationId("");
  }

  function retireTransferredChannel(channel: SyncChannel) {
    replaceChannel(channel);
    invalidateRemoteScope();
    setIncoming(null);
    setPendingRevocationId("");
  }

  function changeRemoteObjectUrl(value: string) {
    setRemoteObjectUrl(value);
    invalidateRemoteScope();
  }

  function changeRemoteToken(value: string) {
    setRemoteToken(value);
    clearRemoteProbe();
  }

  function selectRemoteRecipe(recipeId: SyncStorageRecipeId) {
    const recipe = getSyncStorageRecipe(recipeId);
    setRemoteRecipeId(recipeId);
    setRemoteRegion(recipe.region || "us-east-1");
    setRemoteObjectUrl("");
    setRemoteToken("");
    setRemoteAccessKeyId("");
    setRemoteSecretAccessKey("");
    setRemoteSessionToken("");
    setRemoteExpiresAt("");
    setRemoteCredentialSource("manual");
    setRemoteBrokerUrl(recipe.authType === "aws-sigv4" ? "http://127.0.0.1:4243/credentials" : "");
    setRemoteBrokerToken("");
    setRemoteBrokerHealth(null);
    setRemoteBrokerReleaseReceipt(null);
    setRemoteBrokerDeploymentReceipt(null);
    setRemoteBrokerRunVerification(null);
    clearRemoteProbe();
    setMessage(`${recipe.label} 配方已选择；连接参数和凭据只留在当前页面内存。 `);
  }

  function remoteTransportConfig() {
    if (selectedRemoteRecipe.authType === "bearer") return { objectUrl: preparedRemoteObjectUrl, bearerToken: remoteToken };
    return {
      objectUrl: preparedRemoteObjectUrl,
      sigv4: {
        accessKeyId: remoteAccessKeyId,
        secretAccessKey: remoteSecretAccessKey,
        sessionToken: remoteSessionToken,
        region: remoteRegion,
        expiresAt: remoteExpiresAt,
      },
    };
  }

  async function copyRemoteCorsPolicy() {
    if (!remoteCorsPolicy || !globalThis.navigator?.clipboard) {
      setMessage("当前浏览器不能直接复制 CORS 配方；请按界面契约手动配置 GET、PUT、请求头与 ETag 暴露。 ");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(remoteCorsPolicy);
      setMessage(`已复制 ${selectedRemoteRecipe.label} 的最小 CORS 配方；AllowedOrigins 已限定为当前工作台 ${currentOrigin}。 `);
    } catch {
      setMessage("浏览器拒绝写入剪贴板；请手动配置当前 Origin、GET/PUT、SigV4 请求头并暴露 ETag。 ");
    }
  }

  async function copyRemoteScopePolicy() {
    if (!remoteScopeTicket || !globalThis.navigator?.clipboard) {
      setMessage("请先补全单一对象地址，再复制最小权限策略。 ");
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(`${JSON.stringify(remoteScopeTicket.providerPolicy, null, 2)}\n`);
      setMessage(`已复制 ${selectedRemoteRecipe.label} 单对象 GET/PUT 最小权限策略；不包含 LIST、DELETE 或通配符。 `);
    } catch {
      setMessage("浏览器拒绝写入剪贴板；权限票据仍已在界面中完成范围核对。 ");
    }
  }

  async function checkRemoteBroker() {
    if (!remoteBrokerUrl.trim()) return;
    setBusy("remote-broker-health");
    setRemoteBrokerHealth(null);
    try {
      const health = await inspectCredentialBrokerHealth({ endpointUrl: remoteBrokerUrl, bearerToken: remoteBrokerToken });
      setRemoteBrokerHealth(health);
      const supportsProvider = selectedRemoteRecipe.id === "cloudflare-r2" ? health.providers.cloudflareR2 : health.providers.amazonS3;
      setMessage(supportsProvider
        ? `本地凭据代理在线，并已启用 ${selectedRemoteRecipe.label} 签发器。 `
        : `本地凭据代理在线，但尚未配置 ${selectedRemoteRecipe.label} 签发器。 `);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法检查本地凭据代理");
    } finally {
      setBusy("");
    }
  }

  async function readRemoteBrokerReleaseProof(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("remote-release-proof");
    setRemoteBrokerReleaseReceipt(null);
    setRemoteBrokerDeploymentReceipt(null);
    setRemoteBrokerRunVerification(null);
    try {
      const proof = await inspectStorageBrokerReleaseProofText(await readJsonFile(file, MAX_STORAGE_BROKER_RELEASE_PROOF_BYTES, "发布封签"));
      const providerMatches = proof.body.capabilities.provider === selectedRemoteRecipe.id;
      let endpointMatches = false;
      try { endpointMatches = new URL(remoteBrokerUrl).origin === proof.body.deployment.endpointOrigin; } catch { endpointMatches = false; }
      const originMatches = currentOrigin === proof.body.deployment.allowedWorkbenchOrigin;
      const receipt = { proof, providerMatches, endpointMatches, originMatches };
      setRemoteBrokerReleaseReceipt(receipt);
      const mismatches = [
        ...(!providerMatches ? ["供应商"] : []),
        ...(!endpointMatches ? ["代理 Origin"] : []),
        ...(!originMatches ? ["工作台 Origin"] : []),
      ];
      setMessage(mismatches.length
        ? `发布封签本身完整，但与当前 ${mismatches.join("、")} 不一致；不会把它标记为已绑定。 `
        : `发布封签已绑定当前代理：源码提交 ${proof.body.source.commit.slice(0, 12)}，${proof.body.files.length} 个运行时文件 SHA-256 均完整。 `);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法核对凭据代理发布封签");
    } finally {
      setBusy("");
    }
  }

  async function readRemoteBrokerDeploymentProof(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("remote-deployment-proof");
    setRemoteBrokerReleaseReceipt(null);
    setRemoteBrokerDeploymentReceipt(null);
    setRemoteBrokerRunVerification(null);
    try {
      const proof = await inspectStorageBrokerDeploymentProofText(await readJsonFile(file, MAX_STORAGE_BROKER_DEPLOYMENT_PROOF_BYTES, "CI 部署回执"));
      const releaseProof = proof.body.releaseProof;
      const providerMatches = releaseProof.body.capabilities.provider === selectedRemoteRecipe.id;
      let endpointMatches = false;
      try { endpointMatches = new URL(remoteBrokerUrl).origin === proof.body.cloud.endpointOrigin; } catch { endpointMatches = false; }
      const originMatches = currentOrigin === releaseProof.body.deployment.allowedWorkbenchOrigin;
      setRemoteBrokerReleaseReceipt({ proof: releaseProof, providerMatches, endpointMatches, originMatches });
      setRemoteBrokerDeploymentReceipt({ proof, providerMatches, endpointMatches, originMatches });
      let runVerification: StorageBrokerDeploymentRunVerification | null = null;
      let runFailure = "";
      try {
        runVerification = await verifyStorageBrokerDeploymentRun(proof);
        setRemoteBrokerRunVerification(runVerification);
      } catch (error) {
        runFailure = error instanceof Error ? error.message : "无法在线核对 GitHub Actions Run";
      }
      const mismatches = [
        ...(!providerMatches ? ["供应商"] : []),
        ...(!endpointMatches ? ["云端代理 Origin"] : []),
        ...(!originMatches ? ["工作台 Origin"] : []),
      ];
      setMessage(mismatches.length
        ? `CI 部署回执本身完整，但与当前 ${mismatches.join("、")} 不一致；不会把它标记为已绑定。 `
        : runVerification
          ? `GitHub 公共 API 已确认同一工作流 Run 成功，OIDC 部署回执也已绑定当前代理与 Lambda 不可变版本 ${proof.body.cloud.immutableVersion}。仍需用 gh attestation verify 核验文件签名与作者身份。 `
          : `OIDC 部署回执已绑定当前代理与 Lambda 不可变版本 ${proof.body.cloud.immutableVersion}，但${runFailure}。仍需用 gh attestation verify 核验文件签名与作者身份。 `);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法核对 CI 部署回执");
    } finally {
      setBusy("");
    }
  }

  async function renewRemoteCredentials() {
    if (selectedRemoteRecipe.authType !== "aws-sigv4" || !remoteRenewalReady) return;
    const provider = selectedRemoteRecipe.id === "cloudflare-r2" ? "cloudflare-r2" : "amazon-s3";
    setBusy("remote-renew");
    try {
      const result = await renewSyncStorageCredentials({ endpointUrl: remoteBrokerUrl, bearerToken: remoteBrokerToken }, {
        provider,
        accountId: remoteAccountId,
        bucket: remoteBucket,
        objectKey: remoteObjectKey.trim() || defaultRemoteObjectKey,
        region: remoteRegion,
        ttlSeconds: remoteBrokerTtlSeconds,
      });
      setRemoteAccessKeyId(result.credentials.accessKeyId);
      setRemoteSecretAccessKey(result.credentials.secretAccessKey);
      setRemoteSessionToken(result.credentials.sessionToken);
      setRemoteExpiresAt(result.credentials.expiresAt);
      setRemoteCredentialSource("broker");
      setRemoteClock(Date.now());
      clearRemoteProbe();
      setMessage(`已显式续签 ${selectedRemoteRecipe.label} 短期凭据，有效期到 ${new Date(result.credentials.expiresAt).toLocaleString()}；请重新连接检查远端版本。 `);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法续签短期凭据");
    } finally {
      setBusy("");
    }
  }

  async function exportRemoteDiagnostic() {
    if (!preparedRemoteObjectUrl) return;
    setBusy("remote-diagnostic");
    try {
      const probe = remoteProbeFailure
        ? { status: "error" as const, checkedAt: remoteProbeFailure.checkedAt, failureCode: remoteProbeFailure.failureCode }
        : remoteProof
          ? { status: remoteProof.exists ? remoteProof.validator ? "etag-ready" as const : "read-only" as const : "empty" as const, checkedAt: remoteProof.checkedAt, revisionId: remoteProof.revisionId, validator: remoteProof.validator }
          : { status: "not-checked" as const };
      const diagnostic = await createSyncConnectionDiagnostic({
        recipeId: selectedRemoteRecipe.id,
        objectUrl: preparedRemoteObjectUrl,
        region: remoteRegion,
        accessKeyId: remoteAccessKeyId,
        sessionToken: remoteSessionToken,
        expiresAt: remoteExpiresAt,
        credentialSource: remoteCredentialSource,
        probe,
      });
      downloadText(serializeSyncConnectionDiagnostic(diagnostic), `evolve-sync-diagnostic-${selectedRemoteRecipe.id}-${fileStamp(new Date(diagnostic.body.createdAt))}.json`);
      setMessage("已导出 SHA-256 封签的无秘密连接诊断；地址、对象 Key、Access Key、令牌、版本 ID 与 ETag 均只留下摘要。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法导出连接诊断");
    } finally {
      setBusy("");
    }
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

  async function confirmRevocation() {
    if (!identity || !selectedChannel || !pendingRevocationId) return;
    setBusy("rotation");
    try {
      const target = selectedChannel.authorizedDevices.find((device) => device.deviceId === pendingRevocationId);
      if (!target) throw new Error("待撤销设备已不在当前空间中");
      const result = await rotateSyncChannel(selectedChannel, identity, [pendingRevocationId]);
      await saveRotatedSyncChannels(result.retiredChannel, result.nextChannel);
      downloadText(serializeSyncRotation(result.rotation), `evolve-space-rotation-${safeFilePart(selectedChannel.label)}-${fileStamp(new Date(result.rotation.rotatedAt))}.json`);
      setChannels((current) => [...current.filter((item) => item.channelId !== result.retiredChannel.channelId && item.channelId !== result.nextChannel.channelId), result.retiredChannel, result.nextChannel]);
      setSelectedChannelId(result.nextChannel.channelId);
      setPendingRevocationId("");
      invalidateRemoteScope();
      setIncoming(null);
      setMessage(`已撤销“${target.name}”并进入第 ${result.nextChannel.generation} 代空间；旧空间已停用。剩余设备需要重新生成授权请求，远端传输需连接新的空对象地址。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法完成空间密钥轮换");
    } finally {
      setBusy("");
    }
  }

  async function readRotation(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !identity) return;
    setBusy("rotation-import");
    try {
      const rotation = await inspectSyncRotationText(await readJsonFile(file, MAX_SYNC_CONTROL_BYTES, "空间轮换记录"));
      const oldChannel = channels.find((channel) => channel.channelId === rotation.previous.channelId);
      if (!oldChannel) throw new Error("当前设备没有这份轮换记录对应的旧同步空间");
      const result = await acceptSyncRotation(rotation, oldChannel, identity);
      await saveSyncChannel(result.channel);
      replaceChannel(result.channel);
      invalidateRemoteScope();
      setIncoming(null);
      setMessage(result.status === "revoked"
        ? "轮换记录签名有效：当前设备已被撤销。旧空间现为只读，本机没有获得新世代密钥。 "
        : `轮换记录签名有效：旧空间已停用。请生成本机授权请求，交给创建设备加入第 ${rotation.next.generation} 代空间。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取空间轮换记录");
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
      let historySaved = false;
      try {
        historySaved = await saveSyncRevisionPacket(serialized);
      } catch {
        historySaved = false;
      }
      const updated = await setSyncChannelHead(selectedChannel.channelId, packet.revisionId, packet.createdAt);
      if (updated) replaceChannel(updated);
      setIncoming(null);
      setMessage(historySaved
        ? "加密同步包已生成，密文父版本也已留作后续三方冲突预览。 "
        : "加密同步包已生成，但浏览器未能保留密文父版本；后续分叉只能整体预检。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成加密同步包");
    } finally {
      setBusy("");
    }
  }

  async function stagePacket(raw: string, fileName: string, fileBytes: number) {
    setIncoming(null);
    const packet = inspectSyncPacketText(raw);
    const channel = channels.find((item) => item.channelId === packet.channelId);
    if (!channel) throw new Error("当前设备尚未加入这个同步空间，不能解锁该同步包");
    const opened = await decryptSyncPacket(packet, channel);
    if (opened.relation === "duplicate") throw new Error("这个同步版本已经是当前版本，无需重复恢复");
    let mergeBase: StagedSyncMergeBase | undefined;
    if (opened.relation === "diverged" && packet.parentRevisionId) {
      const baseRaw = await getSyncRevisionPacket(channel.channelId, packet.parentRevisionId);
      if (baseRaw) {
        const basePacket = inspectSyncPacketText(baseRaw);
        const baseOpened = await decryptSyncPacket(basePacket, channel);
        mergeBase = { workspace: baseOpened.parsed.workspace, sources: baseOpened.parsed.sources };
      }
    }
    try {
      await saveSyncRevisionPacket(raw);
    } catch {
      // The packet can still be previewed and restored when browser quota cannot retain history.
    }
    await onStageBackup(opened.backupText, fileName, fileBytes, {
      channelId: channel.channelId,
      revisionId: packet.revisionId,
      parentRevisionId: packet.parentRevisionId,
      authorName: opened.author.name,
      relation: opened.relation,
      previousHeadRevisionId: channel.headRevisionId,
      previousLastPacketAt: channel.lastPacketAt,
      previousMergeParentRevisionIds: channel.mergeParentRevisionIds || [],
    }, mergeBase);
    replaceChannel(channel);
    setIncoming({ fileName, authorName: opened.author.name, relation: opened.relation, revisionId: packet.revisionId, mergeAvailable: Boolean(mergeBase) });
    setMessage(opened.relation === "diverged"
      ? mergeBase
        ? "同步包已解锁，并找到共同父版本；下方可以逐对象审阅三方合并。 "
        : "同步包已解锁，但缺少共同父版本；下方只展示整体替换预检，不会猜测合并。 "
      : "同步包已解锁并送入恢复预检；再次确认前，当前工作台没有变化。 ");
  }

  async function readPacket(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("packet");
    try {
      await stagePacket(await readJsonFile(file, MAX_SYNC_PACKET_BYTES, "加密同步包"), file.name, file.size);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取加密同步包");
    } finally {
      setBusy("");
    }
  }

  async function inspectRemoteObject() {
    if (!selectedChannel || !remoteConnectionReady) return;
    setBusy("remote-read");
    try {
      const transport = createHttpSyncTransport(remoteTransportConfig());
      const result = await transport.read(selectedChannel.channelId);
      const checkedAt = new Date().toISOString();
      setRemoteProof({ exists: result.exists, revisionId: result.revisionId, validator: result.validator, checkedAt });
      setRemoteProbeFailure(null);
      if (!result.exists) {
        setMessage("远端对象当前为空；下一次条件发布会使用 If-None-Match，防止抢占已有对象。 ");
        return;
      }
      if (result.revisionId === selectedChannel.headRevisionId) {
        setMessage(result.validator
          ? "远端版本与本机版本头一致，并提供强 ETag；可以安全条件发布下一版。 "
          : "远端版本与本机一致，但服务器没有提供强 ETag；这里只允许读取，不允许覆盖写入。 ");
        return;
      }
      if (!result.packetText) throw new Error("远端对象没有可读取的同步包");
      await stagePacket(result.packetText, `${selectedRemoteRecipe.label} 条件对象`, new TextEncoder().encode(result.packetText).byteLength);
    } catch (error) {
      setRemoteClock(Date.now());
      setRemoteProof(null);
      setRemoteProbeFailure({ checkedAt: new Date().toISOString(), failureCode: classifyRemoteFailure(error) });
      setMessage(error instanceof Error ? error.message : "无法检查远端条件对象");
    } finally {
      setBusy("");
    }
  }

  async function publishRemoteObject() {
    if (!identity || !selectedChannel || !remoteProof) return;
    setBusy("remote-write");
    try {
      const transport = createHttpSyncTransport(remoteTransportConfig());
      const packetChannel = remoteProof.exists ? selectedChannel : { ...selectedChannel, headRevisionId: "", mergeParentRevisionIds: [] };
      const backup = await createBackupEnvelope(state, sources);
      const packet = await createSyncPacket(serializeBackupEnvelope(backup), packetChannel, identity);
      const serialized = serializeSyncPacket(packet);
      const result = await transport.write(selectedChannel.channelId, remoteProof.revisionId, serialized);
      if (!result.written) {
        setRemoteProof({ exists: Boolean(result.currentRevisionId), revisionId: result.currentRevisionId, validator: result.validator, checkedAt: new Date().toISOString() });
        setRemoteProbeFailure(null);
        setMessage("条件写入被远端拒绝：其他设备已先发布新版本。没有覆盖远端内容，请先重新检查并审阅。 ");
        return;
      }
      try {
        await saveSyncRevisionPacket(serialized);
      } catch {
        // Publishing succeeded even when the optional local encrypted history cannot be retained.
      }
      const updated = await setSyncChannelHead(selectedChannel.channelId, packet.revisionId, packet.createdAt);
      if (updated) replaceChannel(updated);
      setRemoteProof({ exists: true, revisionId: packet.revisionId, validator: result.validator, checkedAt: new Date().toISOString() });
      setRemoteProbeFailure(null);
      setIncoming(null);
      setMessage("加密同步包已通过条件写入发布，并经回读确认；访问令牌仍只在当前页面内存。 ");
    } catch (error) {
      setRemoteClock(Date.now());
      setRemoteProbeFailure({ checkedAt: new Date().toISOString(), failureCode: classifyRemoteFailure(error) });
      setMessage(error instanceof Error ? error.message : "无法条件发布远端同步包");
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
        <label><span>当前同步空间</span><select value={selectedChannelId} onChange={(event) => selectChannel(event.target.value)} disabled={Boolean(busy)}><option value="">尚未加入</option>{channels.map((channel) => <option key={channel.channelId} value={channel.channelId}>{channel.label} · 第 {channel.generation || 1} 代 · {channel.retiredAt ? "已停用" : channel.role === "owner" ? "创建设备" : "已授权设备"}</option>)}</select></label>
        <div><span>版本头</span><code>{selectedChannel?.retiredAt ? "旧世代只读" : selectedChannel?.headRevisionId ? `${selectedChannel.headRevisionId.slice(0, 19)}…` : "尚无本地版本"}</code></div>
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
          <button className="secondary" onClick={() => pairingInput.current?.click()} disabled={!selectedChannel || selectedChannel.role !== "owner" || Boolean(selectedChannel.retiredAt) || Boolean(busy)}>读取新设备请求 <span>→</span></button>
          <button className="secondary rotation-import-button" onClick={() => rotationInput.current?.click()} disabled={!channels.length || Boolean(busy)}>读取空间轮换记录 <span>↻</span></button>
          <input ref={pairingInput} type="file" accept="application/json,.json" onChange={readPairingRequest} hidden />
          <input ref={grantInput} type="file" accept="application/json,.json" onChange={readGrant} hidden />
          <input ref={rotationInput} type="file" accept="application/json,.json" onChange={readRotation} hidden />
        </article>

        <article className="sync-step-card transfer">
          <header><i>03</i><div><span>TRANSFER</span><strong>搬运加密快照</strong></div></header>
          <p>同步包包含父版本和密文。导入后先检查来源与版本关系；有共同父版本时进入逐对象三方合并，否则安全降级为整体预检。</p>
          <div className="sync-chain-readout"><span><i /> AES-256-GCM</span><span><i /> AUTHENTICATED HEAD</span></div>
          <div className="sync-button-pair"><button onClick={() => void exportPacket()} disabled={!selectedChannel || !identity || Boolean(selectedChannel.retiredAt) || Boolean(busy)}>{busy === "export" ? "正在封装…" : "生成同步包"} <span>↗</span></button><button onClick={() => packetInput.current?.click()} disabled={!channels.length || Boolean(busy)}>{busy === "packet" ? "正在解锁…" : "读取同步包"} <span>↙</span></button></div>
          <input ref={packetInput} type="file" accept="application/json,.json" onChange={readPacket} hidden />
        </article>
      </div>

      <article className="remote-transport-console">
        <header><div><span>REMOTE ADAPTER / 显式远端传输</span><h3>选供应商，但不放弃条件写入契约。</h3></div><strong>{selectedRemoteRecipe.authType === "aws-sigv4" && hasRemoteSigV4Credential && remoteCredentialLifecycle.status === "expired" ? "CREDENTIAL EXPIRED" : selectedRemoteRecipe.authType === "aws-sigv4" && hasRemoteSigV4Credential && remoteCredentialLifecycle.status === "expiring" ? "RENEW SOON" : remoteProof ? remoteProof.exists ? remoteProof.validator ? "ETAG READY" : "READ ONLY" : "EMPTY SLOT" : selectedRemoteRecipe.id === "http-gateway" ? "HTTP RECIPE" : "SIGV4 RECIPE"}</strong></header>
        <div className="remote-recipe-strip" role="radiogroup" aria-label="远端存储连接配方">{SYNC_STORAGE_RECIPES.map((recipe) => <button key={recipe.id} className={remoteRecipeId === recipe.id ? "active" : ""} role="radio" aria-checked={remoteRecipeId === recipe.id} onClick={() => selectRemoteRecipe(recipe.id)} disabled={Boolean(busy)}><i>{recipe.id === "cloudflare-r2" ? "R2" : recipe.id === "amazon-s3" ? "S3" : "↔"}</i><span><strong>{recipe.label}</strong><small>{recipe.shortLabel}</small></span></button>)}</div>
        <div className="remote-recipe-contract"><code>{selectedRemoteRecipe.endpointPattern}</code><div><span><i />GET + PUT</span><b>→</b><span><i />If-None-Match / If-Match</span><b>→</b><span><i />Expose ETag</span><div className="remote-contract-actions">{selectedRemoteRecipe.authType === "aws-sigv4" && <button onClick={() => void copyRemoteCorsPolicy()} disabled={!remoteCorsPolicy || Boolean(busy)}>复制 CORS</button>}<button onClick={() => void exportRemoteDiagnostic()} disabled={!preparedRemoteObjectUrl || Boolean(busy)}>{busy === "remote-diagnostic" ? "正在封签…" : "导出无秘密诊断"}</button></div></div></div>
        {selectedRemoteRecipe.authType === "bearer" ? (
          <div className="remote-transport-fields">
            <label><span>同步包对象 URL</span><input type="url" value={remoteObjectUrl} onChange={(event) => changeRemoteObjectUrl(event.target.value)} placeholder="https://storage.example/evolve-sync.json" disabled={Boolean(busy)} /></label>
            <label><span>Bearer 访问令牌（可选）</span><input type="password" value={remoteToken} onChange={(event) => changeRemoteToken(event.target.value)} placeholder="仅保留在当前页面内存" autoComplete="off" disabled={Boolean(busy)} /></label>
            <div><span>远端版本证据</span><code>{remoteProof?.revisionId ? `${remoteProof.revisionId.slice(0, 22)}…` : remoteProof ? "尚无远端对象" : "需要手动连接检查"}</code><small>{remoteProof?.validator || "未取得强 ETag"}</small></div>
          </div>
        ) : (
          <>
            <div className={`remote-s3-address-fields ${selectedRemoteRecipe.id === "cloudflare-r2" ? "r2" : "s3"}`}>
              {selectedRemoteRecipe.id === "cloudflare-r2" && <label><span>R2 Account ID</span><input value={remoteAccountId} maxLength={32} onChange={(event) => { setRemoteAccountId(event.target.value); invalidateRemoteScope(); }} placeholder="32 位 Account ID" disabled={Boolean(busy)} /></label>}
              <label><span>私有存储桶</span><input value={remoteBucket} maxLength={63} onChange={(event) => { setRemoteBucket(event.target.value); invalidateRemoteScope(); }} placeholder="private-evolve-sync" disabled={Boolean(busy)} /></label>
              {selectedRemoteRecipe.id === "amazon-s3" && <label><span>AWS Region</span><input value={remoteRegion} maxLength={32} onChange={(event) => { setRemoteRegion(event.target.value); invalidateRemoteScope(); }} placeholder="ap-southeast-1" disabled={Boolean(busy)} /></label>}
              <label><span>单一对象 Key</span><input value={remoteObjectKey} maxLength={1024} onChange={(event) => { setRemoteObjectKey(event.target.value); invalidateRemoteScope(); }} placeholder={defaultRemoteObjectKey} disabled={Boolean(busy)} /></label>
              <div><span>签名对象 URL</span><code>{preparedRemoteObjectUrl || "补全供应商地址字段后生成"}</code><small>对象 Key 默认绑定当前空间；轮换后请使用新对象。</small></div>
            </div>
            <div className="remote-s3-credential-fields">
              <label><span>Access Key ID</span><input value={remoteAccessKeyId} maxLength={128} onChange={(event) => { setRemoteAccessKeyId(event.target.value); markManualCredential(); }} autoComplete="off" placeholder="短期凭据" disabled={Boolean(busy)} /></label>
              <label><span>Secret Access Key</span><input type="password" value={remoteSecretAccessKey} maxLength={256} onChange={(event) => { setRemoteSecretAccessKey(event.target.value); markManualCredential(); }} autoComplete="off" placeholder="只留在页面内存" disabled={Boolean(busy)} /></label>
              <label><span>Session Token（推荐）</span><input type="password" value={remoteSessionToken} maxLength={16384} onChange={(event) => { setRemoteSessionToken(event.target.value); markManualCredential(); }} autoComplete="off" placeholder="短期凭据才会提供" disabled={Boolean(busy)} /></label>
              <div><span>远端版本证据</span><code>{remoteProof?.revisionId ? `${remoteProof.revisionId.slice(0, 22)}…` : remoteProof ? "尚无远端对象" : "需要签名连接检查"}</code><small>{remoteProof?.validator || selectedRemoteRecipe.credentialHint}</small></div>
            </div>
            <section className={`remote-credential-passport ${hasRemoteSigV4Credential ? remoteCredentialLifecycle.status : "empty"}`}>
              <header><div><span>CREDENTIAL LIFELINE / 凭据寿命</span><strong>{remoteCredentialLifeCopy.label}</strong><small>{remoteCredentialLifeCopy.detail}</small></div><b>{remoteCredentialSource === "broker" ? "BROKER ISSUED" : remoteSessionToken ? "MANUAL SESSION" : "MANUAL KEY"}</b></header>
              <div className="remote-credential-life-rail"><span className={hasRemoteSigV4Credential ? "loaded" : ""}><i />凭据装载</span><b>→</b><span className={hasRemoteSigV4Credential && remoteCredentialLifecycle.status === "expiring" ? "active" : ""}><i />5 分钟警戒</span><b>→</b><span className={hasRemoteSigV4Credential && !remoteCredentialLifecycle.usable ? "active" : ""}><i />30 秒停发</span><b>→</b><span className={hasRemoteSigV4Credential && remoteCredentialLifecycle.status === "expired" ? "active" : ""}><i />到期</span></div>
              <div className={`remote-permission-ticket ${remoteScopeTicket ? "exact" : "incomplete"}`}>
                <div className="remote-permission-target"><span>PERMISSION TICKET / 权限剪票</span><strong>{remoteScopeTicket ? selectedRemoteRecipe.label : "等待精确对象"}</strong><code>{remoteScopeTicket ? `${remoteScopeTicket.target.bucket}/${remoteScopeTicket.target.objectKey}` : "补全 Account / Bucket / Region 后生成"}</code></div>
                <i aria-hidden="true" />
                <div className="remote-permission-scope"><span>ALLOW</span><strong>GET OBJECT + PUT OBJECT</strong><small>NO LIST · NO DELETE · NO WILDCARD · TTL {remoteScopeTicket?.ttlSeconds || "—"}s</small></div>
                <div className="remote-permission-actions"><b>{remoteBrokerHealth ? checkedBrokerSupportsProvider ? "BROKER READY" : "ISSUER OFF" : "BROKER UNCHECKED"}</b>{remoteBrokerReleaseReceipt && <em className={`remote-release-seal ${remoteBrokerReleaseBound ? "bound" : "unbound"}`}>{remoteBrokerReleaseBound ? "SOURCE SEALED" : "SEAL UNBOUND"}<small>{remoteBrokerReleaseReceipt.proof.body.source.commit.slice(0, 8)} · {remoteBrokerReleaseReceipt.proof.body.files.length} FILES</small></em>}{remoteBrokerDeploymentReceipt && <em className={`remote-release-seal ci ${remoteBrokerDeploymentBound ? "bound" : "unbound"}`}>{remoteBrokerDeploymentBound ? "CI RECEIPT MATCH" : "RECEIPT UNBOUND"}<small>OIDC · LAMBDA v{remoteBrokerDeploymentReceipt.proof.body.cloud.immutableVersion} · {remoteBrokerRunVerification ? "RUN API ✓" : "RUN API ?"}</small></em>}<button onClick={() => void copyRemoteScopePolicy()} disabled={!remoteScopeTicket || Boolean(busy)}>复制最小权限策略</button><button onClick={() => brokerReleaseInput.current?.click()} disabled={!remoteBrokerUrl.trim() || Boolean(busy)}>{busy === "remote-release-proof" ? "核对中…" : "核对发布封签"}</button><input ref={brokerReleaseInput} type="file" accept="application/json,.json" onChange={readRemoteBrokerReleaseProof} hidden />{selectedRemoteRecipe.id === "amazon-s3" && <><button onClick={() => brokerDeploymentInput.current?.click()} disabled={!remoteBrokerUrl.trim() || Boolean(busy)}>{busy === "remote-deployment-proof" ? "核对中…" : "核对 CI 部署回执"}</button><input ref={brokerDeploymentInput} type="file" accept="application/json,.json" onChange={readRemoteBrokerDeploymentProof} hidden /></>}</div>
              </div>
              <div className="remote-credential-renewal">
                <label><span>当前凭据到期时间</span><input type="datetime-local" value={localDateTimeValue(remoteExpiresAt)} onChange={(event) => { setRemoteExpiresAt(event.target.value ? new Date(event.target.value).toISOString() : ""); setRemoteClock(Date.now()); markManualCredential(); }} disabled={Boolean(busy)} /><small>手动凭据可补充；broker 响应会自动填写。</small></label>
                <label><span>可信续签服务 URL</span><input type="url" value={remoteBrokerUrl} onChange={(event) => { setRemoteBrokerUrl(event.target.value); setRemoteBrokerHealth(null); setRemoteBrokerReleaseReceipt(null); setRemoteBrokerDeploymentReceipt(null); setRemoteBrokerRunVerification(null); }} placeholder="http://127.0.0.1:4243/credentials" autoComplete="off" disabled={Boolean(busy)} /><small>可选本地模板仅监听回环；父级凭据留在代理进程。</small></label>
                <label><span>续签服务 Bearer（可选）</span><input type="password" value={remoteBrokerToken} onChange={(event) => { setRemoteBrokerToken(event.target.value); setRemoteBrokerHealth(null); }} placeholder="只留在当前页面内存" autoComplete="off" disabled={Boolean(busy)} /><small>不会发送给对象存储，也不会进入诊断摘要。</small></label>
                <label><span>申请寿命（秒）</span><input type="number" min={selectedRemoteRecipe.id === "amazon-s3" ? 900 : 300} max={selectedRemoteRecipe.id === "amazon-s3" ? 43200 : 604800} step={60} value={remoteBrokerTtlSeconds} onChange={(event) => setRemoteBrokerTtlSeconds(Number(event.target.value))} disabled={Boolean(busy)} /><small>默认 900 秒；AWS 上限 12 小时，R2 上限 7 天。</small></label>
                <div className="remote-broker-actions"><button onClick={() => void checkRemoteBroker()} disabled={!remoteBrokerUrl.trim() || Boolean(busy)}>{busy === "remote-broker-health" ? "检查中…" : "检查代理"}</button><button onClick={() => void renewRemoteCredentials()} disabled={!remoteRenewalReady || Boolean(busy)}>{busy === "remote-renew" ? "正在续签…" : "按需续签当前对象"}<span>↻</span></button></div>
              </div>
              <footer><i />续签请求只声明供应商、桶、当前对象 Key、Region、GET/PUT 意图与 TTL；不会上传现有 Access Key、Secret 或 Session Token。</footer>
            </section>
          </>
        )}
        <footer><p><i />只会传输已经加密和签名的同步包；GET/PUT 与续签均需当前用户点击。对象地址、Bearer、SigV4 和续签服务凭据都不会写入本地存储。</p><div><button onClick={() => void inspectRemoteObject()} disabled={!selectedChannel || !remoteConnectionReady || Boolean(busy)}>{busy === "remote-read" ? "正在检查…" : "连接并检查"}</button><button onClick={() => void publishRemoteObject()} disabled={!identity || !remotePublishReady || Boolean(busy)}>{busy === "remote-write" ? "正在条件发布…" : "条件发布密文"}<span>↗</span></button></div></footer>
      </article>

      <SyncRecoveryConsole
        identity={identity}
        channels={channels}
        selectedChannel={selectedChannel}
        busy={busy}
        setBusy={setBusy}
        setMessage={setMessage}
        onRecoveredChannels={installRecoveredChannels}
        onRetiredChannel={retireTransferredChannel}
        onStageBackup={onStageBackup}
      />

      {pairing && (
        <article className="pairing-proof">
          <div><span>PAIRING PROOF / 尚未授权</span><h3>{pairing.device.name}</h3><p>请求有效至 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(pairing.expiresAt))}</p></div>
          <code>{formatDeviceFingerprint(pairing.device.fingerprint)}</code>
          <footer><button onClick={() => { setPairing(null); setMessage("已丢弃设备请求，没有共享同步密钥。 "); }} disabled={Boolean(busy)}>丢弃请求</button><button onClick={() => void authorizePairing()} disabled={!selectedChannel || selectedChannel.role !== "owner" || Boolean(selectedChannel.retiredAt) || Boolean(busy)}>{busy === "authorize" ? "正在包装同步密钥…" : "指纹一致，授权设备"}<span>→</span></button></footer>
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
          {selectedChannel.authorizedDevices.map((device) => <div key={device.deviceId} className={`${device.deviceId === identity?.device.deviceId ? "current" : ""} ${pendingRevocationId === device.deviceId ? "pending-revoke" : ""}`}><i>{device.deviceId === selectedChannel.ownerDeviceId ? "O" : "D"}</i><strong>{device.name}</strong><code>{device.fingerprint.slice(0, 8).toUpperCase()}</code>{selectedChannel.role === "owner" && !selectedChannel.retiredAt && device.deviceId !== selectedChannel.ownerDeviceId && <button onClick={() => setPendingRevocationId(device.deviceId)} disabled={Boolean(busy)}>撤销</button>}</div>)}
          <small>{selectedChannel.retiredAt ? `该世代已于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selectedChannel.retiredAt))} 停用；只能保留历史证据，不能再授权或发布。` : "撤销会创建全新的空间 ID 和随机密钥；未撤销设备也必须重新请求授权。旧设备无法解锁新世代，但仍可能保有轮换前的旧数据。"}</small>
        </div>
      )}

      {selectedChannel && pendingRevocationId && (
        <article className="rotation-proof">
          <div><span>KEY ROTATION / 尚未执行</span><h3>撤销 {selectedChannel.authorizedDevices.find((device) => device.deviceId === pendingRevocationId)?.name || "目标设备"}</h3><p>将生成第 {(selectedChannel.generation || 1) + 1} 代空间；旧空间立即在本机停用，其他可信设备需要重新授权。</p></div>
          <code>{formatDeviceFingerprint(selectedChannel.authorizedDevices.find((device) => device.deviceId === pendingRevocationId)?.fingerprint || "")}</code>
          <footer><button onClick={() => setPendingRevocationId("")} disabled={Boolean(busy)}>取消</button><button onClick={() => void confirmRevocation()} disabled={Boolean(busy)}>{busy === "rotation" ? "正在生成新密钥…" : "确认撤销并轮换"}<span>→</span></button></footer>
        </article>
      )}

      {incoming && <div className={`sync-incoming-receipt ${incoming.relation}`}><span>{relationLabels[incoming.relation]}</span><strong>{incoming.fileName}</strong><small>来自 {incoming.authorName} · {incoming.revisionId.slice(0, 20)}… · 已送入下方{incoming.mergeAvailable ? "三方合并" : "恢复"}预检</small></div>}
    </section>
  );
}
