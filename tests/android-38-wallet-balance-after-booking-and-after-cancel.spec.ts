import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  payWithWallet,
  readWalletBalance,
} from '../src/android-navigation';

test('AND-38 Wallet balance after booking and after cancel', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-38 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  // 1. Note the wallet balance.
  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-38', 'kiosk');
  const oldBalance = await readWalletBalance(app, 'Wallet balance before booking');
  await snap(`AND-38: wallet balance KWD ${oldBalance.toFixed(3)}`);

  // 2. Book one ticket with the wallet; the balance drops by exactly the total.
  const { title, total } = await openPaymentMethods(app, snap, 'AND-38');
  expect(oldBalance, 'The wallet covers the one-ticket booking').toBeGreaterThanOrEqual(total);
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    await snap(`AND-38: ${title} booked as ${bookingId} for KWD ${total.toFixed(3)}`);
    const balanceAfterBooking = await readWalletBalance(app, 'Wallet balance after booking');
    expect(balanceAfterBooking, `Balance = old (${oldBalance.toFixed(3)}) - total (${total.toFixed(3)})`)
      .toBeCloseTo(oldBalance - total, 3);
    await snap(`AND-38: wallet balance after booking KWD ${balanceAfterBooking.toFixed(3)}`);

    // 3. Cancel it; the balance returns to the old value.
    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
  const balanceAfterCancel = await readWalletBalance(app, 'Wallet balance after cancelling');
  expect(balanceAfterCancel, 'The wallet is refunded in full').toBeCloseTo(oldBalance, 3);
  await snap(`AND-38: wallet balance back to KWD ${balanceAfterCancel.toFixed(3)} after cancelling ${bookingId}`);
});
