import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEnvelope, serializeBackupEnvelope } from "../app/features/backup-core.mjs";
import {
  SYNC_PACKET_FORMAT,
  acceptDeviceGrant,
  acceptSyncOwnershipTransfer,
  acceptSyncRotation,
  classifySyncRevision,
  createDeviceGrant,
  createPairingRequest,
  createSyncChannel,
  createSyncIdentity,
  createSyncPacket,
  createSyncRecoveryKit,
  decryptSyncPacket,
  inspectDeviceGrantText,
  inspectPairingRequestText,
  inspectSyncPacketText,
  inspectSyncOwnershipTransferText,
  inspectSyncRecoveryKitText,
  inspectSyncRotationText,
  recoverSyncOwnership,
  rotateSyncChannel,
  serializeDeviceGrant,
  serializePairingRequest,
  serializeSyncPacket,
  serializeSyncOwnershipTransfer,
  serializeSyncRecoveryKit,
  serializeSyncRotation,
  verifySyncRecoveryDrill,
} from "../app/features/sync-core.mjs";
import { addTask, createInitialWorkbench } from "../app/features/workbench-core.mjs";

const emptySources = { transcripts: [], visualFrames: [] };

async function backupText(title = "同步前先核对密文") {
  const workspace = addTask(createInitialWorkbench(), { title, source: "manual" });
  return serializeBackupEnvelope(await createBackupEnvelope(workspace, emptySources, "2026-08-16T08:00:00.000Z"));
}

async function pairedDevices() {
  const owner = await createSyncIdentity("书房 Mac", "2026-08-16T07:00:00.000Z");
  const member = await createSyncIdentity("随身电脑", "2026-08-16T07:05:00.000Z");
  const ownerChannel = await createSyncChannel(owner, "私人工作台", "2026-08-16T07:10:00.000Z");
  const request = await createPairingRequest(member, "2026-08-16T07:15:00.000Z");
  const inspectedRequest = await inspectPairingRequestText(serializePairingRequest(request), new Date("2026-08-16T07:20:00.000Z"));
  const granted = await createDeviceGrant(ownerChannel, owner, inspectedRequest, "2026-08-16T07:25:00.000Z");
  const grant = await inspectDeviceGrantText(serializeDeviceGrant(granted.grant), new Date("2026-08-16T07:30:00.000Z"));
  const memberChannel = await acceptDeviceGrant(grant, member, "2026-08-16T07:31:00.000Z");
  return { owner, member, grant, ownerChannel: granted.channel, memberChannel };
}

test("explicit ECDH device grant transfers a channel key without exposing it in JSON", async () => {
  const { grant, ownerChannel, memberChannel } = await pairedDevices();
  const ownerSecret = Buffer.from(await crypto.subtle.exportKey("raw", ownerChannel.key)).toString("hex");

  assert.equal(ownerChannel.key.extractable, true);
  assert.equal(memberChannel.key.extractable, false);
  assert.equal(memberChannel.role, "member");
  assert.equal(memberChannel.authorizedDevices.length, 2);
  assert.equal(JSON.stringify(grant).includes(ownerSecret), false);
  assert.equal(JSON.stringify(memberChannel.authorizedDevices).includes(ownerSecret), false);
});

test("sync packets hide workspace plaintext and round-trip on an authorized device", async () => {
  const { owner, ownerChannel, memberChannel } = await pairedDevices();
  const packet = await createSyncPacket(await backupText(), ownerChannel, owner, "2026-08-16T08:01:00.000Z");
  const serialized = serializeSyncPacket(packet);
  const inspected = inspectSyncPacketText(serialized);
  const opened = await decryptSyncPacket(inspected, memberChannel);

  assert.equal(serialized.includes("同步前先核对密文"), false);
  assert.equal(serialized.includes(owner.device.name), false);
  assert.equal(serialized.includes("2026-08-16T08:00:00.000Z"), false);
  assert.equal(opened.parsed.workspace.tasks[0].title, "同步前先核对密文");
  assert.equal(opened.relation, "initial");
  assert.equal(classifySyncRevision(packet.revisionId, packet), "duplicate");
  assert.equal(classifySyncRevision(packet.parentRevisionId, packet), packet.parentRevisionId ? "forward" : "initial");
});

