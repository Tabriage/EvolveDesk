import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_KDF_ITERATIONS,
  decryptBackupEnvelope,
  encryptBackupText,
  inspectEncryptedBackupText,
  serializeEncryptedBackupEnvelope,
  validateBackupPassphrase,
} from "../app/features/backup-crypto.mjs";
import {
  createBackupEnvelope,
  parseBackupText,
  serializeBackupEnvelope,
} from "../app/features/backup-core.mjs";
import { addTask, createInitialWorkbench } from "../app/features/workbench-core.mjs";

const passphrase = "four-calm-river-stones";

async function plainBackup() {
  const workspace = addTask(createInitialWorkbench(), { title: "只应出现在解锁后的任务", source: "manual" });
  return serializeBackupEnvelope(await createBackupEnvelope(workspace, { transcripts: [], visualFrames: [] }, "2026-08-14T12:00:00.000Z"));
}

test("encrypted backup hides plaintext and round-trips through authenticated Web Crypto", async () => {
  const plaintext = await plainBackup();
  const encrypted = await encryptBackupText(plaintext, passphrase);
  const serialized = serializeEncryptedBackupEnvelope(encrypted);
  const inspected = inspectEncryptedBackupText(serialized);

  assert.equal(inspected.kdf.iterations, BACKUP_KDF_ITERATIONS);
  assert.equal(inspected.cipher.name, "AES-GCM");
  assert.equal(serialized.includes("只应出现在解锁后的任务"), false);
  assert.equal(serialized.includes(passphrase), false);

  const decrypted = await decryptBackupEnvelope(inspected, passphrase);
  const restored = await parseBackupText(decrypted);
  assert.equal(restored.workspace.tasks[0].title, "只应出现在解锁后的任务");
});

test("each encrypted backup receives a fresh salt and IV", async () => {
  const plaintext = await plainBackup();
  const first = await encryptBackupText(plaintext, passphrase);
  const second = await encryptBackupText(plaintext, passphrase);

  assert.notEqual(first.kdf.salt, second.kdf.salt);
  assert.notEqual(first.cipher.iv, second.cipher.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("encrypted backup rejects a wrong passphrase and authenticated-header tampering", async () => {
  const encrypted = await encryptBackupText(await plainBackup(), passphrase);
  await assert.rejects(decryptBackupEnvelope(encrypted, "wrong-but-long-passphrase"), /口令不正确|已被修改/);

  const retimed = structuredClone(encrypted);
  retimed.createdAt = "2026-08-15T12:00:00.000Z";
  await assert.rejects(decryptBackupEnvelope(retimed, passphrase), /口令不正确|已被修改/);

  const modified = structuredClone(encrypted);
  modified.ciphertext = `${modified.ciphertext[0] === "A" ? "B" : "A"}${modified.ciphertext.slice(1)}`;
  await assert.rejects(decryptBackupEnvelope(modified, passphrase), /口令不正确|已被修改/);
});

test("encrypted backup validates passphrase and fixed v1 algorithm bounds", async () => {
  assert.throws(() => validateBackupPassphrase("too-short"), /至少需要 12/);
  assert.throws(() => validateBackupPassphrase("            "), /不能全部是空白/);
  assert.equal(validateBackupPassphrase(passphrase), passphrase);
  assert.equal(inspectEncryptedBackupText(await plainBackup()), null);

  const encrypted = await encryptBackupText(await plainBackup(), passphrase);
  const excessiveWork = structuredClone(encrypted);
  excessiveWork.kdf.iterations = 9_999_999;
  assert.throws(() => inspectEncryptedBackupText(JSON.stringify(excessiveWork)), /不受支持的口令派生参数/);
});
