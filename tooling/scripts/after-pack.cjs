const { execFileSync } = require('node:child_process');
const path = require('node:path');

const UNUSED_DEVICE_USAGE_KEYS = [
  'NSAudioCaptureUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
  'NSBluetoothPeripheralUsageDescription',
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const infoPlist = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist');
  for (const key of UNUSED_DEVICE_USAGE_KEYS) {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, infoPlist], { stdio: 'ignore' });
    } catch (error) {
      if (error.status !== 1) throw error;
    }
  }
};
