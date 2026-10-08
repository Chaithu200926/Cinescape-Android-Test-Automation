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
  readWalletBalance,
  upcomingBookingIds,
} from '../src/android-navigation';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Show start in Kuwait time (UTC+3) from the checkout's "08 Oct 2026" and "15:00". */
const showStart = (date: string, time: string) => {
  const [, day, month, year] = /(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/.exec(date) ?? [];
  const [, hours, minutes] = /(\d{1,2}):(\d{2})/.exec(time) ?? [];
  if (!day || !hours) throw new Error(`Could not read the show date/time from "${date}" "${time}".`);
  return Date.UTC(Number(year), months.indexOf(month), Number(day), Number(hours) - 3, Number(minutes));
};

test('AND-36 Cancel 2 hours or more before the show; refund credited', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-36 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  // 1. Book a show more than 2 hours away, noting the amount paid and the wallet balance.
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-36', 'kiosk');
  const balanceBefore = await readWalletBalance(app, 'Wallet balance before booking');
  const { title, total, review } = await openPaymentMethods(app, snap, 'AND-36');
  const hoursAway = (showStart(review.date, review.time) - Date.now()) / 3_600_000;
  expect(hoursAway, `The ${review.date} ${review.time} show is at least 2 hours away`).toBeGreaterThanOrEqual(2);
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    const balanceAfterPayment = await readWalletBalance(app, 'Wallet balance after payment');
    expect(balanceBefore - balanceAfterPayment, 'The amount paid comes from the wallet').toBeCloseTo(total, 3);
    await snap(`AND-36: ${title} ${review.date} ${review.time} booked as ${bookingId} (${hoursAway.toFixed(1)} h before the show)`);

    // 2. Open the booking; cancel is offered. Cancel and confirm.
    await openUpcomingTicket(app, bookingId);
    expect(await app.$('id=com.cinescape:id/textView48').isDisplayed(), 'Cancel Reservation is offered 2+ hours before the show').toBe(true);
    await snap(`AND-36: Cancel Reservation offered for ${bookingId}`);
    const message = await cancelBooking(app, bookingId);
    cancelled = true;
    expect(message).toMatch(/cancel booking successfully/i);
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }

  // 3. It leaves Upcoming Bookings and shows as cancelled in History.
  expect(await upcomingBookingIds(app), 'The cancelled booking leaves Upcoming Bookings').not.toContain(bookingId);
  const history = await bookingHistory(app);
  expect(history[0]?.status, `History shows ${bookingId} as cancelled`).toBe('Cancelled');
  expect((await firstHistoryPaymentDetails(app)).bookingId, 'The cancelled History entry is this booking').toBe(bookingId);
  await snap(`AND-36: ${bookingId} shown as Cancelled in History`);

  // 4. The amount paid is credited back to the wallet.
  const balanceAfterCancel = await readWalletBalance(app, 'Wallet balance after cancelling');
  expect(balanceAfterCancel - (balanceBefore - total), `KWD ${total.toFixed(3)} is credited back`).toBeCloseTo(total, 3);
  await snap(`AND-36: KWD ${total.toFixed(3)} credited back; wallet KWD ${balanceAfterCancel.toFixed(3)}`);
});
