import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  bookingHistory,
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
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-26 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  // 1. Sign in with the wallet test customer and note the balance.
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-26', 'kiosk');
  const balanceBefore = await readWalletBalance(app, 'Wallet balance before booking');
  const idsBefore = await upcomingBookingIds(app);
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
    const idsAfterPayment = await upcomingBookingIds(app);
    expect(idsAfterPayment, 'The new booking is listed under Upcoming Bookings').toContain(bookingId);
    // The customer is shared with the Kiosk and Web suites, so other new bookings are recorded, not failed on.
    const othersAdded = idsAfterPayment.filter((id) => id !== bookingId && !idsBefore.includes(id));
    if (othersAdded.length) {
      test.info().annotations.push({ type: 'note', description: `Other bookings also appeared under Upcoming Bookings: ${othersAdded.join(', ')}` });
    }
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
  expect(history[0], `History lists the cancelled ${title} booking first`).toMatchObject({ status: 'Cancelled' });
  expect(history[0].title.toLowerCase()).toContain(title.toLowerCase().trim());
  await snap(`AND-26: ${dateLabel} booking cancelled and KWD ${total.toFixed(3)} refunded to the wallet`);
});
