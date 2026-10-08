import { execFileSync } from 'node:child_process';
import { test, expect } from '../src/fixtures';
import { androidTools } from '../src/android-config';
import {
  beginCaseJourney,
  cancelUnpaidCheckout,
  hasKioskCustomer,
  openArea,
  openUpcomingTicket,
  readTicketDetails,
  readWalletBalance,
  selectOneSeat,
  tapNativeElementCenter,
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
      // The app treats the phone as offline until Android has validated the network, which comes after ping works.
      const connectivity = execFileSync(androidTools.adb, ['shell', 'dumpsys', 'connectivity'], { env: androidTools.env(), encoding: 'utf8', timeout: 15_000 });
      return connectivity.split('\n').some((line) => line.includes('NetworkAgentInfo') && line.includes('CONNECTED') && line.includes('IS_VALIDATED'));
    } catch {
      return false;
    }
  }, { timeout: 120_000, interval: 3_000, timeoutMsg: 'The emulator did not get a validated network back' });
};

/**
 * Waits for the app's offline notice and returns its text, or '' when none appears. The app shows either
 * its message dialog or a full-screen "Network Error" page (with Settings and Try Again).
 */
const appMessage = async (app: AndroidApp) => {
  const subtitle = app.$('id=com.cinescape:id/subtitle');
  const networkError = app.$('id=com.cinescape:id/textView25');
  const shown = await app.waitUntil(async () => (await subtitle.isDisplayed().catch(() => false)) || (await networkError.isDisplayed().catch(() => false)),
    { timeout: 45_000 }).then(() => true, () => false);
  if (!shown) return '';
  if (await networkError.isDisplayed().catch(() => false)) {
    return `${(await networkError.getText()).trim()}: ${(await app.$('id=com.cinescape:id/textView26').getText()).replace(/\s+/g, ' ').trim()}`;
  }
  return (await subtitle.getText()).trim();
};

/** Clears the offline notice: OK on the dialog, or Try Again on the Network Error page (once online). */
const dismissOfflineNotice = async (app: AndroidApp) => {
  const ok = app.$('id=com.cinescape:id/positive_btn');
  if (await ok.isDisplayed().catch(() => false)) await ok.click();
  // The Network Error page can take a few Try Again taps to clear once the network is back.
  const tryAgain = app.$('id=com.cinescape:id/textView28');
  for (let attempt = 0; attempt < 6 && await tryAgain.isDisplayed().catch(() => false); attempt += 1) {
    await tryAgain.click();
    await app.pause(5_000);
  }
};

/**
 * Clears the offline notice; when the Network Error page will not clear although the network is back,
 * records that as a finding and restarts the app.
 */
const recoverFromNetworkError = async (app: AndroidApp, appPackage: string, snap: (label: string) => Promise<void>) => {
  await dismissOfflineNotice(app);
  if (!(await app.$('id=com.cinescape:id/textView25').isDisplayed().catch(() => false))) return;
  test.info().annotations.push({
    type: 'finding',
    description: 'After the network was lost on the payment page, the Network Error page stayed when the network came back (Try Again tapped 6 times over 30 s); the app had to be restarted.',
  });
  await snap('AND-43: Network Error page stays after the network is back');
  await app.terminateApp(appPackage);
  await app.activateApp(appPackage);
  await app.$('id=com.cinescape:id/homeFragment').waitForDisplayed({ timeout: 240_000, timeoutMsg: 'The app did not reopen after the restart' });
};

