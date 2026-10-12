import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { androidConfig, androidTools } from './android-config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const adb = (...args: string[]) =>
  execFileSync(androidTools.adb, args, { env: androidTools.env(), encoding: 'utf8', timeout: 30_000 }).trim();

/** Serial numbers of phones or emulators that are connected and ready. */
const connectedDevices = () =>
  adb('devices').split(/\r?\n/).slice(1)
    .map((line) => line.split('\t'))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);

/** Keep the visible Android emulator centered on the Windows desktop for every test run. */
const centerVisibleEmulator = () => {
  if (process.platform !== 'win32' || androidConfig.headless) return;
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(process.cwd(), 'scripts', 'center-emulator.ps1'),
      '-AvdName', androidConfig.avdName,
      '-Port', '5554',
    ], {
      env: process.env,
      stdio: 'ignore',
      timeout: 20_000,
    });
  } catch (error) {
    console.warn(`[android] Could not center the emulator window: ${String(error)}`);
  }
};

const appiumIsUp = async () => {
  try {
    const response = await fetch(`http://127.0.0.1:${androidConfig.appiumPort}/status`);
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Creates the virtual phone by writing its two definition files directly. (avdmanager needs files
 * that the newer Android CLI installer no longer ships.)
 */
const ensureAvdExists = () => {
  const avds = execFileSync(androidTools.emulator, ['-list-avds'], { env: androidTools.env(), encoding: 'utf8' });
  if (avds.split(/\r?\n/).includes(androidConfig.avdName)) return;

  const imageDir = path.join(...androidConfig.systemImage.split(';'));
  if (!fs.existsSync(path.join(androidConfig.sdkRoot, imageDir, 'system.img'))) {
    throw new Error(`The system image ${androidConfig.systemImage} is not installed in ${androidConfig.sdkRoot}.`);
  }

  console.log(`[android] Creating virtual phone "${androidConfig.avdName}"...`);
  const avdHome = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), '.android', 'avd');
  const avdDir = path.join(avdHome, `${androidConfig.avdName}.avd`);
  fs.mkdirSync(avdDir, { recursive: true });

  const [, platform, tag, abi] = androidConfig.systemImage.split(';');
  const settings: Record<string, string> = {
    AvdId: androidConfig.avdName,
    'avd.ini.displayname': androidConfig.avdName,
    'image.sysdir.1': `${imageDir}${path.sep}`,
    'abi.type': abi,
    'hw.cpu.arch': abi,
    'tag.id': tag,
    'PlayStore.enabled': String(tag.includes('playstore')),
    /* Pixel 6 screen. */
    'hw.device.name': 'pixel_6',
    'hw.device.manufacturer': 'Google',
    'hw.lcd.width': '1080',
    'hw.lcd.height': '2400',
    'hw.lcd.density': '420',
    'hw.ramSize': '4096',
    'hw.cpu.ncore': '4',
    'disk.dataPartition.size': '6G',
    'hw.keyboard': 'yes',
    'hw.gpu.enabled': 'yes',
    'hw.gpu.mode': 'auto',
  };
  fs.writeFileSync(path.join(avdDir, 'config.ini'),
    Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
  fs.writeFileSync(path.join(avdHome, `${androidConfig.avdName}.ini`), [
    'avd.ini.encoding=UTF-8',
    `path=${avdDir}`,
    `path.rel=avd${path.sep}${androidConfig.avdName}.avd`,
    `target=${platform}`,
  ].join('\n') + '\n');
};

/** The emulator needs hardware acceleration; on a PC with Hyper-V that means Windows Hypervisor Platform. */
const ensureAcceleration = () => {
  try {
    execFileSync(androidTools.emulator, ['-accel-check'], { env: androidTools.env(), encoding: 'utf8' });
  } catch (error) {
    const output = String((error as { stdout?: string }).stdout ?? '').trim();
    throw new Error([
      'No Android device is connected and the emulator cannot start on this PC:',
      output,
      'Fix one of these, then run again:',
      ' - Enable the Windows feature "Windows Hypervisor Platform" (needs admin and a restart; Hyper-V stays on), or',
      ' - Connect an Android phone over USB with USB debugging turned on.',
    ].join('\n'));
  }
};

const bootEmulator = async (): Promise<ChildProcess> => {
  ensureAvdExists();
  ensureAcceleration();
  console.log(`[android] Starting emulator "${androidConfig.avdName}"...`);
  // Read-only mode lets AND-49 boot a second instance from the same AVD for a concurrent seat-hold check.
  const args = ['-avd', androidConfig.avdName, '-no-boot-anim', '-no-snapshot-save', '-gpu', 'auto', '-read-only'];
  if (androidConfig.headless) args.push('-no-window');
  const emulator = spawn(androidTools.emulator, args, { env: androidTools.env(), stdio: 'ignore', detached: true });
  emulator.unref();

  /* Wait until Android reports that it has finished booting. */
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (emulator.exitCode !== null) throw new Error(`The emulator exited early with code ${emulator.exitCode}.`);
    try {
      if (connectedDevices().length && adb('shell', 'getprop', 'sys.boot_completed') === '1') {
        /* Animations slow tests down and blur screenshots, so switch them off. */
        for (const setting of ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']) {
          adb('shell', 'settings', 'put', 'global', setting, '0');
        }
        console.log('[android] Emulator is ready.');
        return emulator;
      }
    } catch {
      /* adb is not ready yet; keep waiting. */
    }
    await sleep(3_000);
  }
  throw new Error('The emulator did not finish booting within 5 minutes.');
};

