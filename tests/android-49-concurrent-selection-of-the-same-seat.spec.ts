import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { test, expect } from '../src/fixtures';
import { androidTools } from '../src/android-config';
import {
  AndroidApp,
  bookingHistory,
  cleanUpBooking,
  openArea,
  openFirstMovieDetails,
  readWalletBalance,
  registerFreshTestAccount,
  retryAfterAppError,
  selectFutureDateWithShowtimes,
  signInAsUser,
  tapElementCenter,
  tapNativeElementCenter,
} from '../src/android-navigation';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readKwd = (text: string, label: string) => {
  const match = /(?:KWD|KD)?\s*([\d,]+(?:\.\d{1,3})?)/i.exec(text);
  if (!match && /wallet balance\s*:?\s*$/i.test(text)) return 0;
  if (!match) throw new Error(`${label} did not contain a readable KWD amount: ${text}`);
  return Number(match[1].replace(/,/g, ''));
};

const waitForDeviceBoot = async (serial: string, timeoutMs = 180_000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const booted = execFileSync(androidTools.adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
        env: androidTools.env(), encoding: 'utf8', timeout: 10_000,
      }).trim();
      if (booted === '1') break;
    } catch { /* emulator is still starting */ }
    await sleep(2_000);
  }
  if (Date.now() >= end) throw new Error(`The second Android emulator ${serial} did not finish booting within ${timeoutMs / 1000}s.`);
  // A freshly booted emulator can report boot complete before its network is up; the app then says
  // "No internet connection" during sign-up.
  const networkEnd = Date.now() + 120_000;
  while (Date.now() < networkEnd) {
    try {
      execFileSync(androidTools.adb, ['-s', serial, 'shell', 'ping', '-c', '1', '-W', '3', '8.8.8.8'], {
        env: androidTools.env(), stdio: 'ignore', timeout: 10_000,
      });
      return;
    } catch { /* network not up yet */ }
    await sleep(3_000);
  }
  throw new Error(`The second Android emulator ${serial} booted but had no internet connection within 120s.`);
};

const openSeatMap = async (app: AndroidApp) => {
  const { title } = await openFirstMovieDetails(app);
  const { dateLabel, showtimes } = await selectFutureDateWithShowtimes(app);
  if ((await showtimes.length) === 0) throw new Error(`No showtime is available for ${dateLabel}.`);
  await tapElementCenter(app, showtimes[0]);
  // With the second emulator running the PC is slow; seat categories can take over 30 s behind the spinner.
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({
    timeout: 90_000,
    timeoutMsg: 'The selected showtime did not open seat categories',
  });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  const progress = app.$('id=com.cinescape:id/progress');
  await progress.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Selecting General did not start seat-map loading' });
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000, timeoutMsg: 'The seat map did not finish loading' });
  await app.$('id=com.cinescape:id/seat_table').waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The show has no visible seat map' });
  return { title, dateLabel, progress, seatTable: app.$('id=com.cinescape:id/seat_table') };
};

const firstAvailableSeat = async (app: AndroidApp) => {
  const cells = await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView');
  for (const cell of cells) {
    const label = (await cell.getText()).trim();
    if (/^[A-Z]?\d+[A-Z]?$/i.test(label) && await cell.isEnabled()) return { cell, label };
  }
  throw new Error('The shared show has no available seat for the first session to hold.');
};

