import assert from "node:assert/strict";
import test from "node:test";
import {
  RECOVERY_DRILL_INTERVAL_DAYS,
  RECOVERY_REPLACEMENT_REVIEW_DAYS,
  assessSyncRecoveryMaintenance,
  createSyncRecoveryMaintenanceRecord,
  createSyncRecoverySecurityProfile,
  recordSyncRecoveryDrill,
  setSyncRecoveryMaintenanceConfirmation,
  shouldTrackSyncRecoveryKit,
} from "../app/features/recovery-maintenance.mjs";

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
