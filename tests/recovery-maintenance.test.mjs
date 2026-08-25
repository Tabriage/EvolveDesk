import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text } from "../app/features/backup-core.mjs";
import {
  RECOVERY_DRILL_INTERVAL_DAYS,
  RECOVERY_REPLACEMENT_REVIEW_DAYS,
  assessSyncRecoveryMaintenance,
  assessSyncRecoveryMaintenanceAuditTrust,
  compareSyncRecoveryMaintenanceAuditToRecord,
  createSignedSyncRecoveryMaintenanceAudit,
  createSyncRecoveryMaintenanceAudit,
  createSyncRecoveryMaintenanceRecord,
  createSyncRecoverySecurityProfile,
  inspectSyncRecoveryMaintenanceAuditText,
  recordSyncRecoveryDrill,
  setSyncRecoveryMaintenanceConfirmation,
  serializeSyncRecoveryMaintenanceAudit,
  shouldTrackSyncRecoveryKit,
} from "../app/features/recovery-maintenance.mjs";
import { createSyncChannel, createSyncIdentity } from "../app/features/sync-core.mjs";

const owner = {
  deviceId: "device_owner_01",
  fingerprint: "a".repeat(64),
  name: "创建设备",
  authorizedAt: "2026-01-01T00:00:00.000Z",
  authorizedBy: "device_owner_01",
};

function channel(overrides = {}) {
  return {
    channelId: "channel_recovery_01",
    label: "恢复维护测试",
    createdAt: "2026-01-01T00:00:00.000Z",
    ownerDeviceId: owner.deviceId,
    role: "owner",
    generation: 1,
    previousChannelId: "",
    retiredAt: "",
    rotatedToChannelId: "",
    revokedDeviceIds: [],
    authorizedDevices: [owner],
    headRevisionId: "revision_current_01",
    lastPacketAt: "2026-01-02T00:00:00.000Z",
    mergeParentRevisionIds: [],
    ...overrides,
  };
}

function recovery(recoveryId = "recovery_material_01", createdAt = "2026-01-02T00:00:00.000Z") {
  return {
    delegation: {
      recoveryId,
      createdAt,
      channel: { channelId: "channel_recovery_01", generation: 1, headRevisionId: "revision_current_01" },
      owner,
    },
  };
}

function drill(profile, recoveryId = "recovery_material_01", drilledAt = "2026-01-03T00:00:00.000Z", packetRevisionId = "revision_current_01") {
  return {
    recoveryId,
    channelId: "channel_recovery_01",
    generation: 1,
    drilledAt,
    packetRevisionId,
    packetCreatedAt: "2026-01-02T12:00:00.000Z",
    packetAuthorFingerprint: owner.fingerprint,
    workspaceVersion: 11,
    securityProfileHash: profile.hash,
    authorizedDeviceCount: profile.authorizedDeviceCount,
    revokedDeviceCount: profile.revokedDeviceCount,
  };
}

test("recovery maintenance distinguishes a downloaded kit from a completed drill", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  const record = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  const assessment = await assessSyncRecoveryMaintenance(current, record, "2026-01-03T00:00:00.000Z");

  assert.equal(assessment.status, "drill-due");
  assert.equal(assessment.checklist.find((item) => item.id === "kit").done, true);
  assert.equal(assessment.checklist.find((item) => item.id === "drill").done, false);
  assert.equal(record.lastDrill, null);
});

test("a current drill and explicit separate-storage confirmation make the seal ready", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  let record = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  record = recordSyncRecoveryDrill(record, drill(profile));
  record = setSyncRecoveryMaintenanceConfirmation(record, "separate-storage", true, "2026-01-03T00:05:00.000Z");
  const assessment = await assessSyncRecoveryMaintenance(current, record, "2026-02-01T00:00:00.000Z");

  assert.equal(assessment.status, "ready");
  assert.equal(assessment.nextDrillAt, `2026-04-03T00:00:00.000Z`);
  assert.equal(RECOVERY_DRILL_INTERVAL_DAYS, 90);
});

test("recovery maintenance audits seal only non-content metadata for offline inspection", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  let record = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  record = recordSyncRecoveryDrill(record, drill(profile));
  record = setSyncRecoveryMaintenanceConfirmation(record, "separate-storage", true, "2026-01-03T00:05:00.000Z");
  const receipt = await createSyncRecoveryMaintenanceAudit(record, "2026-02-01T00:00:00.000Z");
  const serialized = serializeSyncRecoveryMaintenanceAudit(receipt);
  const inspection = await inspectSyncRecoveryMaintenanceAuditText(serialized);
  const comparison = compareSyncRecoveryMaintenanceAuditToRecord(inspection.receipt, record);

  assert.match(receipt.receiptId, /^recovery_audit_[0-9a-f]{32}$/);
  assert.match(inspection.digest, /^[0-9a-f]{64}$/);
  assert.equal(inspection.hasDrill, true);
  assert.equal(inspection.nextDrillAt, "2026-04-03T00:00:00.000Z");
  assert.equal(inspection.replacementReviewAt, "2026-07-01T00:00:00.000Z");
  assert.equal(inspection.separateStorageConfirmed, true);
  assert.equal(inspection.signed, false);
  assert.equal(inspection.signatureValid, false);
  assert.equal(comparison.matches, true);
  assert.equal(serialized.includes("恢复维护测试"), false);
  assert.equal(serialized.includes("passphrase"), false);
  assert.equal(serialized.includes("privateKey"), false);
});

