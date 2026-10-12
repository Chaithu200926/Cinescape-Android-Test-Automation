import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import { currentSite, siteApkPath } from './android-site';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
/* Reuse the web project's test credentials when available; Android-specific and process env values win. */
dotenv.config({ path: path.resolve(process.cwd(), '..', 'Test1', '.env') });
/* The kiosk UAT project shares its test customer's wallet identifiers and wallet OTP with the mobile app. */
dotenv.config({ path: path.resolve(process.cwd(), '..', 'CinescapeKiosk-UI-Automation', '.env') });

const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
const newUserStamp = Date.now().toString();
const site = currentSite();

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

  /* Which build is under test (AWS UAT, Internal UAT or Internal Pre-UAT); see src/android-site.ts. */
  site,
  /* The .apk to install before each test. Empty means test the copy already installed on the device. */
  apkPath: siteApkPath(site),
  appPackage: process.env.ANDROID_APP_PACKAGE || 'com.cinescape',
  appActivity: process.env.ANDROID_APP_ACTIVITY || 'com.cinescape.ui.main.views.splash.SplashActivity',

  appiumPort: Number(process.env.APPIUM_PORT || 4723),
  /* Android records at most 180 s per clip; longer videos are stitched together with ffmpeg. */
  videoSeconds: Number(process.env.ANDROID_VIDEO_SECONDS || 1800),
  /* Folder holding ffmpeg.exe, added to PATH for the tests and Appium. */
  ffmpegDir: process.env.FFMPEG_DIR || path.join(localAppData, 'ffmpeg', 'bin'),

  credentials: {
    username: process.env.ANDROID_TEST_USERNAME || process.env.TEST_USERNAME || '',
    password: process.env.ANDROID_TEST_PASSWORD || process.env.TEST_PASSWORD || '',
    pin: process.env.ANDROID_TEST_PIN || process.env.TEST_PIN || '',
  },
  secondAccount: {
    username: process.env.ANDROID_TEST2_USERNAME || process.env.TEST2_USERNAME || '',
    password: process.env.ANDROID_TEST2_PASSWORD || process.env.TEST2_PASSWORD || '',
    pin: process.env.ANDROID_TEST2_PIN || process.env.TEST2_PIN || '',
  },
  newUser: {
    email: process.env.ANDROID_TEST_NEW_USER_EMAIL || `kncc.autotest.${newUserStamp}@example.com`,
    firstName: process.env.ANDROID_TEST_NEW_USER_FIRST_NAME || 'Auto',
    lastName: process.env.ANDROID_TEST_NEW_USER_LAST_NAME || 'Tester',
    password: process.env.ANDROID_TEST_NEW_USER_PASSWORD || process.env.TEST_NEW_USER_PASSWORD || 'Auto@Kncc2026',
    mobile: process.env.ANDROID_TEST_NEW_USER_MOBILE || `5${newUserStamp.slice(-7)}`,
    // The current APK's Android DOB picker has a lower supported year bound of 2007.
    dateOfBirth: process.env.ANDROID_TEST_NEW_USER_DATE_OF_BIRTH || '2007-04-05',
    gender: process.env.ANDROID_TEST_NEW_USER_GENDER || 'male',
  },
  newUserOtp: process.env.ANDROID_TEST_NEW_USER_OTP || process.env.TEST_NEW_USER_OTP || '111111',
  payment: {
    // No test credit card works on UAT yet (the Web suite's TEST_CARD_* is refused), so only an Android card is used.
    cardNumber: process.env.ANDROID_TEST_CARD_NUMBER || '',
    cardExpiry: process.env.ANDROID_TEST_CARD_EXPIRY || '',
    cardCvv: process.env.ANDROID_TEST_CARD_CVV || '',
    knetNumber: process.env.ANDROID_TEST_KNET_NUMBER || process.env.TEST_KNET_NUMBER || '',
    knetExpiry: process.env.ANDROID_TEST_KNET_EXPIRY || process.env.TEST_KNET_EXPIRY || '',
    knetPin: process.env.ANDROID_TEST_KNET_PIN || process.env.TEST_KNET_PIN || '',
    giftCard: process.env.ANDROID_TEST_GIFT_CARD || process.env.TEST_GIFT_CARD || '',
    walletCode: process.env.ANDROID_TEST_WALLET_CODE || process.env.KIOSK_WALLET_CODE || '',
  },
  /* These belong to the configured kiosk test customer and are only used where an app wallet flow asks for them. */
  kioskCustomer: {
    username: process.env.KIOSK_TEST_USERNAME || '',
    password: process.env.KIOSK_TEST_PASSWORD || '',
    otp: process.env.KIOSK_TEST_OTP || '',
    clubCard: process.env.KIOSK_TEST_CLUB_CARD || '',
    mobile: process.env.KIOSK_TEST_MOBILE || '',
  },
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

/** Whether the emulator can reach the API host of the build under test (pings get through to both AWS and 10.35.1.66). */
export const apiReachable = (waitSeconds = 5) => {
  try {
    execFileSync(androidTools.adb, ['shell', 'ping', '-c', '1', '-W', String(waitSeconds), androidConfig.site.apiHost], {
      env: androidTools.env(),
      stdio: 'ignore',
      timeout: (waitSeconds + 15) * 1000,
    });
    return true;
  } catch {
    return false;
  }
};
