import { test, expect } from '../src/fixtures';
import {
  openArea,
  openSingleSeatCheckout,
  registerFreshTestAccount,
} from '../src/android-navigation';

const readKwd = (text: string, label: string) => {
  const match = /(?:KWD|KD)?\s*([\d,]+(?:\.\d{1,3})?)/i.exec(text);
  // A newly registered account renders the "Wallet Balance:" label without a number for KWD 0.000.
  if (!match && /wallet balance\s*:?\s*$/i.test(text)) return 0;
  if (!match) throw new Error(`${label} did not contain a readable KWD amount: ${text}`);
  return Number(match[1].replace(/,/g, ''));
};

test('AND-51 Wallet payment with insufficient balance', async ({ app, snap, androidConfig }) => {
  test.setTimeout(300_000);
  // Generate a fresh account for every run so its wallet starts empty.
  await registerFreshTestAccount(app, androidConfig);
  await openArea(app, 'account');
  const balanceElement = app.$('id=com.cinescape:id/text_user_wallet_kd');
  await balanceElement.waitForDisplayed({ timeout: 20_000, timeoutMsg: 'The signed-in account did not show its wallet balance' });
  const balanceBeforeText = (await balanceElement.getText()).trim();
  const balanceBefore = readKwd(balanceBeforeText, 'Wallet balance before booking');
  await snap('AND-51: insufficient-balance test account wallet balance');

  await openArea(app, 'movies');
  const { title, dateLabel, seatNumber, checkout, paymentList } = await openSingleSeatCheckout(app, snap, 'AND-51');
  const totalElement = app.$('id=com.cinescape:id/text_kd_total');
  await totalElement.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Ticket checkout did not show the amount due' });
  const totalText = (await totalElement.getText()).trim();
  const total = readKwd(totalText, 'Booking total');
  expect(total, `The selected booking for ${title} should have a positive total`).toBeGreaterThan(0);
  expect(balanceBefore, 'The fresh UAT account should start with an empty or insufficient wallet')
    .toBeLessThan(total);

  // Ticket checkout is a review screen; Proceed opens the payment-method list without charging.
  if (!(await paymentList.isDisplayed().catch(() => false))) {
    const continueToMethods = app.$('id=com.cinescape:id/txt_proceed');
    await continueToMethods.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'Ticket review did not offer Proceed to payment methods' });
    await continueToMethods.click();
    await paymentList.waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Proceed did not open the payment-method list' });
  }

  const oldWalletChoice = app.$('id=com.cinescape:id/viewWallet');
  const newWalletChoice = app.$('android=new UiSelector().textContains("Use your Wallet")');
  const walletChoice = (await oldWalletChoice.isDisplayed().catch(() => false)) ? oldWalletChoice : newWalletChoice;
  await walletChoice.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Checkout did not offer wallet payment' });
  await walletChoice.click();

  const walletBalanceOnCheckout = app.$('id=com.cinescape:id/textWalletKd');
  if (await walletBalanceOnCheckout.isDisplayed().catch(() => false)) {
    expect(
      readKwd(await walletBalanceOnCheckout.getText(), 'Checkout wallet balance'),
      'Checkout should show the same low balance as the account screen',
    ).toBeCloseTo(balanceBefore, 3);
  }

  const newApply = app.$('id=com.cinescape:id/textview_bt_wallet_apply');
  const oldContinue = app.$('id=com.cinescape:id/txt_proceed');
  const paymentAction = (await newApply.isDisplayed().catch(() => false)) ? newApply : oldContinue;
  await paymentAction.waitForDisplayed({ timeout: 15_000, timeoutMsg: 'Wallet selection did not expose Apply/Proceed' });
  const wasDisabled = !(await paymentAction.isEnabled());
  if (!wasDisabled) await paymentAction.click();

  const subtitle = app.$('id=com.cinescape:id/subtitle');
  await app.waitUntil(async () => {
    const subtitleText = (await subtitle.getText().catch(() => '')).trim();
    const source = await app.getPageSource();
    return wasDisabled
      || /insufficient|not enough|low wallet|another payment/i.test(subtitleText)
      || /insufficient wallet|not enough.*balance|another payment method/i.test(source);
  }, {
    timeout: 15_000,
    timeoutMsg: 'The app neither blocked the low-balance wallet nor explained that another payment method is needed',
  });

  const afterAttemptSource = await app.getPageSource();
  expect(afterAttemptSource, 'The insufficient-balance attempt must not open booking confirmation')
    .not.toContain('com.cinescape:id/text_booking_success');
  expect(afterAttemptSource, 'No paid booking status should be shown')
    .not.toContain('com.cinescape:id/paymentStatus');
  if (wasDisabled) {
    expect(await paymentAction.isEnabled(), 'Apply/Proceed remains disabled for the empty wallet').toBe(false);
  } else {
    await subtitle.waitForDisplayed({ timeout: 10_000, timeoutMsg: 'The wallet attempt did not explain why payment was blocked' });
    expect((await subtitle.getText()).trim(), 'The app explains the insufficient wallet balance')
      .toMatch(/insufficient|not enough|another payment/i);
    const acknowledge = app.$('id=com.cinescape:id/positive_btn');
    if (await acknowledge.isDisplayed().catch(() => false)) await acknowledge.click();
  }
  const afterAttemptTotal = (await totalElement.getText().catch(() => '')).trim();
  if (afterAttemptTotal) expect(readKwd(afterAttemptTotal, 'Amount after wallet attempt')).toBeCloseTo(total, 3);
  await snap(`AND-51: low wallet blocked for ${dateLabel}, seat ${seatNumber}`);

  // Cancel the unpaid checkout and verify the account balance was not debited.
  const cancel = app.$('id=com.cinescape:id/text_cancel');
  if (await cancel.isDisplayed().catch(() => false)) {
    await cancel.click();
    const confirm = app.$('id=com.cinescape:id/txtSureNew');
    if (await confirm.isDisplayed().catch(() => false)) await confirm.click();
  } else {
    await app.back();
  }
  await openArea(app, 'account');
  await balanceElement.waitForDisplayed({ timeout: 20_000, timeoutMsg: 'The account wallet balance was not available after cancelling' });
  expect(
    readKwd(await balanceElement.getText(), 'Wallet balance after cancelling'),
    'The wallet balance must remain unchanged after insufficient funds',
  ).toBeCloseTo(balanceBefore, 3);
});
