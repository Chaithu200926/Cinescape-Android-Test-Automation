import { test, expect } from '../src/fixtures';
import {
  addFirstCombo,
  amountToBePaid,
  beginCaseJourney,
  bookingHistory,
  changeFoodQuantity,
  openArea,
  payFoodWithWallet,
  readFoodCart,
  readKwd,
  readWalletBalance,
  startFoodOnlyOrder,
  upcomingFoodOrders,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

test('AND-22 Food-only order without a ticket (Prepare Now)', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  await beginCaseJourney(app, androidConfig, snap, 'food', true, 'AND-22', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet before the food order');

  // 1–3. Food without a movie: choose the cinema and Prepare Now, add an item and check the total.
  await openArea(app, 'food');
  await startFoodOnlyOrder(app, 'Prepare Now');
  const combo = await addFirstCombo(app);
  await app.$(id('image_cart')).click();
  await app.$(id('title_carts')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The food cart did not open' });
  const one = await readFoodCart(app);
  expect(one).toEqual({ quantity: 1, itemPrice: combo.price, total: combo.price });
  const two = await changeFoodQuantity(app, 'increase');
  expect(two.total, 'Two combos cost twice one').toBeCloseTo(combo.price * 2, 3);
  expect((await changeFoodQuantity(app, 'decrease')).total).toBeCloseTo(combo.price, 3);
  await snap(`AND-22: ${combo.name} KWD ${combo.price.toFixed(3)} in the food-only cart`);

  // 4. Pay with the wallet; the confirmation lists the food and is not waiting for "Prepare Food".
  await app.$(id('proceed_btn1')).click();
  await app.$(id('paymentLayout')).waitForDisplayed({ timeout: 45_000, timeoutMsg: 'The food cart did not open the payment methods' });
  expect(await amountToBePaid(app)).toBeCloseTo(combo.price, 3);
  const bookingId = await payFoodWithWallet(app);
  expect((await app.$(id('tvs_item_title')).getText()).trim()).toContain(combo.name.replace(/\s+/g, '').toUpperCase());
  expect(readKwd(await app.$(id('text_kd_total_ticket_price1')).getText(), 'Total food price')).toBeCloseTo(combo.price, 3);
  expect(await app.$(id('btnPreparedFood')).isDisplayed().catch(() => false), 'A Prepare Now order is not held for later').toBe(false);
  await snap(`AND-22: food order ${bookingId} confirmed`);

  // The order is under Upcoming Bookings with its pickup number and status, and the wallet paid for it.
  const walletAfter = await readWalletBalance(app, 'Wallet after the food order');
  expect(walletBefore - walletAfter, 'The wallet paid for the food').toBeCloseTo(combo.price, 3);
  const [latest] = await upcomingFoodOrders(app);
  expect(latest, 'The food order is listed under Upcoming Bookings').toBeTruthy();
  expect(latest.location).toBe('Cinescape 360');
  expect(latest.action, 'A Prepare Now order shows its pickup number and status').toMatch(/^\d+\s*-\s*\S/);
  await snap(`AND-22: upcoming food order ${latest.action}`);

  // 5. The order is in History. (The CMS side is covered by CMS-06.)
  const [newest] = await bookingHistory(app);
  expect(newest.title).toBe('Food Order');
  await snap('AND-22: food order in History');
});
