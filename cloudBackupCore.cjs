// Pure helpers for automatic (non-live-sync) iCloud snapshot backups.
const CLOUD_DIRECTORY = 'PocketLedgerAutomaticBackups';
const SNAPSHOT_SLOTS = 3;
const MAX_REMOTE_SNAPSHOTS_TO_SCAN = 120;
const SNAPSHOT_NAME = /^backup-([a-zA-Z0-9-]{6,80})-slot([0-2])\.json$/;

function snapshotName(installationId, sequence) {
  if (typeof installationId !== 'string' || !/^[a-zA-Z0-9-]{6,80}$/.test(installationId)) throw new Error('Invalid installation ID.');
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid backup sequence.');
  return 'backup-' + installationId + '-slot' + (sequence % SNAPSHOT_SLOTS) + '.json';
}
function cloudSnapshotNames(entries) {
  if (!Array.isArray(entries)) return [];
  return [...new Set(entries.map(e => String(e).split('/').pop().replace(/\.json\.icloud$/, '.json'))
    .filter(n => SNAPSHOT_NAME.test(n)))].slice(0, MAX_REMOTE_SNAPSHOTS_TO_SCAN);
}
function snapshotDate(raw) {
  try {
    const obj = JSON.parse(raw);
    const time = obj && typeof obj.exportedAt === 'string' ? Date.parse(obj.exportedAt) : NaN;
    return Number.isFinite(time) ? time : null;
  } catch (_) { return null; }
}
function selectNewestSnapshot(candidates) {
  return candidates.reduce((best, next) => !best || next.timestamp > best.timestamp ? next : best, null);
}
module.exports = { CLOUD_DIRECTORY, SNAPSHOT_SLOTS, snapshotName, cloudSnapshotNames, snapshotDate, selectNewestSnapshot };