test("device-signed recovery audits verify offline and trust only the saved original owner", async () => {
  const identity = await createSyncIdentity("恢复签发设备", "2026-02-02T08:00:00.000Z");
  const current = await createSyncChannel(identity, "可信恢复空间", "2026-02-02T08:01:00.000Z");
  const profile = await createSyncRecoverySecurityProfile(current);
  const kit = {
    delegation: {
      recoveryId: "recovery_signed_audit_01",
      createdAt: "2026-02-02T08:02:00.000Z",
      channel: { channelId: current.channelId, generation: current.generation, headRevisionId: current.headRevisionId },
      owner: identity.device,
    },
  };
  const record = createSyncRecoveryMaintenanceRecord(current, kit, profile, "2026-02-02T08:03:00.000Z");
  const receipt = await createSignedSyncRecoveryMaintenanceAudit(record, identity, "2026-02-02T08:04:00.000Z");
  const serialized = serializeSyncRecoveryMaintenanceAudit(receipt);
  const inspection = await inspectSyncRecoveryMaintenanceAuditText(serialized);
  const trusted = await assessSyncRecoveryMaintenanceAuditTrust(inspection.receipt, [current]);
  const unknown = await assessSyncRecoveryMaintenanceAuditTrust(inspection.receipt, []);
  const revoked = await assessSyncRecoveryMaintenanceAuditTrust(inspection.receipt, [{ ...current, revokedDeviceIds: [identity.device.deviceId] }]);
  const wrongGeneration = await assessSyncRecoveryMaintenanceAuditTrust(inspection.receipt, [{ ...current, generation: current.generation + 1 }]);
  const stranger = await createSyncIdentity("自带公钥设备", "2026-02-02T08:05:00.000Z");
  const selfAssertedRecord = { ...record, ownerFingerprint: stranger.device.fingerprint };
  const selfAssertedReceipt = await createSignedSyncRecoveryMaintenanceAudit(selfAssertedRecord, stranger, "2026-02-02T08:06:00.000Z");
  const selfAssertedInspection = await inspectSyncRecoveryMaintenanceAuditText(serializeSyncRecoveryMaintenanceAudit(selfAssertedReceipt));
  const selfAssertedTrust = await assessSyncRecoveryMaintenanceAuditTrust(selfAssertedInspection.receipt, [current]);

  assert.equal(receipt.formatVersion, 2);
  assert.equal(receipt.signer.fingerprint, record.ownerFingerprint);
  assert.equal(serialized.includes("signingPrivateKey"), false);
  assert.equal(serialized.includes("ciphertext"), false);
  assert.equal(serialized.includes("passphrase"), false);
  assert.equal(inspection.sealed, true);
  assert.equal(inspection.signed, true);
  assert.equal(inspection.signatureValid, true);
  assert.equal(trusted.trusted, true);
  assert.equal(trusted.ownerMatches, true);
  assert.equal(trusted.generationMatches, true);
  assert.equal(trusted.channelLabel, "可信恢复空间");
  assert.equal(unknown.trusted, false);
  assert.equal(unknown.channelKnown, false);
  assert.equal(revoked.trusted, false);
  assert.match(revoked.reason, /撤销/);
  assert.equal(wrongGeneration.trusted, false);
  assert.equal(wrongGeneration.generationMatches, false);
  assert.equal(selfAssertedInspection.signatureValid, true);
  assert.equal(selfAssertedTrust.trusted, false);
  assert.equal(selfAssertedTrust.ownerMatches, false);
  assert.match(selfAssertedTrust.reason, /不是.*原创所有者/);
});

