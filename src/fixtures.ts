import { execFileSync } from 'node:child_process';
import { test as base } from '@playwright/test';
import type { remote } from 'webdriverio' with { 'resolution-mode': 'import' };
import { androidConfig, androidTools, AndroidConfig } from './android-config';

type AndroidApp = Awaited<ReturnType<typeof remote>>;

type AndroidFixtures = {
  androidConfig: AndroidConfig;
  /** Appium session driving the Cinescape app. The whole test is recorded to video. */
  app: AndroidApp;
  /** Adds a named step to the report with a screenshot of the phone screen. */
  snap: (label: string) => Promise<void>;
};

const isInstalled = (appPackage: string) => {
  try {
    const packages = execFileSync(androidTools.adb, ['shell', 'pm', 'list', 'packages', appPackage], {
      env: androidTools.env(),
      encoding: 'utf8',
    });
    return packages.split(/\r?\n/).some((line) => line.trim() === `package:${appPackage}`);
  } catch {
    return false;
  }
};

/**
 * The emulator's DNS sometimes stops resolving the UAT API (seen 7 Oct 2026: "Unable to resolve host
 * apidev.cinescape.com.kw" while the PC resolved it), which shows up as "Something Went Wrong" in the app.
 * Turning the emulator's Wi-Fi off and on again restores it.
 */
const ensureApiReachable = () => {
  const resolves = () => {
    try {
      execFileSync(androidTools.adb, ['shell', 'ping', '-c', '1', '-W', '5', 'apidev.cinescape.com.kw'], {
        env: androidTools.env(),
        stdio: 'ignore',
        timeout: 20_000,
      });
      return true;
    } catch {
      return false;
    }
  };
  if (resolves()) return;
  try {
    for (const state of ['disable', 'enable']) {
      execFileSync(androidTools.adb, ['shell', 'svc', 'wifi', state], { env: androidTools.env(), stdio: 'ignore', timeout: 20_000 });
      execFileSync(androidTools.adb, ['shell', 'sleep', '5'], { env: androidTools.env(), stdio: 'ignore', timeout: 20_000 });
    }
  } catch { /* e.g. more than one device connected; the warning below still reports the problem */ }
  if (!resolves()) console.warn('[android] The emulator still cannot resolve apidev.cinescape.com.kw; app requests may fail.');
};

const hasFfmpeg = () => {
  try {
    execFileSync('ffmpeg', ['-version'], { env: androidTools.env(), stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const test = base.extend<AndroidFixtures>({
  androidConfig: async ({}, use) => {
    await use(androidConfig);
  },

  app: async ({ androidConfig: config }, use, testInfo) => {
    test.skip(
      !config.apkPath && !isInstalled(config.appPackage),
      `Set ANDROID_APK_PATH in .env to the .apk file, or install ${config.appPackage} on the device first.`,
    );

    ensureApiReachable();

    /* webdriverio is only published as an ES module, so it is loaded with import() from this CommonJS project. */
    const { remote } = await import('webdriverio');
    const app = await remote({
      hostname: '127.0.0.1',
      port: config.appiumPort,
      logLevel: 'warn',
      connectionRetryTimeout: 240_000,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        /* Install the given .apk fresh for every test, or open the copy that is already installed. */
        ...(config.apkPath
          ? { 'appium:app': config.apkPath, 'appium:fullReset': true }
          : { 'appium:noReset': true }),
        'appium:appPackage': config.appPackage,
        'appium:appActivity': config.appActivity,
        'appium:appWaitActivity': '*',
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 300,
        'appium:adbExecTimeout': 60_000,
        'appium:uiautomator2ServerInstallTimeout': 120_000,
      },
    });

    /* Clips longer than 180 s have to be stitched together, which needs ffmpeg. */
    const videoSeconds = hasFfmpeg() ? config.videoSeconds : Math.min(config.videoSeconds, 180);
    if (videoSeconds < config.videoSeconds) {
      testInfo.annotations.push({ type: 'video', description: 'Only the first 180 s are recorded; install ffmpeg to record longer flows.' });
    }
    await app.startRecordingScreen({ timeLimit: String(videoSeconds), bitRate: '4000000', forceRestart: true });

    try {
      await use(app);
    } finally {
      await testInfo.attach('final screen', {
        body: Buffer.from(await app.takeScreenshot(), 'base64'),
        contentType: 'image/png',
      }).catch(() => undefined);

      /* The screen layout (XML) makes it easier to fix a locator when a test fails. */
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('screen layout', { body: await app.getPageSource(), contentType: 'application/xml' })
          .catch(() => undefined);
      }

      const video = await app.stopRecordingScreen().catch(() => '');
      if (video) {
        await testInfo.attach('video', { body: Buffer.from(video, 'base64'), contentType: 'video/mp4' });
      }

      await app.deleteSession();
    }
  },

  snap: async ({ app }, use, testInfo) => {
    await use(async (label) => {
      await test.step(label, async () => {
        await testInfo.attach(label, {
          body: Buffer.from(await app.takeScreenshot(), 'base64'),
          contentType: 'image/png',
        });
      });
    });
  },
});

export { expect } from '@playwright/test';
