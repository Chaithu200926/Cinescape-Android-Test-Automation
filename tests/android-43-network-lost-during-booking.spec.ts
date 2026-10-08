import { execFileSync } from 'node:child_process';
import { test, expect } from '../src/fixtures';
import { androidTools } from '../src/android-config';
import {
  beginCaseJourney,
  cancelUnpaidCheckout,
  hasKioskCustomer,
  readWalletBalance,
  selectOneSeat,
  upcomingBookingIds,
} from '../src/android-navigation';
import type { AndroidApp } from '../src/android-navigation';

/** Turns the emulator's Wi-Fi and mobile data off or on (the test equivalent of airplane mode). */
const setNetwork = (on: boolean) => {
  for (const radio of ['wifi', 'data']) {
    execFileSync(androidTools.adb, ['shell', 'svc', radio, on ? 'enable' : 'disable'], { env: androidTools.env(), timeout: 20_000 });
  }
};

const waitForNetwork = async (app: AndroidApp) => {
  await app.waitUntil(async () => {
    try {
      execFileSync(androidTools.adb, ['shell', 'ping', '-c', '1', '-W', '3', 'apidev.cinescape.com.kw'], { env: androidTools.env(), stdio: 'ignore', timeout: 15_000 });
      return true;
    } catch {
      return false;
    }
  }, { timeout: 60_000, interval: 3_000, timeoutMsg: 'The emulator did not get its network back' });
};

/** Waits for the app's message dialog and returns its text, or '' when no dialog appears. */
const appMessage = async (app: AndroidApp) => {
  const subtitle = app.$('id=com.cinescape:id/subtitle');
  const visible = await subtitle.waitForDisplayed({ timeout: 45_000 }).then(() => true, () => false);
  return visible ? (await subtitle.getText()).trim() : '';
};

test('AND-43 Network lost during booking', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-43 needs the configured Kiosk UAT customer (username, password and OTP).');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-43', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before the test');
  const idsBefore = await upcomingBookingIds(app);

  try {
    // 1. Start a booking and reach the seat map with a seat selected.
    const { title, seatRow, seatNumber, progress } = await selectOneSeat(app, snap, 'AND-43');

    // 2-3. Turn the network off and tap Proceed: a clear message, and the app does not crash.
    setNetwork(false);
    await app.$('id=com.cinescape:id/txt_proceed').click();
    const offlineMessage = await appMessage(app);
    expect(await app.getCurrentPackage(), 'The app stays open without network').toBe(androidConfig.appPackage);
    expect(offlineMessage, 'The app explains that the request could not be completed').not.toBe('');
    expect(await app.$('id=com.cinescape:id/uiCheckout').isDisplayed().catch(() => false), 'Checkout does not open offline').toBe(false);
    await snap(`AND-43: offline at the seat map - "${offlineMessage}"`);
    const ok = app.$('id=com.cinescape:id/positive_btn');
    if (await ok.isDisplayed().catch(() => false)) await ok.click();

    // 4. Network back on: retrying continues the booking (or restarts it cleanly from the seat map).
    setNetwork(true);
    await waitForNetwork(app);
    const checkout = app.$('id=com.cinescape:id/uiCheckout');
    const proceed = app.$('id=com.cinescape:id/txt_proceed');
    if (await proceed.isDisplayed().catch(() => false)) {
      await proceed.click();
      await progress.waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
    }
    await checkout.waitForDisplayed({ timeout: 60_000, timeoutMsg: `Retrying online did not continue the ${title} booking to checkout` });
    expect(await app.$$('id=com.cinescape:id/seatNumber').map(async (seat) => (await seat.getText()).trim()), 'The retried booking keeps the chosen seat')
      .toContain(`${seatRow}${seatNumber}`);
    await snap(`AND-43: back online, checkout continued with seat ${seatRow}${seatNumber}`);

    // 5. Repeat during payment: offline at the payment list, nothing is paid.
    await proceed.click();
    await app.$('id=com.cinescape:id/paymentLayout').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Checkout did not open the payment list' });
    setNetwork(false);
    await app.$('id=com.cinescape:id/knet').click();
    await proceed.click();
    const paymentMessage = await appMessage(app);
    expect(await app.getCurrentPackage(), 'The app stays open when payment starts offline').toBe(androidConfig.appPackage);
    expect(await app.$('id=com.cinescape:id/text_bookin_id_no').isDisplayed().catch(() => false), 'No booking is confirmed offline').toBe(false);
    await snap(`AND-43: offline at payment - "${paymentMessage || 'no gateway opened'}"`);
    if (await ok.isDisplayed().catch(() => false)) await ok.click();
  } finally {
    setNetwork(true);
  }
  await waitForNetwork(app);
  // Leave the unpaid checkout (or the gateway page) and confirm the final booking status.
  for (let attempt = 0; attempt < 3 && !(await app.$('id=com.cinescape:id/text_cancel').isDisplayed().catch(() => false)); attempt += 1) {
    if (await app.$('id=com.cinescape:id/accountFragment').isDisplayed().catch(() => false)) break;
    await app.back();
    await app.pause(1_500);
  }
  await cancelUnpaidCheckout(app);
  expect(await upcomingBookingIds(app), 'No booking was created by the interrupted attempts').toEqual(idsBefore);
  expect(await readWalletBalance(app, 'Wallet balance after the test'), 'Nothing was paid').toBeCloseTo(walletBefore, 3);
  await snap('AND-43: no booking and no charge after the network interruptions');
});
