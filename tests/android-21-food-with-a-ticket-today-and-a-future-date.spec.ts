import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  addFirstCombo,
  beginCaseJourney,
  cancelUnpaidCheckout,
  changeFoodQuantity,
  openArea,
  readFoodCart,
  readKwd,
  selectOneSeat,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

/** Selects one General seat for the first movie and continues past the seat map. */
const bookOneSeat = async (app: AndroidApp, snap: (label: string) => Promise<void>, day: 'today' | 'future') => {
  await openArea(app, 'movies');
  const booking = await selectOneSeat(app, snap, 'AND-21', day);
  await app.$(id('txt_proceed')).click();
  await booking.progress.waitForDisplayed({ reverse: true, timeout: 60_000 });
  const food = app.$(id('text_food_select'));
  const review = app.$(id('textPaymentReview'));
  await app.waitUntil(async () => (await food.isDisplayed().catch(() => false)) || (await review.isDisplayed().catch(() => false)), {
    timeout: 60_000,
    timeoutMsg: 'The chosen seat opened neither the food step nor the payment review',
  });
  return { ...booking, offersFood: await food.isDisplayed().catch(() => false) };
};

/** Reads the payment review: ticket total, food total (0 without food) and the amount to be paid. */
const readReview = async (app: AndroidApp) => {
  await app.$(id('textPaymentReview')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The payment review did not open' });
  const foodTotal = app.$(id('textView119'));
  return {
    tickets: readKwd(await app.$(id('text_kd_total')).getText(), 'Ticket total'),
    food: await foodTotal.isDisplayed().catch(() => false) ? readKwd(await foodTotal.getText(), 'Food total') : 0,
    foodItems: await app.$$(id('text_food_item_names')).map(async (item) => (await item.getText()).trim()),
    toPay: readKwd(await app.$(id('text_time_to_left')).getText(), 'Amount to be paid'),
  };
};

test('AND-21 Food with a ticket (today and a future date)', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-21', 'kiosk');

  // 1. A ticket for today offers food; adding, increasing and decreasing update the cart at once.
  const today = await bookOneSeat(app, snap, 'today');
  expect(today.offersFood, "Today's ticket offers the food step").toBe(true);
  expect((await app.$(id('txtSkipBtn')).getText()).trim()).toBe('Skip');
  const combo = await addFirstCombo(app);
  expect(combo.price).toBeGreaterThan(0);
  await app.$(id('image_cart')).click();
  await app.$(id('title_carts')).waitForDisplayed({ timeout: 15_000, timeoutMsg: 'The food cart did not open' });
  const one = await readFoodCart(app);
  expect(one.quantity).toBe(1);
  expect(one.itemPrice).toBeCloseTo(combo.price, 3);
  const two = await changeFoodQuantity(app, 'increase');
  expect(two.itemPrice, 'Two combos cost twice one').toBeCloseTo(combo.price * 2, 3);
  expect(two.total - one.total, 'The cart total rises by one combo').toBeCloseTo(combo.price, 3);
  const back = await changeFoodQuantity(app, 'decrease');
  expect(back.itemPrice).toBeCloseTo(combo.price, 3);
  expect(back.total).toBeCloseTo(one.total, 3);
  await snap(`AND-21: cart ${combo.name} x1 KWD ${one.total.toFixed(3)}, x2 KWD ${two.total.toFixed(3)}`);

  // 2. The payment review lists the food, and the amount to be paid is tickets + food.
  await app.$(id('proceed_btn1')).click();
  const withFood = await readReview(app);
  expect(withFood.foodItems).toEqual([combo.name]);
  expect(withFood.food).toBeCloseTo(combo.price, 3);
  expect(withFood.toPay, 'Amount to be paid = tickets + food').toBeCloseTo(withFood.tickets + withFood.food, 3);
  if (Math.abs(one.total - withFood.toPay) > 0.0005) {
    test.info().annotations.push({
      type: 'finding',
      description: `The food cart total (KWD ${one.total.toFixed(3)}) differs from the payment review's amount to be paid (KWD ${withFood.toPay.toFixed(3)}) for the same ticket and food.`,
    });
  }
  await snap(`AND-21: review tickets KWD ${withFood.tickets.toFixed(3)} + food KWD ${withFood.food.toFixed(3)} = KWD ${withFood.toPay.toFixed(3)}`);
  await cancelUnpaidCheckout(app);

  // 3. Skipping food leaves only the tickets to pay. (Back from the review cancels the booking, so this is a new one.)
  const skipped = await bookOneSeat(app, snap, 'today');
  expect(skipped.offersFood).toBe(true);
  await app.$(id('txtSkipBtn')).click();
  const ticketsOnly = await readReview(app);
  expect(ticketsOnly.foodItems).toEqual([]);
  expect(ticketsOnly.food).toBe(0);
  expect(ticketsOnly.toPay, 'Without food only the tickets are paid').toBeCloseTo(ticketsOnly.tickets, 3);
  await snap(`AND-21: food skipped, KWD ${ticketsOnly.toPay.toFixed(3)} for tickets only`);
  await cancelUnpaidCheckout(app);

  // 4. A future-date ticket: the app goes straight to the payment review without a food step, matching its
  //    "You can only order food for Today" banner. The workbook expects food here, so this is reported.
  const future = await bookOneSeat(app, snap, 'future');
  await snap(`AND-21: ${future.dateLabel} ticket ${future.offersFood ? 'offers' : 'does not offer'} food`);
  if (!future.offersFood) {
    test.info().annotations.push({
      type: 'finding',
      description: `A ${future.dateLabel} ticket goes straight to the payment review with no food step; the workbook expects food to be available with future tickets.`,
    });
  }
  await cancelUnpaidCheckout(app);
});
