import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

/** Finds the JDK 17 unpacked under %LOCALAPPDATA%\Java when JAVA_HOME is not set. */
const findJdk = () => {
  const javaDir = path.join(localAppData, 'Java');
  if (!fs.existsSync(javaDir)) return '';
  const jdk = fs.readdirSync(javaDir).filter((name) => name.startsWith('jdk-17')).sort().pop();
  return jdk ? path.join(javaDir, jdk) : '';
};

export const androidConfig = {
  /* Android SDK with platform-tools, emulator and the system image. */
  sdkRoot: process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(localAppData, 'Android', 'Sdk'),
  javaHome: process.env.JAVA_HOME || findJdk(),

  /* Virtual phone that is booted when no device is connected. */
  avdName: process.env.ANDROID_AVD || 'cinescape-pixel',
  systemImage: 'system-images;android-34;google_apis_playstore;x86_64',
  /* Set ANDROID_HEADLESS=1 to run the emulator without its window (for example on CI). */
  headless: process.env.ANDROID_HEADLESS === '1',
  /* Set ANDROID_KEEP_EMULATOR=1 to leave the emulator running after the tests for faster reruns. */
  keepEmulator: process.env.ANDROID_KEEP_EMULATOR === '1',

  /* The .apk to install before each test. Leave empty to test the copy already installed on the device. */
  apkPath: process.env.ANDROID_APK_PATH ?? '',
  appPackage: process.env.ANDROID_APP_PACKAGE || 'com.cinescape',
  appActivity: process.env.ANDROID_APP_ACTIVITY || 'com.cinescape.ui.main.views.splash.SplashActivity',

  appiumPort: Number(process.env.APPIUM_PORT || 4723),
  /* Android records at most 180 s per clip; longer videos are stitched together with ffmpeg. */
  videoSeconds: Number(process.env.ANDROID_VIDEO_SECONDS || 1800),
  /* Folder holding ffmpeg.exe, added to PATH for the tests and Appium. */
  ffmpegDir: process.env.FFMPEG_DIR || path.join(localAppData, 'ffmpeg', 'bin'),
};

export type AndroidConfig = typeof androidConfig;

/** Tool paths inside the SDK, plus an environment that Appium and the SDK tools can run with. */
export const androidTools = {
  adb: path.join(androidConfig.sdkRoot, 'platform-tools', 'adb.exe'),
  emulator: path.join(androidConfig.sdkRoot, 'emulator', 'emulator.exe'),
  env: (): NodeJS.ProcessEnv => ({
    ...process.env,
    ANDROID_HOME: androidConfig.sdkRoot,
    ANDROID_SDK_ROOT: androidConfig.sdkRoot,
    JAVA_HOME: androidConfig.javaHome,
    PATH: [
      path.join(androidConfig.sdkRoot, 'platform-tools'),
      path.join(androidConfig.sdkRoot, 'emulator'),
      androidConfig.javaHome ? path.join(androidConfig.javaHome, 'bin') : '',
      androidConfig.ffmpegDir,
      process.env.PATH ?? '',
    ].filter(Boolean).join(path.delimiter),
  }),
};