test("v2 readers retain authenticated compatibility with v1 sync packets", async () => {
  const { owner, memberChannel, ownerChannel } = await pairedDevices();
  const plaintext = await backupText("旧版同步包仍可恢复");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: SYNC_PACKET_FORMAT,
    formatVersion: 1,
    channelId: ownerChannel.channelId,
    revisionId: "revision_legacy_v1",
    parentRevisionId: "",
    createdAt: "2026-08-16T08:00:30.000Z",
    author: { deviceId: owner.device.deviceId, fingerprint: owner.device.fingerprint },
    innerFormat: "evolve-desk.backup",
    innerFormatVersion: 1,
    cipher: { name: "AES-GCM", keyLength: 256, iv: Buffer.from(iv).toString("base64"), tagLength: 128 },
  };
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(JSON.stringify(header)), tagLength: 128 }, ownerChannel.key, new TextEncoder().encode(plaintext));
  const unsigned = { ...header, ciphertext: Buffer.from(ciphertext).toString("base64") };
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, owner.signingPrivateKey, new TextEncoder().encode(JSON.stringify(unsigned)));
  const legacy = { ...unsigned, proof: { name: "ECDSA", hash: "SHA-256", signature: Buffer.from(signature).toString("base64") } };
  const opened = await decryptSyncPacket(inspectSyncPacketText(JSON.stringify(legacy)), memberChannel);

  assert.equal(opened.packet.formatVersion, 1);
  assert.equal(opened.parsed.workspace.tasks[0].title, "旧版同步包仍可恢复");
});

test("authenticated sync header and ciphertext reject modification", async () => {
  const { owner, ownerChannel, memberChannel } = await pairedDevices();
  const packet = await createSyncPacket(await backupText(), ownerChannel, owner, "2026-08-16T08:01:00.000Z");
  const retimed = structuredClone(packet);
  retimed.createdAt = "2026-08-16T09:01:00.000Z";
  await assert.rejects(decryptSyncPacket(retimed, memberChannel), /签名无效/);

  const modified = structuredClone(packet);
  modified.ciphertext = `${modified.ciphertext[0] === "A" ? "B" : "A"}${modified.ciphertext.slice(1)}`;
  await assert.rejects(decryptSyncPacket(modified, memberChannel), /签名无效/);
});

test("a grant is bound to the requesting device and expires", async () => {
  const owner = await createSyncIdentity("主设备", "2026-08-16T07:00:00.000Z");
  const target = await createSyncIdentity("目标设备", "2026-08-16T07:01:00.000Z");
  const stranger = await createSyncIdentity("其他设备", "2026-08-16T07:02:00.000Z");
  const channel = await createSyncChannel(owner, "私人工作台", "2026-08-16T07:03:00.000Z");
  const request = await createPairingRequest(target, "2026-08-16T07:04:00.000Z");
  const { grant } = await createDeviceGrant(channel, owner, request, "2026-08-16T07:05:00.000Z");

  await assert.rejects(acceptDeviceGrant(grant, stranger, "2026-08-16T07:06:00.000Z"), /不属于当前设备/);
  await assert.rejects(inspectDeviceGrantText(serializeDeviceGrant(grant), new Date("2026-08-17T07:05:01.000Z")), /已过期/);

  const renamedRequest = structuredClone(request);
  renamedRequest.device.name = "被替换的目标设备";
  await assert.rejects(inspectPairingRequestText(serializePairingRequest(renamedRequest), new Date("2026-08-16T07:06:00.000Z")), /签名无效/);

  const relabeledGrant = structuredClone(grant);
  relabeledGrant.channel.label = "被替换的同步空间";
  await assert.rejects(inspectDeviceGrantText(serializeDeviceGrant(relabeledGrant), new Date("2026-08-16T07:06:00.000Z")), /签名无效/);
});

test("unknown device packets and diverged version chains are surfaced", async () => {
  const { owner, member, ownerChannel, memberChannel } = await pairedDevices();
  const packet = await createSyncPacket(await backupText(), ownerChannel, owner, "2026-08-16T08:01:00.000Z");
  const unknownAuthor = structuredClone(memberChannel);
  unknownAuthor.authorizedDevices = unknownAuthor.authorizedDevices.filter((device) => device.deviceId !== owner.device.deviceId);
  await assert.rejects(decryptSyncPacket(packet, unknownAuthor), /尚未信任/);

  const localPacket = await createSyncPacket(await backupText("本地分支"), memberChannel, member, "2026-08-16T08:02:00.000Z");
  assert.equal(classifySyncRevision(localPacket.revisionId, packet), "diverged");

  const mergeChannel = { ...memberChannel, headRevisionId: localPacket.revisionId, mergeParentRevisionIds: [packet.revisionId] };
  const mergePacket = await createSyncPacket(await backupText("已审阅的合并结果"), mergeChannel, member, "2026-08-16T08:03:00.000Z");
  assert.equal(classifySyncRevision(packet.revisionId, mergePacket), "forward");
  assert.deepEqual(mergePacket.mergeParentRevisionIds, [packet.revisionId]);

  const impersonated = structuredClone(localPacket);
  impersonated.author = packet.author;
  await assert.rejects(decryptSyncPacket(impersonated, ownerChannel), /签名无效/);
});

