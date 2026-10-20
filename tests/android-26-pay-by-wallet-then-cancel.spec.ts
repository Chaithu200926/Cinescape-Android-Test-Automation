import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  bookingHistory,
  newestBookingIndex,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  openUpcomingTicket,
  payWithWallet,
  readTicketDetails,
  readWalletBalance,
  upcomingBookingIds,
} from '../src/android-navigation';

test('AND-26 Pay by wallet, then cancel', async ({ app, snap, androidConfig }) => {
  // The Upcoming list of the shared customer can be long, and each walk opens every ticket (UAT, 18 Oct).
  test.setTimeout(900_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-26 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  // 1. Sign in with the wallet test customer and note the balance.
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-26', 'kiosk');
  const balanceBefore = await readWalletBalance(app, 'Wallet balance before booking');
  await snap(`AND-26: wallet balance before booking KWD ${balanceBefore.toFixed(3)}`);

  // 2. Book one ticket for the next day's show and pay it with the wallet.
  const { title, dateLabel, seatRow, seatNumber, total } = await openPaymentMethods(app, snap, 'AND-26');
  expect(balanceBefore, 'The wallet covers the one-ticket booking').toBeGreaterThanOrEqual(total);
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    await snap(`AND-26: booking ${bookingId} confirmed for ${title}`);

    // 3. The success screen shows the booking that was chosen.
    const ticket = await readTicketDetails(app);
    expect(ticket.movie.toLowerCase(), 'The ticket shows the chosen movie').toContain(title.toLowerCase().trim());
    expect(ticket.seats, 'The ticket shows the chosen seat').toContain(`${seatRow}${seatNumber}`);

    // 4. The booking is listed with its QR ticket, and the wallet was charged exactly the total.
    await app.back();
    const balanceAfterPayment = await readWalletBalance(app, 'Wallet balance after payment');
    expect(balanceBefore - balanceAfterPayment, `The wallet is charged KWD ${total.toFixed(3)}`).toBeCloseTo(total, 3);
    // Opening the ticket from Upcoming Bookings shows it is listed there (it fails with "not listed" otherwise).
    await openUpcomingTicket(app, bookingId);
    expect((await readTicketDetails(app)).hasQrCode, 'The listed ticket shows a QR code').toBe(true);
    await snap(`AND-26: ticket ${bookingId} opened from Upcoming Bookings`);

    // 5. Cancel it from the ticket and confirm.
    const message = await cancelBooking(app, bookingId);
    cancelled = true;
    await snap(`AND-26: booking ${bookingId} cancelled${message ? ` - "${message}"` : ''}`);
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }

  // 6. It is no longer upcoming, History shows it cancelled, and the wallet is refunded in full.
  const idsAfterCancel = await upcomingBookingIds(app);
  expect(idsAfterCancel, 'The cancelled booking is no longer upcoming').not.toContain(bookingId);
  const balanceAfterCancel = await readWalletBalance(app, 'Wallet balance after cancelling');
  expect(balanceAfterCancel, 'The wallet is refunded to its original balance').toBeCloseTo(balanceBefore, 3);
  const history = await bookingHistory(app);
  // Wallet recharges (also by other suites on the shared customer) can be listed above the booking.
  const newest = newestBookingIndex(history);
  expect(history[newest], `History lists the cancelled ${title} booking first`).toMatchObject({ status: 'Cancelled' });
  expect(history[newest].title.toLowerCase()).toContain(title.toLowerCase().trim());
  await snap(`AND-26: ${dateLabel} booking cancelled and KWD ${total.toFixed(3)} refunded to the wallet`);
});
