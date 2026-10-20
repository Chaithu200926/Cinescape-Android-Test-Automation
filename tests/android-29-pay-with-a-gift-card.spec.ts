import { test, expect } from '../src/fixtures';
import {
  acknowledgeAppMessage,
  amountToBePaid,
  beginCaseJourney,
  bookingHistory,
  cancelBooking,
  cleanUpBooking,
  historyPaymentDetails,
  newestBookingIndex,
  hasKioskCustomer,
  openPaymentMethods,
  openPaymentPanel,
  readWalletBalance,
  waitForConfirmedBooking,
} from '../src/android-navigation';

test('AND-29 Pay with a gift card', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-29 needs the configured Kiosk UAT customer (username, password and OTP).');
  }
  const giftCard = androidConfig.payment.giftCard;
  if (!giftCard) throw new Error('Set ANDROID_TEST_GIFT_CARD (the 50 KD UAT gift card) for the gift card payment.');

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-29', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');
  const { title, total } = await openPaymentMethods(app, snap, 'AND-29');
  await openPaymentPanel(app, 'Add a Gift Card');
  const giftCardInput = app.$('id=com.cinescape:id/etEnterGiftCardNumber');
  const apply = app.$('id=com.cinescape:id/tv_apply_gift_card');

  // 4. An invalid gift card is refused with a clear error (checked first, before the valid card is used).
  await giftCardInput.setValue('1000000000000000');
  await app.hideKeyboard().catch(() => undefined);
  await apply.click();
  const refusal = await acknowledgeAppMessage(app);
  expect(refusal, 'An unknown gift card is refused').toMatch(/gift card not found|invalid/i);
  expect(await amountToBePaid(app), 'A refused gift card takes nothing off the total').toBeCloseTo(total, 3);
  await snap(`AND-29: invalid gift card refused - "${refusal}"`);

  // 1-2. The test gift card is applied and its value is taken off the total.
  await giftCardInput.clearValue();
  await giftCardInput.setValue(giftCard);
  await app.hideKeyboard().catch(() => undefined);
  await apply.click();
  const removeGiftCard = app.$('id=com.cinescape:id/textview_cancel_gift_card');
  await removeGiftCard.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The test gift card was not applied' });
  const remaining = await amountToBePaid(app);
  expect(remaining, 'The gift card value is taken off the total').toBeLessThan(total);
  await snap(`AND-29: gift card applied - KWD ${remaining.toFixed(3)} left to pay of KWD ${total.toFixed(3)}`);
  // The 50 KD test card covers a single ticket in full, so no second payment method is needed.
  expect(remaining, 'The 50 KD gift card covers the one-ticket booking in full').toBe(0);

  let bookingId = '';
  let cancelled = false;
  try {
    await app.$('id=com.cinescape:id/txt_proceed').click();
    // 3. The success screen and History show the gift card booking.
    bookingId = await waitForConfirmedBooking(app);
    await snap(`AND-29: ${title} booked as ${bookingId} with the gift card`);
    await app.back();
    expect(await readWalletBalance(app, 'Wallet balance after gift card payment'), 'The wallet was not charged')
      .toBeCloseTo(walletBefore, 3);
    const history = await bookingHistory(app);
    // Wallet recharges (also by other suites on the shared customer) can be listed above the booking.
    const newest = newestBookingIndex(history);
    expect(history[newest]?.status, 'History lists the new gift card booking as upcoming').toBe('Upcoming');
    expect((await historyPaymentDetails(app, newest)).bookingId, 'History shows the gift card booking').toBe(bookingId);
    await snap(`AND-29: History shows gift card booking ${bookingId}`);

    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
});
