import { test, expect } from '../src/fixtures';
import {
  acknowledgeAppMessage,
  amountToBePaid,
  beginCaseJourney,
  cancelBooking,
  cancelUnpaidCheckout,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  openPaymentPanel,
  payWithCreditCard,
  readWalletBalance,
} from '../src/android-navigation';

test('AND-30 Pay with a bank offer', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-30 needs the configured Kiosk UAT customer (username, password and OTP).');
  }
  const eligibleCard = androidConfig.payment.cardNumber;

  await beginCaseJourney(app, androidConfig, snap, 'account', true, 'AND-30', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet balance before booking');

  // 1. Book a ticket and open the bank offers; choose the first offer.
  const { total } = await openPaymentMethods(app, snap, 'AND-30');
  // Bank offers are UAT set-up data; on 11 Oct 2026 none was configured and the panel was not shown.
  if (!(await app.$('android=new UiSelector().text("Use a Bank Offer")').isDisplayed().catch(() => false))) {
    await snap('AND-30: payment methods without a bank offer');
    await cancelUnpaidCheckout(app);
    test.skip(true, 'UAT currently offers no bank offer: the payment list has no "Use a Bank Offer" panel.');
  }
  await openPaymentPanel(app, 'Use a Bank Offer');
  await app.$('id=com.cinescape:id/spinner_card_options').click();
  const offers = await app.$$('id=com.cinescape:id/textView21').map(async (option) => (await option.getText()).trim());
  const offer = offers.find((name) => name && !/available bank offers/i.test(name));
  if (!offer) throw new Error(`No bank offer is available; the list shows: ${offers.join(', ')}`);
  await app.$(`android=new UiSelector().text("${offer}")`).click();
  const cardInput = app.$('id=com.cinescape:id/et_enter_bank_offer_card_number');
  await cardInput.waitForDisplayed({ timeout: 15_000, timeoutMsg: `Choosing "${offer}" did not ask for a card number` });
  const apply = app.$('id=com.cinescape:id/textview_apply_bank_offer');

  // 4. A card that is not eligible is refused.
  await cardInput.setValue('4111111111111111');
  await app.hideKeyboard().catch(() => undefined);
  await apply.click();
  const refusal = await acknowledgeAppMessage(app);
  expect(refusal, 'An ineligible card is refused for the bank offer').toMatch(/not applicable/i);
  expect(await amountToBePaid(app), 'A refused card keeps the full price').toBeCloseTo(total, 3);
  await snap(`AND-30: ineligible card refused - "${refusal}"`);
  if (!eligibleCard) {
    // Nothing was paid; the unpaid checkout is left so its seat hold is released.
    await cancelUnpaidCheckout(app);
    test.skip(true, 'No UAT test credit card eligible for the bank offer is available (set ANDROID_TEST_CARD_NUMBER/EXPIRY/CVV); checked up to the ineligible-card refusal only.');
  }

  // 2. The eligible test card applies the discount and lowers the total; only Credit Card stays payable.
  await cardInput.clearValue();
  const wasRecording = await app.stopRecordingScreen().then(() => true, () => false);
  await cardInput.setValue(eligibleCard);
  await app.hideKeyboard().catch(() => undefined);
  await apply.click();
  const applied = app.$('id=com.cinescape:id/tv_offer_applied_for_n_tickets');
  await applied.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The eligible card did not apply the bank offer' });
  if (wasRecording) await app.startRecordingScreen({ timeLimit: String(androidConfig.videoSeconds), bitRate: '4000000', forceRestart: true });
  const discounted = await amountToBePaid(app);
  expect(discounted, 'The bank offer lowers the amount to pay').toBeLessThan(total);
  expect(discounted, 'The discounted amount is still positive').toBeGreaterThan(0);
  expect(await app.$('id=com.cinescape:id/knet').isEnabled(), 'KNET is not available with a card offer').toBe(false);
  expect(await app.$('id=com.cinescape:id/creditCard').isEnabled(), 'Credit Card stays available').toBe(true);
  await snap(`AND-30: "${offer}" applied (${(await applied.getText()).trim()}) - KWD ${total.toFixed(3)} -> KWD ${discounted.toFixed(3)}`);

  // 3. Pay with the eligible card; the confirmation reflects the discounted charge.
  let bookingId = '';
  let cancelled = false;
  try {
    const formAmount = await (async () => {
      await app.$('id=com.cinescape:id/creditCard').click();
      await app.$('id=com.cinescape:id/txt_proceed').click();
      const amount = app.$('id=com.cinescape:id/kd_to_pay');
      await amount.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'Credit Card did not open the card form' });
      return Number((await amount.getText()).replace(/[^\d.]/g, ''));
    })();
    expect(formAmount, 'The card is charged the discounted amount').toBeCloseTo(discounted, 3);
    bookingId = await payWithCreditCard(app, androidConfig, snap, 'AND-30');
    await snap(`AND-30: bank offer booking ${bookingId} paid KWD ${discounted.toFixed(3)}`);
    await app.back();
    expect(await readWalletBalance(app, 'Wallet balance after card payment'), 'The wallet is not charged').toBeCloseTo(walletBefore, 3);

    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
});