test('AND-43 Network lost during booking', async ({ app, snap, androidConfig }) => {
  test.setTimeout(900_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-43 needs the configured Kiosk UAT customer (username, password and OTP).');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-43', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before the test');
  const idsBefore = await upcomingBookingIds(app);

  const chosen = { title: '', seatRow: '', seatNumber: '' };
  try {
    // 1. Start a booking and reach the seat map with a seat selected.
    const { title, seatRow, seatNumber, progress } = await selectOneSeat(app, snap, 'AND-43');
    Object.assign(chosen, { title, seatRow, seatNumber });

    // 2-3. Turn the network off and tap Proceed: a clear message, and the app does not crash.
    setNetwork(false);
    // The app may cover the screen with its Network Error page before Proceed can be tapped.
    await app.pause(2_000);
    const proceedOffline = app.$('id=com.cinescape:id/txt_proceed');
    if (await proceedOffline.isDisplayed().catch(() => false)) await proceedOffline.click().catch(() => undefined);
    const offlineMessage = await appMessage(app);
    expect(await app.getCurrentPackage(), 'The app stays open without network').toBe(androidConfig.appPackage);
    expect(offlineMessage, 'The app explains that the request could not be completed').not.toBe('');
    expect(await app.$('id=com.cinescape:id/uiCheckout').isDisplayed().catch(() => false), 'Checkout does not open offline').toBe(false);
    await snap(`AND-43: offline at the seat map - "${offlineMessage}"`);

    // 4. Network back on: retrying continues the booking (or restarts it cleanly from the seat map).
    setNetwork(true);
    await waitForNetwork(app);
    await dismissOfflineNotice(app);
    const checkout = app.$('id=com.cinescape:id/uiCheckout');
    const proceed = app.$('id=com.cinescape:id/txt_proceed');
    let bookedSeat = `${seatRow}${seatNumber}`;
    if (await proceed.isDisplayed().catch(() => false)) {
      await proceed.click();
      await progress.waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
    }
    // Try Again reloads the seat map without the earlier choice (a clean restart): a seat is chosen again.
    const noSeat = app.$('android=new UiSelector().resourceId("com.cinescape:id/subtitle").textContains("Select At least One Seat")');
    if (await noSeat.waitForDisplayed({ timeout: 10_000 }).then(() => true, () => false)) {
      await app.$('id=com.cinescape:id/positive_btn').click();
      let row = '';
      for (const cell of await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView')) {
        const label = (await cell.getText()).trim();
        if (/^[A-Z]$/.test(label)) row = label;
        else if (/^\d+$/.test(label) && await cell.isEnabled()) {
          await tapNativeElementCenter(app, cell);
          bookedSeat = `${row}${label}`;
          break;
        }
      }
      test.info().annotations.push({ type: 'note', description: `After the network came back, Try Again reloaded the seat map without seat ${seatRow}${seatNumber}; seat ${bookedSeat} was chosen again.` });
      await proceed.click();
      await progress.waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
    }
    await checkout.waitForDisplayed({ timeout: 60_000, timeoutMsg: `Retrying online did not continue the ${title} booking to checkout` });
    expect(await app.$$('id=com.cinescape:id/seatNumber').map(async (seat) => (await seat.getText()).trim()), 'Checkout holds the chosen seat')
      .toContain(bookedSeat);
    Object.assign(chosen, { seatRow: bookedSeat.replace(/\d+/, ''), seatNumber: bookedSeat.replace(/\D+/, '') });
    await snap(`AND-43: back online, checkout continued with seat ${bookedSeat}`);

    // 5. Repeat during payment: offline at the payment list, nothing is paid.
    await proceed.click();
    await app.$('id=com.cinescape:id/paymentLayout').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Checkout did not open the payment list' });
    setNetwork(false);
    await app.pause(2_000);
    const knetOffline = app.$('id=com.cinescape:id/knet');
    if (await knetOffline.isDisplayed().catch(() => false)) {
      await knetOffline.click().catch(() => undefined);
      if (await proceed.isDisplayed().catch(() => false)) await proceed.click().catch(() => undefined);
    }
    const paymentMessage = await appMessage(app);
    expect(await app.getCurrentPackage(), 'The app stays open when payment starts offline').toBe(androidConfig.appPackage);
    expect(await app.$('id=com.cinescape:id/text_bookin_id_no').isDisplayed().catch(() => false), 'No booking is confirmed offline').toBe(false);
    await snap(`AND-43: offline at payment - "${paymentMessage || 'no gateway opened'}"`);
  } finally {
    setNetwork(true);
  }
  await waitForNetwork(app);
  await recoverFromNetworkError(app, androidConfig.appPackage, snap);
  // Leave the unpaid checkout (or the gateway page) and confirm the final booking status.
  for (let attempt = 0; attempt < 3 && !(await app.$('id=com.cinescape:id/text_cancel').isDisplayed().catch(() => false)); attempt += 1) {
    if (await app.$('id=com.cinescape:id/accountFragment').isDisplayed().catch(() => false)) break;
    await app.back();
    await app.pause(1_500);
  }
  await cancelUnpaidCheckout(app);
  // The Network Error page can come back while moving to Account after the payment-page interruption.
  await app.pause(5_000);
  await recoverFromNetworkError(app, androidConfig.appPackage, snap);
  const accountReached = await openArea(app, 'account').then(() => true, () => false);
  if (!accountReached) await recoverFromNetworkError(app, androidConfig.appPackage, snap);
  // The shared customer's list changes for other reasons too, so each new booking is opened and checked.
  for (const bookingId of (await upcomingBookingIds(app)).filter((listed) => !idsBefore.includes(listed))) {
    // The list does not always show the same bookings twice in a row; one that is gone again is skipped.
    const opened = await openUpcomingTicket(app, bookingId).then(() => true, () => false);
    if (!opened) {
      test.info().annotations.push({ type: 'note', description: `Booking ${bookingId} was listed once and then no longer shown; not checked.` });
      continue;
    }
    const ticket = await readTicketDetails(app);
    expect(ticket.seats.includes(`${chosen.seatRow}${chosen.seatNumber}`) && ticket.movie.toLowerCase().includes(chosen.title.toLowerCase().trim()),
      `New booking ${bookingId} is not from the interrupted attempts`).toBe(false);
    await app.back();
  }
  expect(await readWalletBalance(app, 'Wallet balance after the test'), 'Nothing was paid').toBeCloseTo(walletBefore, 3);
  await snap('AND-43: no booking and no charge after the network interruptions');
});
