import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEnvelope, serializeBackupEnvelope } from "../app/features/backup-core.mjs";
import {
  acceptDeviceGrant,
  classifySyncRevision,
  createDeviceGrant,
  createPairingRequest,
  createSyncChannel,
  createSyncIdentity,
  createSyncPacket,
  decryptSyncPacket,
  inspectDeviceGrantText,
  inspectPairingRequestText,
  inspectSyncPacketText,
  serializeDeviceGrant,
  serializePairingRequest,
  serializeSyncPacket,
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

  const impersonated = structuredClone(localPacket);
  impersonated.author = packet.author;
  await assert.rejects(decryptSyncPacket(impersonated, ownerChannel), /签名无效/);
});