test("revoking a device rotates the channel key and requires retained devices to reauthorize", async () => {
  const owner = await createSyncIdentity("创建设备", "2026-08-20T07:00:00.000Z");
  const revokedDevice = await createSyncIdentity("遗失设备", "2026-08-20T07:01:00.000Z");
  const retainedDevice = await createSyncIdentity("保留设备", "2026-08-20T07:02:00.000Z");
  let ownerChannel = await createSyncChannel(owner, "轮换空间", "2026-08-20T07:03:00.000Z");

  const revokedRequest = await createPairingRequest(revokedDevice, "2026-08-20T07:04:00.000Z");
  const revokedGrant = await createDeviceGrant(ownerChannel, owner, revokedRequest, "2026-08-20T07:05:00.000Z");
  ownerChannel = revokedGrant.channel;
  const revokedChannel = await acceptDeviceGrant(revokedGrant.grant, revokedDevice, "2026-08-20T07:06:00.000Z");

  const retainedRequest = await createPairingRequest(retainedDevice, "2026-08-20T07:07:00.000Z");
  const retainedGrant = await createDeviceGrant(ownerChannel, owner, retainedRequest, "2026-08-20T07:08:00.000Z");
  ownerChannel = retainedGrant.channel;
  const retainedChannel = await acceptDeviceGrant(retainedGrant.grant, retainedDevice, "2026-08-20T07:09:00.000Z");

  const oldSecret = Buffer.from(await crypto.subtle.exportKey("raw", ownerChannel.key)).toString("hex");
  const rotated = await rotateSyncChannel(ownerChannel, owner, [revokedDevice.device.deviceId], "2026-08-20T07:10:00.000Z");
  const newSecret = Buffer.from(await crypto.subtle.exportKey("raw", rotated.nextChannel.key)).toString("hex");
  const rotationText = serializeSyncRotation(rotated.rotation);
  const inspected = await inspectSyncRotationText(rotationText);

  assert.notEqual(oldSecret, newSecret);
  assert.equal(rotationText.includes(oldSecret), false);
  assert.equal(rotationText.includes(newSecret), false);
  assert.equal(rotated.retiredChannel.rotatedToChannelId, rotated.nextChannel.channelId);
  assert.equal(rotated.nextChannel.generation, 2);
  assert.equal(rotated.nextChannel.previousChannelId, ownerChannel.channelId);
  assert.deepEqual(rotated.nextChannel.revokedDeviceIds, [revokedDevice.device.deviceId]);
  assert.deepEqual(rotated.nextChannel.authorizedDevices.map((device) => device.deviceId), [owner.device.deviceId]);
  await assert.rejects(createSyncPacket(await backupText(), rotated.retiredChannel, owner, "2026-08-20T07:11:00.000Z"), /停用/);

  const revokedResult = await acceptSyncRotation(inspected, revokedChannel, revokedDevice);
  const retainedResult = await acceptSyncRotation(inspected, retainedChannel, retainedDevice);
  assert.equal(revokedResult.status, "revoked");
  assert.equal(retainedResult.status, "reauthorize");
  assert.equal(retainedResult.channel.retiredAt, "2026-08-20T07:10:00.000Z");

  const nextRequest = await createPairingRequest(retainedDevice, "2026-08-20T07:12:00.000Z");
  const nextGrant = await createDeviceGrant(rotated.nextChannel, owner, nextRequest, "2026-08-20T07:13:00.000Z");
  const nextRetainedChannel = await acceptDeviceGrant(nextGrant.grant, retainedDevice, "2026-08-20T07:14:00.000Z");
  assert.equal(nextRetainedChannel.generation, 2);
  assert.equal(nextRetainedChannel.previousChannelId, ownerChannel.channelId);
  const revokedRetry = await createPairingRequest(revokedDevice, "2026-08-20T07:14:30.000Z");
  await assert.rejects(createDeviceGrant(nextGrant.channel, owner, revokedRetry, "2026-08-20T07:14:40.000Z"), /已被空间密钥轮换撤销/);

  const nextPacket = await createSyncPacket(await backupText("只有新世代可以解锁"), nextGrant.channel, owner, "2026-08-20T07:15:00.000Z");
  const opened = await decryptSyncPacket(nextPacket, nextRetainedChannel);
  assert.equal(opened.parsed.workspace.tasks[0].title, "只有新世代可以解锁");
  await assert.rejects(decryptSyncPacket(nextPacket, revokedChannel), /不属于当前设备已加入的同步空间/);
});