test("a recomputed SHA seal cannot forge a device-signed recovery audit", async () => {
  const identity = await createSyncIdentity("恢复防伪设备", "2026-02-03T08:00:00.000Z");
  const current = await createSyncChannel(identity, "恢复防伪空间", "2026-02-03T08:01:00.000Z");
  const profile = await createSyncRecoverySecurityProfile(current);
  const kit = {
    delegation: {
      recoveryId: "recovery_forgery_audit_01",
      createdAt: "2026-02-03T08:02:00.000Z",
      channel: { channelId: current.channelId, generation: current.generation, headRevisionId: current.headRevisionId },
      owner: identity.device,
    },
  };
  const record = createSyncRecoveryMaintenanceRecord(current, kit, profile, "2026-02-03T08:03:00.000Z");
  const receipt = await createSignedSyncRecoveryMaintenanceAudit(record, identity, "2026-02-03T08:04:00.000Z");
  const forged = structuredClone(receipt);
  forged.record.authorizedDeviceCount = 2;
  const content = structuredClone(forged);
  delete content.receiptId;
  delete content.integrity;
  delete content.proof;
  const digest = await sha256Text(JSON.stringify(content));
  forged.receiptId = `recovery_audit_${digest.slice(0, 32)}`;
  forged.integrity = { algorithm: "SHA-256", digest };

  await assert.rejects(inspectSyncRecoveryMaintenanceAuditText(JSON.stringify(forged)), /设备声明签名无效/);
  const stranger = await createSyncIdentity("非所有者设备", "2026-02-03T08:05:00.000Z");
  await assert.rejects(createSignedSyncRecoveryMaintenanceAudit(record, stranger), /原创所有者/);
});

test("offline recovery audit inspection rejects hidden fields, tampering, and another local record", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  const record = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  const receipt = await createSyncRecoveryMaintenanceAudit(record, "2026-02-01T00:00:00.000Z");
  const tampered = structuredClone(receipt);
  tampered.record.generation = 2;
  await assert.rejects(inspectSyncRecoveryMaintenanceAuditText(JSON.stringify(tampered)), /完整性封签不一致/);
  const hidden = structuredClone(receipt);
  hidden.record.recoveryPassphrase = "不应出现";
  await assert.rejects(inspectSyncRecoveryMaintenanceAuditText(JSON.stringify(hidden)), /缺失或未声明字段/);
  const anotherRecord = createSyncRecoveryMaintenanceRecord(current, recovery("recovery_material_02", "2026-02-02T00:00:00.000Z"), profile, "2026-02-02T00:01:00.000Z", record);
  assert.equal(compareSyncRecoveryMaintenanceAuditToRecord(receipt, anotherRecord).matches, false);
});

test("head changes request a new packet while authorization changes require a new kit", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  let record = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  record = recordSyncRecoveryDrill(record, drill(profile));
  record = setSyncRecoveryMaintenanceConfirmation(record, "separate-storage", true, "2026-01-03T00:05:00.000Z");

  const newerHead = await assessSyncRecoveryMaintenance(channel({ headRevisionId: "revision_current_02" }), record, "2026-02-01T00:00:00.000Z");
  assert.equal(newerHead.status, "packet-refresh");

  const member = { ...owner, deviceId: "device_member_02", fingerprint: "b".repeat(64), name: "成员设备" };
  const changedMembers = await assessSyncRecoveryMaintenance(channel({ authorizedDevices: [owner, member] }), record, "2026-02-01T00:00:00.000Z");
  assert.equal(changedMembers.status, "replace");
  assert.match(changedMembers.reasons.join(" "), /授权或撤销设备清单/);
});

test("maintenance cadence is explicit and replacement keeps old-copy confirmation manual", async () => {
  const current = channel();
  const profile = await createSyncRecoverySecurityProfile(current);
  let first = createSyncRecoveryMaintenanceRecord(current, recovery(), profile, "2026-01-02T00:01:00.000Z");
  first = recordSyncRecoveryDrill(first, drill(profile));
  first = setSyncRecoveryMaintenanceConfirmation(first, "separate-storage", true, "2026-01-03T00:05:00.000Z");
  const overdue = await assessSyncRecoveryMaintenance(current, first, "2026-04-03T00:00:00.000Z");
  assert.equal(overdue.status, "drill-due");

  const reviewDue = await assessSyncRecoveryMaintenance(current, first, "2026-07-01T00:00:00.000Z");
  assert.equal(reviewDue.status, "replace");
  assert.equal(RECOVERY_REPLACEMENT_REVIEW_DAYS, 180);

  const secondKit = recovery("recovery_material_02", "2026-07-01T00:01:00.000Z");
  assert.equal(shouldTrackSyncRecoveryKit(first, recovery("recovery_material_old", "2026-01-01T23:00:00.000Z")), false);
  assert.equal(shouldTrackSyncRecoveryKit(first, secondKit), true);
  let second = createSyncRecoveryMaintenanceRecord(current, secondKit, profile, "2026-07-01T00:02:00.000Z", first);
  second = recordSyncRecoveryDrill(second, drill(profile, "recovery_material_02", "2026-07-01T01:00:00.000Z"));
  second = setSyncRecoveryMaintenanceConfirmation(second, "separate-storage", true, "2026-07-01T01:05:00.000Z");
  assert.equal((await assessSyncRecoveryMaintenance(current, second, "2026-07-02T00:00:00.000Z")).status, "storage-action");
  second = setSyncRecoveryMaintenanceConfirmation(second, "retire-old-copies", true, "2026-07-02T00:05:00.000Z");
  assert.equal((await assessSyncRecoveryMaintenance(current, second, "2026-07-02T01:00:00.000Z")).status, "ready");
});