test('AND-49 Concurrent selection of the same seat', async ({ app: appA, snap, androidConfig }) => {
  test.setTimeout(720_000);
  if (!androidConfig.apkPath) throw new Error('AND-49 requires ANDROID_APK_PATH so both emulator sessions use the same UAT APK.');

  // Session A signs in before the second emulator boots: the boot loads the PC heavily and slowed sign-in past its timeout.
  await signInAsUser(appA, androidConfig, 'kiosk');
  await openArea(appA, 'account');
  const balanceAElement = appA.$('id=com.cinescape:id/text_user_wallet_kd');
  await balanceAElement.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Session A did not show its test wallet balance' });
  const balanceABefore = readKwd(await balanceAElement.getText(), 'Session A wallet balance before booking');

  const secondSerial = 'emulator-5556';
  const emulatorAlreadyConnected = execFileSync(androidTools.adb, ['devices'], {
    env: androidTools.env(), encoding: 'utf8', timeout: 10_000,
  }).split(/\r?\n/).some((line) => line.startsWith(`${secondSerial}\tdevice`));
  const secondEmulator = emulatorAlreadyConnected ? undefined : spawn(androidTools.emulator, [
    '-avd', androidConfig.avdName,
    '-port', '5556',
    '-no-window',
    '-no-audio',
    '-no-boot-anim',
    '-read-only',
  ], { env: androidTools.env(), stdio: 'ignore', windowsHide: true });

  let appB: AndroidApp | undefined;
  let bookingIdA = '';
  try {
    if (secondEmulator) {
      const earlyExit = new Promise<never>((_resolve, reject) => {
        secondEmulator.once('error', reject);
        secondEmulator.once('exit', (code) => reject(new Error(`The second emulator exited before boot completed (code ${code}).`)));
      });
      await Promise.race([waitForDeviceBoot(secondSerial), earlyExit]);
    } else {
      await waitForDeviceBoot(secondSerial);
    }
    const { remote } = await import('webdriverio');
    appB = await remote({
      hostname: '127.0.0.1',
      port: androidConfig.appiumPort,
      logLevel: 'warn',
      connectionRetryTimeout: 240_000,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': secondSerial,
        'appium:app': androidConfig.apkPath,
        'appium:fullReset': true,
        'appium:appPackage': androidConfig.appPackage,
        'appium:appActivity': androidConfig.appActivity,
        'appium:appWaitActivity': '*',
        'appium:autoGrantPermissions': true,
        'appium:newCommandTimeout': 300,
        'appium:adbExecTimeout': 60_000,
        'appium:uiautomator2ServerInstallTimeout': 120_000,
        // Outside the range Appium picks from for session A, so the two phones never share a port.
        'appium:systemPort': 8290,
      },
    }) as AndroidApp;

    // Session B signs up before session A holds the seat: sign-up on the just-booted second phone is slow
    // and would otherwise use up the hold's countdown.
    await registerFreshTestAccount(appB, androidConfig);
    const balanceBBefore = await readWalletBalance(appB, 'Session B wallet balance before competing for the seat');

    await openArea(appA, 'movies');
    const bookingA = await retryAfterAppError(appA, 'session A opening the seat map', () => openSeatMap(appA));
    const seatA = await firstAvailableSeat(appA);
    await tapNativeElementCenter(appA, seatA.cell);
    await snap(`AND-49: session A selected ${seatA.label} for ${bookingA.title}`);
    await appA.$('id=com.cinescape:id/txt_proceed').click();
    await bookingA.progress.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Session A did not start holding the selected seat' });
    await bookingA.progress.waitForDisplayed({ reverse: true, timeout: 60_000, timeoutMsg: 'Session A did not finish opening checkout with its seat hold' });
    const checkoutA = appA.$('id=com.cinescape:id/uiCheckout');
    const paymentListA = appA.$('id=com.cinescape:id/paymentLayout');
    await appA.waitUntil(async () => (await checkoutA.isDisplayed()) || (await paymentListA.isDisplayed()), {
      timeout: 30_000,
      timeoutMsg: 'Session A did not reach checkout after holding its seat',
    });

    await openArea(appB, 'movies');
    let bookingB: Awaited<ReturnType<typeof openSeatMap>>;
    try {
      bookingB = await retryAfterAppError(appB, 'session B opening the seat map', () => openSeatMap(appB!));
    } catch (error) {
      await test.info().attach('AND-49: session B screen after movie-list failure', {
        body: Buffer.from(await appB.takeScreenshot(), 'base64'),
        contentType: 'image/png',
      }).catch(() => undefined);
      await test.info().attach('AND-49: session B UI hierarchy after movie-list failure', {
        body: await appB.getPageSource(),
        contentType: 'application/xml',
      }).catch(() => undefined);
      throw error;
    }
    expect(bookingB.title, 'Both sessions must open the same movie').toBe(bookingA.title);
    expect(bookingB.dateLabel, 'Both sessions must open the same future date').toBe(bookingA.dateLabel);
    const seatB = appB.$('id=com.cinescape:id/seat_table').$(`android=new UiSelector().text("${seatA.label}")`);
    const seatVisibleInB = await seatB.isDisplayed().catch(() => false);
    const seatEnabledInB = seatVisibleInB && await seatB.isEnabled().catch(() => false);
    if (seatEnabledInB) {
      await tapElementCenter(appB, seatB);
      const proceedB = appB.$('id=com.cinescape:id/txt_proceed');
      await proceedB.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'Session B selected the held seat but did not expose Proceed' });
      await proceedB.click();
      await appB.waitUntil(async () => {
        const source = (await appB!.getPageSource()).toLowerCase();
        return /unavailable|not available|already reserved|seat.*hold|held by another/.test(source);
      }, {
        timeout: 20_000,
        timeoutMsg: `Session B did not display a conflict after trying held seat ${seatA.label}`,
      });
    } else {
      expect(seatEnabledInB, `Seat ${seatA.label} should not be selectable while session A holds it`).toBe(false);
    }
    expect(await appB.$('id=com.cinescape:id/uiFinalTaket').isDisplayed().catch(() => false), 'Session B cannot reach booking confirmation for the held seat').toBe(false);
    await test.info().attach(`AND-49: session B sees seat ${seatA.label} unavailable`, {
      body: Buffer.from(await appB.takeScreenshot(), 'base64'),
      contentType: 'image/png',
    });

    const totalElement = appA.$('id=com.cinescape:id/text_kd_total');
    await totalElement.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Session A checkout did not show the amount for its held seat' });
    const totalText = (await totalElement.getText()).trim();
    const total = readKwd(totalText, 'Session A booking total');
    expect(balanceABefore, 'Session A wallet should cover the booking that owns the held seat').toBeGreaterThanOrEqual(total);
    if (!(await paymentListA.isDisplayed().catch(() => false))) {
      await appA.$('id=com.cinescape:id/txt_proceed').click();
      await paymentListA.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Session A did not open payment methods' });
    }
    await appA.$('android=new UiSelector().textContains("Use your Wallet")').click();
    await appA.$('id=com.cinescape:id/textview_bt_wallet_apply').click();
    // Applying the wallet covers the amount (Apply turns into Cancel); Proceed then confirms the booking.
    await appA.$('id=com.cinescape:id/textview_bt_wallet_cancel').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Session A wallet was not applied' });
    await appA.$('id=com.cinescape:id/txt_proceed').click();
    const confirmationId = appA.$('id=com.cinescape:id/text_bookin_id_no');
    await confirmationId.waitForDisplayed({ timeout: 90_000, timeoutMsg: 'Session A did not complete its booking with the held seat' });
    bookingIdA = (await confirmationId.getText()).trim();
    expect(bookingIdA, 'The seat holder should receive one confirmed Booking ID').toMatch(/^[A-Z0-9]{5,}$/i);

    await appA.background(2);
    await appA.activateApp(androidConfig.appPackage);
    const balanceAAfter = await readWalletBalance(appA, 'Session A wallet balance after confirmation');
    expect(balanceABefore - balanceAAfter, 'Session A should be charged once for the held seat')
      .toBeCloseTo(total, 3);

    const dismiss = appB.$('id=com.cinescape:id/positive_btn');
    if (await dismiss.isDisplayed().catch(() => false)) await dismiss.click();
    const balanceBAfter = await readWalletBalance(appB, 'Session B wallet balance after conflict');
    expect(balanceBAfter, 'Session B must not be charged for the conflicting seat').toBeCloseTo(balanceBBefore, 3);
    expect(await bookingHistory(appB), 'Session B (a fresh account) must not have any booking for the conflicting seat').toEqual([]);
    await snap(`AND-49: session A booked ${seatA.label} as ${bookingIdA}; session B was blocked without charge`);
  } catch (error) {
    // The fixture only captures session A; keep session B's screen too.
    if (appB) {
      await test.info().attach('AND-49: session B final screen', {
        body: Buffer.from(await appB.takeScreenshot(), 'base64'),
        contentType: 'image/png',
      }).catch(() => undefined);
      await test.info().attach('session B screen layout', {
        body: await appB.getPageSource(),
        contentType: 'application/xml',
      }).catch(() => undefined);
    }
    throw error;
  } finally {
    await appB?.deleteSession().catch(() => undefined);
    // The paid test booking is cancelled so nothing stays booked on the shared test customer.
    if (bookingIdA) await cleanUpBooking(appA, bookingIdA);
    if (secondEmulator) {
      try {
        execFileSync(androidTools.adb, ['-s', secondSerial, 'emu', 'kill'], { env: androidTools.env(), timeout: 15_000 });
      } catch { /* emulator may have already stopped */ }
      secondEmulator.kill();
    }
  }
});
