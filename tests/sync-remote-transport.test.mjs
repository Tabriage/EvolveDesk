import assert from "node:assert/strict";
import test from "node:test";
import { createBackupEnvelope, serializeBackupEnvelope } from "../app/features/backup-core.mjs";
import { createHttpSyncTransport, normalizeRemoteTransportConfig } from "../app/features/sync-remote-transport.mjs";
import { createSyncChannel, createSyncIdentity, createSyncPacket, serializeSyncPacket } from "../app/features/sync-core.mjs";
import { addTask, createInitialWorkbench } from "../app/features/workbench-core.mjs";

async function packetFixture(headRevisionId = "") {
  const identity = await createSyncIdentity("条件写入设备", "2026-08-19T08:00:00.000Z");
  const channel = await createSyncChannel(identity, "远端条件对象", "2026-08-19T08:01:00.000Z");
  channel.headRevisionId = headRevisionId;
  const workspace = addTask(createInitialWorkbench(), { title: "只上传密文", source: "manual" });
  const backup = await createBackupEnvelope(workspace, { transcripts: [], visualFrames: [] }, "2026-08-19T08:02:00.000Z");
  const packet = await createSyncPacket(serializeBackupEnvelope(backup), channel, identity, "2026-08-19T08:03:00.000Z");
  return { channel, packet, text: serializeSyncPacket(packet) };
}

function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

test("remote transport accepts HTTPS and loopback HTTP without embedding credentials", () => {
  assert.equal(normalizeRemoteTransportConfig({ objectUrl: "https://sync.example/evolve.json" }).objectUrl, "https://sync.example/evolve.json");
  assert.equal(normalizeRemoteTransportConfig({ objectUrl: "http://localhost:8787/evolve.json" }).objectUrl, "http://localhost:8787/evolve.json");
  assert.throws(() => normalizeRemoteTransportConfig({ objectUrl: "http://sync.example/evolve.json" }), /HTTPS/);
  assert.throws(() => normalizeRemoteTransportConfig({ objectUrl: "https://user:secret@sync.example/evolve.json" }), /账号、密码/);
});

test("remote reads validate packet channel and keep authorization out of storage", async () => {
  const { channel, packet, text } = await packetFixture();
  const calls = [];
  const transport = createHttpSyncTransport({ objectUrl: "https://sync.example/evolve.json", bearerToken: "memory-only-token" }, async (url, options) => {
    calls.push({ url, options });
    return response(text, 200, { ETag: '"version-one"' });
  });
  const result = await transport.read(channel.channelId);

  assert.equal(result.revisionId, packet.revisionId);
  assert.equal(result.validator, '"version-one"');
  assert.equal(calls[0].options.headers.Authorization, "Bearer memory-only-token");
  assert.equal(JSON.stringify(result).includes("memory-only-token"), false);

  await assert.rejects(transport.read("channel_other_space"), /不属于当前同步空间/);
});

test("first remote write uses If-None-Match and confirms the persisted revision", async () => {
  const { channel, packet, text } = await packetFixture();
  const calls = [];
  let stored = null;
  const transport = createHttpSyncTransport({ objectUrl: "https://sync.example/evolve.json" }, async (_url, options) => {
    calls.push(options);
    if (options.method === "PUT") {
      assert.equal(options.headers["If-None-Match"], "*");
      stored = options.body;
      return response(null, 201, { ETag: '"version-one"' });
    }
    return stored ? response(stored, 200, { ETag: '"version-one"' }) : response(null, 404);
  });
  const result = await transport.write(channel.channelId, "", text);

  assert.equal(result.written, true);
  assert.equal(result.currentRevisionId, packet.revisionId);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "PUT", "GET"]);
});

test("existing remote write uses a strong ETag and surfaces precondition races", async () => {
  const base = await packetFixture();
  const next = await packetFixture(base.packet.revisionId);
  next.packet.channelId = base.channel.channelId;
  next.channel.channelId = base.channel.channelId;
  const nextText = serializeSyncPacket(next.packet);
  let reads = 0;
  const transport = createHttpSyncTransport({ objectUrl: "https://sync.example/evolve.json" }, async (_url, options) => {
    if (options.method === "GET") {
      reads += 1;
      return reads === 1
        ? response(base.text, 200, { ETag: '"base-etag"' })
        : response(nextText, 200, { ETag: '"racing-etag"' });
    }
    assert.equal(options.headers["If-Match"], '"base-etag"');
    return response(null, 412);
  });
  const result = await transport.write(base.channel.channelId, base.packet.revisionId, nextText);

  assert.equal(result.written, false);
  assert.equal(result.conflict, true);
  assert.equal(result.currentRevisionId, next.packet.revisionId);
});

test("remote head mismatch returns a conflict before any PUT request", async () => {
  const remote = await packetFixture();
  const local = await packetFixture("revision_expected_parent");
  local.packet.channelId = remote.channel.channelId;
  let putCount = 0;
  const transport = createHttpSyncTransport({ objectUrl: "https://sync.example/evolve.json" }, async (_url, options) => {
    if (options.method === "PUT") putCount += 1;
    return response(remote.text, 200, { ETag: '"remote-etag"' });
  });
  const result = await transport.write(remote.channel.channelId, "revision_expected_parent", serializeSyncPacket(local.packet));

  assert.equal(result.written, false);
  assert.equal(result.currentRevisionId, remote.packet.revisionId);
  assert.equal(putCount, 0);
});

test("remote write refuses unsafe overwrite when the server omits a strong ETag", async () => {
  const base = await packetFixture();
  const next = await packetFixture(base.packet.revisionId);
  next.packet.channelId = base.channel.channelId;
  const transport = createHttpSyncTransport({ objectUrl: "https://sync.example/evolve.json" }, async () => response(base.text));

  await assert.rejects(transport.write(base.channel.channelId, base.packet.revisionId, serializeSyncPacket(next.packet)), /强 ETag/);
});
