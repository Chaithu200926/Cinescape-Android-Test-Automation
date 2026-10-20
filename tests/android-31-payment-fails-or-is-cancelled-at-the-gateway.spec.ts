import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  bookingHistory,
  historyPaymentDetails,
  newestBookingIndex,
  hasKioskCustomer,
  openFirstMovieDetails,
  openKnetGateway,
  openPaymentMethods,
  openUpcomingTicket,
  readTicketDetails,
  readWalletBalance,
  tapElementCenter,
  tapNativeElementCenter,
  upcomingBookingIds,
} from '../src/android-navigation';

test('AND-31 Payment fails or is cancelled at the gateway', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-31 needs the configured Kiosk UAT customer (username, password and OTP).');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-31', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');
  const idsBefore = await upcomingBookingIds(app);

  // 1. Book one ticket and choose KNET.
  const { title, dateLabel, showtimeLabel, seatRow, seatNumber, total } = await openPaymentMethods(app, snap, 'AND-31');
  const gatewayAmount = await openKnetGateway(app);
  expect(gatewayAmount, 'The KNET gateway asks for the booking total').toBeCloseTo(total, 3);
  await snap(`AND-31: KNET gateway for KWD ${total.toFixed(3)}`);

  // 2. Cancel on the gateway.
  await app.$('android=new UiSelector().className("android.widget.Button").text("Cancel")').click();

  // 3. The app shows a clear failure and no Booking ID.
  const failed = app.$('android=new UiSelector().text("FAILED!")');
  await failed.waitForDisplayed({ timeout: 120_000, timeoutMsg: 'Cancelling at the gateway did not show the payment-failed screen' });
  const explanation = (await app.$('id=com.cinescape:id/textView61').getText()).trim();
  expect(explanation, 'The failure explains the reservation was not made').toMatch(/unsuccessful/i);
  expect((await app.$('id=com.cinescape:id/textView141').getText()).trim(), 'No reference/Booking ID is issued').toBe('');
  expect(await app.$('id=com.cinescape:id/text_bookin_id_no').isDisplayed().catch(() => false), 'No ticket is shown').toBe(false);
  const trackNumber = (await app.$('id=com.cinescape:id/textView142').getText()).trim();
  await snap(`AND-31: "Sorry, Your transaction FAILED!" (track ${trackNumber})`);
  await app.back();

  // 4. No booking is listed, the wallet is unchanged and History records the attempt as cancelled.
  // The shared customer's list also changes for other reasons (other suites book; started shows drop off),
  // so each newly listed booking is opened and must not be the cancelled show and seat.
  const newIds = (await upcomingBookingIds(app)).filter((bookingId) => !idsBefore.includes(bookingId));
  for (const bookingId of newIds) {
    // The list does not always show the same bookings twice in a row; one that is gone again is skipped.
    const opened = await openUpcomingTicket(app, bookingId).then(() => true, () => false);
    if (!opened) {
      test.info().annotations.push({ type: 'note', description: `Booking ${bookingId} was listed once and then no longer shown; not checked.` });
      continue;
    }
    const ticket = await readTicketDetails(app);
    const sameBooking = ticket.seats.includes(`${seatRow}${seatNumber}`) && ticket.dateTime.includes(showtimeLabel.split(' ')[0])
      && ticket.movie.toLowerCase().includes(title.toLowerCase().trim());
    expect(sameBooking, `New booking ${bookingId} (${ticket.movie}, ${ticket.dateTime}, ${ticket.seats.join(' ')}) is not the cancelled one`).toBe(false);
    await app.back();
  }
  if (newIds.length) test.info().annotations.push({ type: 'note', description: `Other bookings appeared meanwhile: ${newIds.join(', ')}` });
  expect(await readWalletBalance(app, 'Wallet balance after the failed payment'), 'The wallet is unchanged').toBeCloseTo(walletBefore, 3);
  const history = await bookingHistory(app);
  // Wallet recharges (also by other suites on the shared customer) can be listed above the booking.
  const newest = newestBookingIndex(history);
  expect(history[newest]?.status, 'History records the failed attempt as cancelled').toBe('Cancelled');
  const details = await historyPaymentDetails(app, newest);
  expect(details.trackId, 'History shows the same gateway track number').toBe(trackNumber);
  expect(details.bookingId, 'The failed attempt has no Booking ID').toBe('');
  await snap('AND-31: History records the cancelled payment without a Booking ID');

  // ...and the seat is released: reopening the same show offers that seat again.
  // The booking used the first Now Showing movie; reopen it the same way.
  const reopened = await openFirstMovieDetails(app);
  expect(reopened.title, 'The same movie is reopened').toBe(title);
  const dateLabels = await app.$$('id=com.cinescape:id/card_day_date').map(async (chip) => (
    await chip.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())
  ).filter(Boolean).join(' '));
  const dateIndex = dateLabels.indexOf(dateLabel);
  expect(dateIndex, `The booked date "${dateLabel}" is still offered`).toBeGreaterThanOrEqual(0);
  await tapElementCenter(app, (await app.$$('id=com.cinescape:id/card_day_date'))[dateIndex]);
  await app.pause(1_500);
  const time = /\d{1,2}:\d{2}/.exec(showtimeLabel)?.[0] ?? showtimeLabel;
  let showtime: WebdriverIO.Element | undefined;
  for (const candidate of await app.$$('id=com.cinescape:id/card_scroll')) {
    const labels = await candidate.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim());
    if (labels.some((label) => label.includes(time))) { showtime = candidate; break; }
  }
  if (!showtime) throw new Error(`The ${time} show is no longer listed for ${dateLabel}.`);
  await tapNativeElementCenter(app, showtime);
  await app.$('id=com.cinescape:id/select_seat_category').waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The show did not reopen its seat categories' });
  await app.$('android=new UiSelector().text("General")').click();
  await app.$('id=com.cinescape:id/text_proceeds').click();
  await app.$('id=com.cinescape:id/seat_table').waitForDisplayed({ timeout: 90_000, timeoutMsg: 'The seat map did not reopen' });
  await app.$('id=com.cinescape:id/progress').waitForDisplayed({ reverse: true, timeout: 60_000 }).catch(() => undefined);
  let currentRow = '';
  let released = false;
  for (const cell of await app.$('id=com.cinescape:id/seat_table').$$('android.widget.TextView')) {
    const label = (await cell.getText()).trim();
    if (/^[A-Z]$/.test(label)) currentRow = label;
    else if (currentRow === seatRow && label === seatNumber) { released = await cell.isEnabled(); break; }
  }
  expect(released, `Seat ${seatRow}${seatNumber} is available again after the failed payment`).toBe(true);
  await snap(`AND-31: seat ${seatRow}${seatNumber} released after the failed payment`);
});
