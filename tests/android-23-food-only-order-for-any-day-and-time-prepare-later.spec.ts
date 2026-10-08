import { test, expect } from '../src/fixtures';
import {
  addFirstCombo,
  amountToBePaid,
  beginCaseJourney,
  bookingHistory,
  openArea,
  payFoodWithWallet,
  readKwd,
  findHeldFoodOrder,
  prepareHeldFood,
  readWalletBalance,
  startFoodOnlyOrder,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

const kuwaitDate = () => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuwait', day: '2-digit', month: 'short', year: 'numeric',
}).format(new Date());

test('AND-23 Food-only order for any day and time (Prepare Later)', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  await beginCaseJourney(app, androidConfig, snap, 'food', true, 'AND-23', 'kiosk');
  const walletBefore = await readWalletBalance(app, 'Wallet before the food order');

  // 1–3. Food without a ticket, Prepare Later. The app offers no pickup date/time: food is for today only
  //      and is prepared when the customer taps "Prepare Food" on the order.
  await openArea(app, 'food');
  expect((await app.$(id('textView187')).getText()).trim()).toBe('You can only order food for Today');
  await startFoodOnlyOrder(app, 'Prepare Later');
  test.info().annotations.push({
    type: 'finding',
    description: 'No pickup day/time can be chosen (workbook steps 3–6): food is today-only and a Prepare Later order is prepared on "Prepare Food".',
  });
  const combo = await addFirstCombo(app);
  await app.$(id('image_cart')).click();
  await app.$(id('proceed_btn1')).click();
  await app.$(id('paymentLayout')).waitForDisplayed({ timeout: 45_000, timeoutMsg: 'The food cart did not open the payment methods' });
  expect(await amountToBePaid(app)).toBeCloseTo(combo.price, 3);

  // 4–5. Pay with the wallet; the confirmation holds the order with a "Prepare Food" button.
  const bookingId = await payFoodWithWallet(app);
  expect(readKwd(await app.$(id('text_kd_total_ticket_price1')).getText(), 'Total food price')).toBeCloseTo(combo.price, 3);
  expect((await app.$(id('btnPreparedFood')).getText()).trim()).toBe('Prepare Food');
  await snap(`AND-23: food order ${bookingId} held for later`);

  const walletAfter = await readWalletBalance(app, 'Wallet after the food order');
  expect(walletBefore - walletAfter, 'The wallet paid for the food').toBeCloseTo(combo.price, 3);
  const held = await findHeldFoodOrder(app);
  expect(held, 'The held order is listed under Upcoming Bookings with Prepare Food').toBeTruthy();
  expect(held!.location).toBe('Cinescape 360');
  expect(held!.date, 'The order is for today').toBe(kuwaitDate());
  await snap('AND-23: held order under Upcoming Bookings');

  // 6. "Prepare Food" asks for confirmation, then the order joins the preparation queue with a pickup number.
  const { question, status } = await prepareHeldFood(app, held!.button);
  expect(question).toMatch(/your order will be prepared now/i);
  expect(status).toMatch(/^\d+\s*-\s*In Queue$/i);
  await snap(`AND-23: order ${status}`);

  // Any other order still held (e.g. from an interrupted run) is released too, so none is left waiting.
  for (let extra = 0; extra < 3; extra += 1) {
    const leftover = await findHeldFoodOrder(app);
    if (!leftover) break;
    await prepareHeldFood(app, leftover.button);
  }

  const [newest] = await bookingHistory(app);
  expect(newest.title).toBe('Food Order');
});
