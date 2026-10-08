import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openCreditCardForm,
  openPaymentMethods,
  payWithCreditCard,
  readTicketDetails,
  readWalletBalance,
  upcomingBookingIds,
} from '../src/android-navigation';

test('AND-28 Pay by credit card', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-28 needs the configured Kiosk UAT customer (username, password and OTP).');
  }

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-28', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');

  // 1. Book one ticket and choose Credit Card; the card form asks for the booking total.
  const { title, seatRow, seatNumber, total } = await openPaymentMethods(app, snap, 'AND-28');
  expect(await openCreditCardForm(app), 'The card form charges the booking total').toBeCloseTo(total, 3);
  let bookingId = '';
  let cancelled = false;
  try {
    // 2-3. Enter the test card (and 3-D Secure if asked); the success ticket shows a Booking ID.
    bookingId = await payWithCreditCard(app, androidConfig, snap, 'AND-28');
    const ticket = await readTicketDetails(app);
    expect(ticket.movie.toLowerCase(), 'The ticket shows the booked movie').toContain(title.toLowerCase().trim());
    expect(ticket.seats, 'The ticket shows the booked seat').toContain(`${seatRow}${seatNumber}`);
    await snap(`AND-28: credit card payment confirmed booking ${bookingId}`);
    await app.back();
    expect(await upcomingBookingIds(app), 'The card booking is listed under Upcoming Bookings').toContain(bookingId);

    // 4. Cancel the booking and check the refund.
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
  expect(await upcomingBookingIds(app), 'The cancelled booking is no longer upcoming').not.toContain(bookingId);
  const walletAfterCancel = await readWalletBalance(app, 'Wallet balance after cancelling');
  expect(walletAfterCancel - walletBefore, `The card amount KWD ${total.toFixed(3)} is refunded to the wallet`).toBeCloseTo(total, 3);
  await snap(`AND-28: ${bookingId} cancelled; KWD ${total.toFixed(3)} refunded to the wallet`);
});