test("rotation records reject tampering and non-owner rotation attempts", async () => {
  const owner = await createSyncIdentity("创建设备", "2026-08-20T08:00:00.000Z");
  const member = await createSyncIdentity("成员设备", "2026-08-20T08:01:00.000Z");
  const ownerChannel = await createSyncChannel(owner, "签名轮换", "2026-08-20T08:02:00.000Z");
  const request = await createPairingRequest(member, "2026-08-20T08:03:00.000Z");
  const granted = await createDeviceGrant(ownerChannel, owner, request, "2026-08-20T08:04:00.000Z");
  const memberChannel = await acceptDeviceGrant(granted.grant, member, "2026-08-20T08:05:00.000Z");

  await assert.rejects(rotateSyncChannel(memberChannel, member, [owner.device.deviceId], "2026-08-20T08:06:00.000Z"), /创建设备/);
  const rotated = await rotateSyncChannel(granted.channel, owner, [member.device.deviceId], "2026-08-20T08:06:00.000Z");
  const tampered = structuredClone(rotated.rotation);
  tampered.next.label = "被替换的空间名称";
  await assert.rejects(inspectSyncRotationText(serializeSyncRotation(tampered)), /签名无效/);
});

test("an owner-authorized recovery kit migrates ownership and rotates the channel key", async () => {
  const { owner, member, ownerChannel, memberChannel } = await pairedDevices();
  const packet = await createSyncPacket(await backupText("离线恢复后的真实工作台"), ownerChannel, owner, "2026-08-16T08:01:00.000Z");
  const channelAtHead = { ...ownerChannel, headRevisionId: packet.revisionId, lastPacketAt: packet.createdAt };
  const memberAtHead = { ...memberChannel, headRevisionId: packet.revisionId, lastPacketAt: packet.createdAt };
  const oldSecret = Buffer.from(await crypto.subtle.exportKey("raw", ownerChannel.key)).toString("base64");
  const recovery = await createSyncRecoveryKit(channelAtHead, owner, "correct horse battery staple", "2026-08-16T08:02:00.000Z");
  const recoveryText = serializeSyncRecoveryKit(recovery);
  const inspectedRecovery = await inspectSyncRecoveryKitText(recoveryText);
  const drill = await verifySyncRecoveryDrill(inspectedRecovery, "correct horse battery staple", serializeSyncPacket(packet), "2026-08-16T08:03:00.000Z");
  const replacement = await createSyncIdentity("接任设备", "2026-08-16T08:03:00.000Z");
  const result = await recoverSyncOwnership(inspectedRecovery, "correct horse battery staple", replacement, serializeSyncPacket(packet), "2026-08-16T08:04:00.000Z");
  const newSecret = Buffer.from(await crypto.subtle.exportKey("raw", result.nextChannel.key)).toString("base64");
  const transferText = serializeSyncOwnershipTransfer(result.transfer);
  const transfer = await inspectSyncOwnershipTransferText(transferText);
  const accepted = await acceptSyncOwnershipTransfer(transfer, memberAtHead, member);
  const replacedOwner = await acceptSyncOwnershipTransfer(transfer, channelAtHead, owner);

  assert.equal(recoveryText.includes(oldSecret), false);
  assert.equal(recoveryText.includes("离线恢复后的真实工作台"), false);
  assert.equal(JSON.stringify(drill).includes("离线恢复后的真实工作台"), false);
  assert.equal(drill.recoveryId, recovery.delegation.recoveryId);
  assert.equal(drill.packetRevisionId, packet.revisionId);
  assert.equal(drill.securityProfileHash.length, 64);
  assert.equal(drill.authorizedDeviceCount, 2);
  assert.equal(ownerChannel.retiredAt, "");
  assert.notEqual(oldSecret, newSecret);
  assert.equal(transferText.includes(oldSecret), false);
  assert.equal(transferText.includes(newSecret), false);
  assert.equal(result.retiredChannel.retiredAt, "2026-08-16T08:04:00.000Z");
  assert.equal(result.retiredChannel.rotatedToChannelId, result.nextChannel.channelId);
  assert.equal(result.nextChannel.ownerDeviceId, replacement.device.deviceId);
  assert.equal(result.nextChannel.role, "owner");
  assert.equal(result.nextChannel.generation, 2);
  assert.equal(result.nextChannel.previousChannelId, ownerChannel.channelId);
  assert.deepEqual(result.nextChannel.authorizedDevices.map((device) => device.deviceId), [replacement.device.deviceId]);
  assert.equal(result.nextChannel.revokedDeviceIds.includes(owner.device.deviceId), true);
  assert.equal(result.recovered.parsed.workspace.tasks[0].title, "离线恢复后的真实工作台");
  assert.equal(accepted.status, "reauthorize");
  assert.equal(accepted.channel.retiredAt, result.transfer.transferredAt);
  assert.equal(replacedOwner.status, "owner-replaced");

  const request = await createPairingRequest(member, "2026-08-16T08:05:00.000Z");
  const granted = await createDeviceGrant(result.nextChannel, replacement, request, "2026-08-16T08:06:00.000Z");
  const reauthorized = await acceptDeviceGrant(granted.grant, member, "2026-08-16T08:07:00.000Z");
  assert.equal(reauthorized.ownerDeviceId, replacement.device.deviceId);
  assert.equal(reauthorized.generation, 2);
  const replacedRequest = await createPairingRequest(owner, "2026-08-16T08:08:00.000Z");
  await assert.rejects(createDeviceGrant(granted.channel, replacement, replacedRequest, "2026-08-16T08:09:00.000Z"), /已被空间密钥轮换撤销/);
  await assert.rejects(acceptSyncOwnershipTransfer(transfer, { ...memberAtHead, headRevisionId: "revision_another_head" }, member), /版本头.*不一致/);
});

