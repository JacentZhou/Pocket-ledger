import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {
  CLOUD_DIRECTORY, snapshotName, cloudSnapshotNames, snapshotDate, selectNewestSnapshot,
} from './cloudBackupCore';

const INSTALLATION_KEY = 'pocket-ledger-icloud-installation';
const SEQUENCE_KEY = 'pocket-ledger-icloud-sequence';
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

function getCloud() {
  if (Platform.OS !== 'ios') throw new Error('Automatic iCloud backup is available only on iOS and iPadOS.');
  try {
    // Loaded only on iOS: Expo Go has no custom native iCloud module.
    return require('@oleg_svetlichnyi/expo-icloud-storage');
  } catch (_) {
    throw new Error('Automatic iCloud backup needs a new iOS development/production build. It does not work in Expo Go.');
  }
}
async function availableCloud() {
  const cloud = getCloud();
  const available = await cloud.isICloudAvailableAsync();
  if (!available || !cloud.defaultICloudContainerPath) {
    throw new Error('iCloud Drive is unavailable. Sign in to iCloud, enable iCloud Drive and check the app’s iCloud entitlement. Your data remains on this device.');
  }
  return cloud;
}
async function getInstallationId() {
  const old = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (old && /^[a-zA-Z0-9-]{6,80}$/.test(old)) return old;
  const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 13);
  await AsyncStorage.setItem(INSTALLATION_KEY, id);
  return id;
}

export async function uploadAutomaticBackup(serializedBackup) {
  if (typeof serializedBackup !== 'string' || serializedBackup.length > MAX_BACKUP_BYTES) {
    throw new Error('The automatic backup exceeds the 10 MB safety limit.');
  }
  const cloud = await availableCloud();
  const deviceId = await getInstallationId();
  const sequence = Math.max(0, Number(await AsyncStorage.getItem(SEQUENCE_KEY)) || 0);
  const remotePath = CLOUD_DIRECTORY + '/' + snapshotName(deviceId, sequence);
  const localPath = FileSystem.cacheDirectory + 'pocket-ledger-auto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json';
  await FileSystem.writeAsStringAsync(localPath, serializedBackup);
  try {
    await cloud.createDirAsync(CLOUD_DIRECTORY);
    await cloud.uploadFileAsync({ destinationPath: remotePath, filePath: localPath });
    await AsyncStorage.setItem(SEQUENCE_KEY, String(sequence + 1));
    return new Date().toISOString();
  } finally {
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => {});
  }
}

export async function recoverAutomaticBackup(validateBackup) {
  const cloud = await availableCloud();
  const exists = await cloud.isExistAsync(CLOUD_DIRECTORY, true);
  if (!exists) return null;
  const names = cloudSnapshotNames(await cloud.readDirAsync(CLOUD_DIRECTORY, { isFullPath: false }));
  if (!names.length) return null;
  const destination = FileSystem.cacheDirectory + 'pocket-ledger-cloud-recovery-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '/';
  await FileSystem.makeDirectoryAsync(destination, { intermediates: true });
  let latest = null;
  let errors = 0;
  try {
    for (const name of names) {
      try {
        const source = cloud.defaultICloudContainerPath + '/Documents/' + CLOUD_DIRECTORY + '/' + name;
        const downloadedPath = await cloud.downloadFileAsync(source, destination);
        const localPath = downloadedPath.startsWith('file://') ? downloadedPath : 'file://' + downloadedPath;
        const raw = await FileSystem.readAsStringAsync(localPath);
        if (raw.length > MAX_BACKUP_BYTES) throw new Error('Backup too large.');
        const timestamp = snapshotDate(raw);
        if (timestamp === null) throw new Error('Backup has no valid timestamp.');
        const data = validateBackup(raw);
        latest = selectNewestSnapshot([latest, { data, timestamp }].filter(Boolean));
      } catch (_) { errors += 1; }
    }
  } finally {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => {});
  }
  if (!latest && errors) throw new Error('iCloud snapshots were found, but none could be read or validated. Local records have not been changed.');
  return latest?.data || null;
}
