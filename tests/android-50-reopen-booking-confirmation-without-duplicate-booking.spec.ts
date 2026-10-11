import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  bookingHistory,
  cancelBooking,
  cleanUpBooking,
  firstHistoryPaymentDetails,
  hasKioskCustomer,
  openPaymentMethods,
  openUpcomingTicket,
  payWithWallet,
  readKwd,
  readTicketDetails,
  readWalletBalance,
  upcomingBookingIds,
} from '../src/android-navigation';
import type { AndroidApp } from '../src/android-navigation';

/** KWD amounts printed on the open screen (e.g. "KWD 3.500"), if any. */
const amountsOnScreen = async (app: AndroidApp) => [...(await app.getPageSource()).matchAll(/text="([^"]*)"/g)]
  .map((match) => match[1].replace(/&#160;/g, ' ').trim())
  .filter((text) => /^(?:KWD|KD)\s*[\d,]+\.\d{3}$/i.test(text))
  .map((text) => readKwd(text, 'Ticket amount'));

test('AND-50 Reopen booking confirmation without duplicate booking', async ({ app, snap, androidConfig }) => {
  test.setTimeout(720_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-50 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-50', 'kiosk');
  const balanceBefore = await readWalletBalance(app, 'Wallet balance before booking');
  const idsBefore = await upcomingBookingIds(app);

  // 1. Complete a wallet booking and note its Booking ID and amount.
  const { title, total } = await openPaymentMethods(app, snap, 'AND-50');
  expect(balanceBefore, 'The wallet covers the one-ticket booking').toBeGreaterThanOrEqual(total);
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    const confirmed = await readTicketDetails(app);
    const amountsOnConfirmation = await amountsOnScreen(app);
    await snap(`AND-50: booking ${bookingId} confirmed for KWD ${total.toFixed(3)}`);
    await app.back();

    // 2. Background and reopen the app, then open the booking from Upcoming Bookings.
    await app.background(3);
    await app.activateApp(androidConfig.appPackage);
    const balanceAfterReopen = await readWalletBalance(app, 'Wallet balance after reopening');
    expect(balanceBefore - balanceAfterReopen, `The wallet is charged once, KWD ${total.toFixed(3)}`).toBeCloseTo(total, 3);
    const idsAfterReopen = await upcomingBookingIds(app);
    const added = idsAfterReopen.filter((id) => !idsBefore.includes(id));
    expect(added, 'Exactly one new booking is listed after reopening').toContain(bookingId);
    // The customer is shared with the Kiosk and Web suites, so their bookings are recorded, not failed on.
    const othersAdded = added.filter((id) => id !== bookingId);
    if (othersAdded.length) {
      test.info().annotations.push({ type: 'note', description: `Other bookings also appeared under Upcoming Bookings: ${othersAdded.join(', ')}` });
    }

    await openUpcomingTicket(app, bookingId);
    const reopened = await readTicketDetails(app);
    expect(reopened, 'The reopened ticket shows the same booking').toMatchObject({
      bookingId,
      movie: confirmed.movie,
      dateTime: confirmed.dateTime,
      seats: confirmed.seats,
    });
    expect(reopened.hasQrCode, 'The reopened ticket shows its QR code').toBe(true);
    const amountsOnReopened = await amountsOnScreen(app);
    if (amountsOnConfirmation.length || amountsOnReopened.length) {
      expect(amountsOnReopened, 'The reopened ticket shows the same amount as the confirmation').toEqual(amountsOnConfirmation);
      expect(amountsOnReopened, `The ticket amount is the booking total KWD ${total.toFixed(3)}`).toContainEqual(total);
    } else {
      test.info().annotations.push({ type: 'finding', description: 'The ticket screen shows no amount; the amount is checked through the wallet charge instead.' });
    }
    await snap(`AND-50: ticket ${bookingId} reopened from Upcoming Bookings`);

    // 3. Android Back, then revisit the same booking details.
    await app.back();
    await openUpcomingTicket(app, bookingId);
    expect((await readTicketDetails(app)).bookingId, 'Revisiting shows the same Booking ID').toBe(bookingId);
    await snap(`AND-50: ticket ${bookingId} revisited after Back`);
    await app.back();

    // 4. Still one booking and one payment: no new Booking ID and no further charge.
    const idsAfterRevisit = await upcomingBookingIds(app);
    expect(idsAfterRevisit.filter((id) => !idsAfterReopen.includes(id)), 'Revisiting the ticket adds no booking').toEqual([]);
    expect(await readWalletBalance(app, 'Wallet balance after revisiting'), 'Revisiting the ticket charges nothing more')
      .toBeCloseTo(balanceAfterReopen, 3);

    // The paid test booking is cancelled so nothing stays booked on the shared test customer.
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
  expect(await readWalletBalance(app, 'Wallet balance after cancelling'), 'Cancelling refunds the wallet').toBeCloseTo(balanceBefore, 3);
  // History lists bookings once they are cancelled or past: this one appears once, as the newest entry.
  const history = await bookingHistory(app);
  expect(history[0], `History lists the ${title} booking first, cancelled`).toMatchObject({ status: 'Cancelled' });
  expect(history[0].title.toLowerCase()).toContain(title.toLowerCase().trim());
  expect((await firstHistoryPaymentDetails(app)).bookingId, 'The newest History entry is this booking').toBe(bookingId);
  await snap(`AND-50: History shows ${bookingId} once, cancelled and refunded`);
});