const startAppium = async (): Promise<ChildProcess> => {
  console.log(`[android] Starting Appium on port ${androidConfig.appiumPort}...`);
  const appiumMain = path.join(path.dirname(require.resolve('appium/package.json')), 'index.js');
  const logDir = path.resolve(androidConfig.site.resultsFolder);
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'appium.log'), 'w');
  const appium = spawn(process.execPath, [appiumMain, '--port', String(androidConfig.appiumPort), '--log-no-colors'], {
    env: androidTools.env(),
    stdio: ['ignore', log, log],
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (appium.exitCode !== null) throw new Error(`Appium stopped during start-up. See ${androidConfig.site.resultsFolder}/appium.log.`);
    if (await appiumIsUp()) return appium;
    await sleep(1_000);
  }
  throw new Error(`Appium did not start within 60 seconds. See ${androidConfig.site.resultsFolder}/appium.log.`);
};

/**
 * Makes sure a device and Appium are available before the Android tests run.
 * Anything started here is stopped again in the returned teardown.
 */
export default async function globalSetup() {
  if (!fs.existsSync(androidTools.adb)) {
    throw new Error(`adb was not found at ${androidTools.adb}. Set ANDROID_HOME to your Android SDK folder.`);
  }
  if (androidConfig.apkPath && !fs.existsSync(androidConfig.apkPath)) {
    throw new Error(`${androidConfig.site.apkEnv} points to a missing file: ${androidConfig.apkPath}`);
  }

  const { label, apiHost, apiPort } = androidConfig.site;
  console.log(`[android] Testing the ${label} build (${apiHost}:${apiPort}): ${androidConfig.apkPath || 'the copy already installed'}`);

  /* Appium's child processes need these too. */
  Object.assign(process.env, androidTools.env());

  const startedEmulator = connectedDevices().length ? undefined : await bootEmulator();
  centerVisibleEmulator();
  const startedAppium = (await appiumIsUp()) ? undefined : await startAppium();

  return async () => {
    startedAppium?.kill();
    if (startedEmulator && !androidConfig.keepEmulator) {
      console.log('[android] Shutting down the emulator.');
      try { adb('emu', 'kill'); } catch { /* already closed */ }
    }
  };
}
