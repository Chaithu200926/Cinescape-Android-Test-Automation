import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  payWithKnet,
  readTicketDetails,
  readWalletBalance,
  upcomingBookingIds,
} from '../src/android-navigation';

test('AND-27 Pay by KNET', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-27 needs the configured Kiosk UAT customer (username, password and OTP).');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-27', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');

  // 1. Book one ticket for tomorrow and choose KNET.
  const { title, seatRow, seatNumber, total } = await openPaymentMethods(app, snap, 'AND-27');
  let bookingId = '';
  let cancelled = false;
  try {
    // 2-3. Complete the KNET test gateway; the app returns to the success ticket with a Booking ID.
    bookingId = await payWithKnet(app, androidConfig, snap, 'AND-27');
    const ticket = await readTicketDetails(app);
    expect(ticket.movie.toLowerCase(), 'The ticket shows the booked movie').toContain(title.toLowerCase().trim());
    expect(ticket.seats, 'The ticket shows the booked seat').toContain(`${seatRow}${seatNumber}`);
    await snap(`AND-27: KNET payment confirmed booking ${bookingId}`);
    await app.back();
    expect(await readWalletBalance(app, 'Wallet balance after KNET payment'), 'KNET payment does not touch the wallet')
      .toBeCloseTo(walletBefore, 3);
    expect(await upcomingBookingIds(app), 'The KNET booking is listed under Upcoming Bookings').toContain(bookingId);

    // 4. Cancel the booking from the bookings list; KNET payments are refunded to the wallet.
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
  expect(await upcomingBookingIds(app), 'The cancelled booking is no longer upcoming').not.toContain(bookingId);
  const walletAfterCancel = await readWalletBalance(app, 'Wallet balance after cancelling');
  expect(walletAfterCancel - walletBefore, `The KNET amount KWD ${total.toFixed(3)} is refunded to the wallet`).toBeCloseTo(total, 3);
  await snap(`AND-27: ${bookingId} cancelled; KWD ${total.toFixed(3)} refunded to the wallet`);
});
