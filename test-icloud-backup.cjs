const assert = require('node:assert/strict');
const {
  CLOUD_DIRECTORY, SNAPSHOT_SLOTS, snapshotName, cloudSnapshotNames,
  snapshotDate, selectNewestSnapshot,
} = require('./cloudBackupCore.cjs');
assert.equal(CLOUD_DIRECTORY, 'PocketLedgerAutomaticBackups');
assert.equal(SNAPSHOT_SLOTS, 3);
assert.equal(snapshotName('device-123', 0), 'backup-device-123-slot0.json');
assert.equal(snapshotName('device-123', 4), 'backup-device-123-slot1.json');
assert.throws(() => snapshotName('../oops', 0));
assert.throws(() => snapshotName('device-123', -1));
assert.deepEqual(cloudSnapshotNames([
  'backup-device-123-slot1.json',
  'backup-device-123-slot1.json.icloud',
  'backup-device-123-slot2.json',
  'other.json',
  'backup-device-123-slot99.json',
]), ['backup-device-123-slot1.json', 'backup-device-123-slot2.json']);
assert.equal(snapshotDate('{"exportedAt":"2026-11-04T00:00:00.000Z"}'), Date.parse('2026-11-04T00:00:00.000Z'));
assert.equal(snapshotDate('not json'), null);
assert.equal(snapshotDate('{"exportedAt":"not a date"}'), null);
assert.equal(selectNewestSnapshot([{timestamp:2,data:'b'}, {timestamp:3,data:'c'}, {timestamp:1,data:'a'}]).data, 'c');
console.log('Automatic iCloud backup filename/rotation/selection tests passed.');
