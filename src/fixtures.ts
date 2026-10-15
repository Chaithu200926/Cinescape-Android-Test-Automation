import { execFileSync } from 'node:child_process';
import { test as base } from '@playwright/test';
import type { remote } from 'webdriverio' with { 'resolution-mode': 'import' };
import { androidConfig, androidTools, AndroidConfig, apiReachable } from './android-config';

type AndroidApp = Awaited<ReturnType<typeof remote>>;

type AndroidFixtures = {
  androidConfig: AndroidConfig;
  /** Appium session driving the Cinescape app, recorded to video as ANDROID_VIDEO says (by default kept for failures). */
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
 * The emulator's DNS sometimes stops resolving the API (seen 7 Oct 2026: "Unable to resolve host
 * apidev.cinescape.com.kw" while the PC resolved it), which shows up as "Something Went Wrong" in the app.
 * Turning the emulator's Wi-Fi off and on again restores it.
 */
const ensureApiReachable = () => {
  if (apiReachable()) return;
  try {
    for (const state of ['disable', 'enable']) {
      execFileSync(androidTools.adb, ['shell', 'svc', 'wifi', state], { env: androidTools.env(), stdio: 'ignore', timeout: 20_000 });
      execFileSync(androidTools.adb, ['shell', 'sleep', '5'], { env: androidTools.env(), stdio: 'ignore', timeout: 20_000 });
    }
  } catch { /* e.g. more than one device connected; the warning below still reports the problem */ }
  if (!apiReachable()) {
    const { label, apiHost, apiPort } = androidConfig.site;
    console.warn(`[android] The emulator still cannot reach the ${label} API (${apiHost}:${apiPort}); app requests may fail.`);
  }
};

const adbShell = (...args: string[]) =>
  execFileSync(androidTools.adb, ['shell', ...args], { env: androidTools.env(), encoding: 'utf8', timeout: 60_000 });

/**
 * Gives each test a freshly installed app without reinstalling it: the run installs the build once (global setup),
 * and each test clears the app's data and grants its permissions again, as a new install would have them.
 * Falls back to installing when the app is missing (e.g. a test uninstalled it).
 */
const resetApp = (config: AndroidConfig) => {
  if (!isInstalled(config.appPackage)) {
    execFileSync(androidTools.adb, ['install', '-g', config.apkPath], { env: androidTools.env(), stdio: 'ignore', timeout: 180_000 });
    return;
  }
  adbShell('am', 'force-stop', config.appPackage);
  adbShell('pm', 'clear', config.appPackage);
  const runtime = adbShell('dumpsys', 'package', config.appPackage);
  for (const [, permission] of runtime.matchAll(/^\s+([\w.]+\.permission\.[\w.]+): granted=false/gm)) {
    try { adbShell('pm', 'grant', config.appPackage, permission); } catch { /* not a runtime permission */ }
  }
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
    if (config.apkPath) {
      try { resetApp(config); } catch (error) {
        // e.g. a second emulator is connected (AND-49); fall back to a full reinstall by Appium for this test.
        testInfo.annotations.push({ type: 'reset', description: `App data could not be cleared (${String(error).slice(0, 120)}); reinstalled instead.` });
      }
    }
    const reinstall = config.apkPath && testInfo.annotations.some((note) => note.type === 'reset');

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
        /* The run installs the build once and each test starts from cleared app data (resetApp), so no reinstall here. */
        ...(reinstall
          ? { 'appium:app': config.apkPath, 'appium:fullReset': true }
          : { 'appium:noReset': true }),
        'appium:appPackage': config.appPackage,
        'appium:appActivity': config.appActivity,
        'appium:appWaitActivity': '*',
        'appium:autoGrantPermissions': true,
        // AND-49 leaves this session idle while a second emulator boots and signs up (over 5 minutes).
        'appium:newCommandTimeout': 900,
        'appium:adbExecTimeout': 60_000,
        'appium:uiautomator2ServerInstallTimeout': 120_000,
      },
    });

    /* Clips longer than 180 s have to be stitched together, which needs ffmpeg. */
    const videoSeconds = hasFfmpeg() ? config.videoSeconds : Math.min(config.videoSeconds, 180);
    if (config.video !== 'off' && videoSeconds < config.videoSeconds) {
      testInfo.annotations.push({ type: 'video', description: 'Only the first 180 s are recorded; install ffmpeg to record longer flows.' });
    }
    // A smaller, lower-bitrate recording keeps the emulator's load down over long runs.
    if (config.video !== 'off') {
      await app.startRecordingScreen({ timeLimit: String(videoSeconds), bitRate: '1500000', videoSize: '540x1200', forceRestart: true });
    }

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

      if (config.video !== 'off') {
        const video = await app.stopRecordingScreen().catch(() => '');
        const failed = testInfo.status !== testInfo.expectedStatus;
        if (video && (config.video === 'on' || failed)) {
          await testInfo.attach('video', { body: Buffer.from(video, 'base64'), contentType: 'video/mp4' });
        }
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