test("recovery rejects wrong passwords, stale packets, original-owner reuse, and transfer tampering", async () => {
  const { owner, member, ownerChannel, memberChannel } = await pairedDevices();
  const currentPacket = await createSyncPacket(await backupText("恢复版本"), ownerChannel, owner, "2026-08-16T09:01:00.000Z");
  const stalePacket = await createSyncPacket(await backupText("过旧版本"), ownerChannel, owner, "2026-08-16T08:30:00.000Z");
  const recovery = await createSyncRecoveryKit({ ...ownerChannel, headRevisionId: currentPacket.revisionId }, owner, "a sufficiently long recovery passphrase", "2026-08-16T09:02:00.000Z");
  const replacement = await createSyncIdentity("恢复设备", "2026-08-16T09:03:00.000Z");

  await assert.rejects(createSyncRecoveryKit(memberChannel, member, "a sufficiently long recovery passphrase", "2026-08-16T09:02:30.000Z"), /创建设备/);
  await assert.rejects(verifySyncRecoveryDrill(recovery, "this is the wrong passphrase", serializeSyncPacket(currentPacket), "2026-08-16T09:04:00.000Z"), /口令不正确/);
  await assert.rejects(recoverSyncOwnership(recovery, "this is the wrong passphrase", replacement, serializeSyncPacket(currentPacket), "2026-08-16T09:04:00.000Z"), /口令不正确/);
  await assert.rejects(recoverSyncOwnership(recovery, "a sufficiently long recovery passphrase", replacement, serializeSyncPacket(stalePacket), "2026-08-16T09:04:00.000Z"), /拒绝回退恢复/);
  await assert.rejects(recoverSyncOwnership(recovery, "a sufficiently long recovery passphrase", owner, serializeSyncPacket(currentPacket), "2026-08-16T09:04:00.000Z"), /仍在使用/);

  const result = await recoverSyncOwnership(recovery, "a sufficiently long recovery passphrase", replacement, serializeSyncPacket(currentPacket), "2026-08-16T09:04:00.000Z");
  const tampered = structuredClone(result.transfer);
  tampered.next.label = "被替换的恢复空间";
  await assert.rejects(inspectSyncOwnershipTransferText(serializeSyncOwnershipTransfer(tampered)), /新空间世代无效|签名无效/);
});
