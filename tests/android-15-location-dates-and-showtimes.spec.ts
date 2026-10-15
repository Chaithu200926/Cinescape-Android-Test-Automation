import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  cancelUnpaidCheckout,
  openFirstMovieDetails,
  readKwd,
  tapElementCenter,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;

const kuwaitMinutesNow = () => {
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date()).split(':').map(Number);
  return hour * 60 + minute;
};

/** Showtimes before 06:00 belong to the previous business day's late shows (e.g. "00:00"). */
const minutesOf = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

/** Reads the open date's showtimes: one group per experience, each with its start times. */
const readShowtimes = async (app: AndroidApp) => {
  const groups = await app.$$(id('card_title'));
  const result: string[][] = [];
  for (const group of groups) {
    result.push(await group.$$(id('text_times')).map(async (time) => (await time.getText()).trim()));
  }
  return result;
};

const chipLabel = async (chip: WebdriverIO.Element) =>
  (await chip.$$('android.widget.TextView').map(async (label) => (await label.getText()).trim())).filter(Boolean).join(' ');

const visibleDates = async (app: AndroidApp) => {
  const dates: { label: string; chip: WebdriverIO.Element }[] = [];
  for (const chip of await app.$$(id('card_day_date'))) {
    const label = await chipLabel(chip);
    if (/^\S+ \d{2}$/.test(label)) dates.push({ label, chip });
  }
  return dates;
};

/** Swipes the sideways-scrolling date strip; "left" reveals later dates. */
const swipeDateStrip = async (app: AndroidApp, direction: 'left' | 'right') => {
  const { y } = await app.$(id('card_day_date')).getLocation();
  await app.execute('mobile: swipeGesture', { left: 60, top: y + 10, width: 960, height: 80, direction, percent: 0.7 });
  await app.pause(600);
};

/** Every date the strip offers, in order, gathered by scrolling it end to end. */
const allDates = async (app: AndroidApp) => {
  for (let swipe = 0; swipe < 12; swipe += 1) await swipeDateStrip(app, 'right');
  const labels: string[] = [];
  for (let page = 0; page < 15; page += 1) {
    const before = labels.length;
    for (const { label } of await visibleDates(app)) if (!labels.includes(label)) labels.push(label);
    if (labels.length === before && page > 0) break;
    await swipeDateStrip(app, 'left');
  }
  for (let swipe = 0; swipe < 12; swipe += 1) await swipeDateStrip(app, 'right');
  return labels;
};

/** The date strip scrolls sideways, so dates are found by label rather than position. */
const chooseDate = async (app: AndroidApp, label: string) => {
  for (const direction of ['right', 'left'] as const) {
    // UAT offers shows a month or more ahead (e.g. Fri 13 Nov seen on 11 Oct), so the strip is long.
    for (let swipe = 0; swipe < 15; swipe += 1) {
      const match = (await visibleDates(app)).find((date) => date.label === label);
      if (match) {
        await tapElementCenter(app, match.chip.$(id('text_date')));
        await app.pause(1_200);
        return;
      }
      await swipeDateStrip(app, direction);
    }
  }
  throw new Error(`The date strip does not offer "${label}".`);
};

/** The chosen date chip is drawn taller than the others. */
const selectedDateLabel = async (app: AndroidApp) => {
  let tallest = { height: 0, label: '' };
  for (const chip of await app.$$(id('card_day_date'))) {
    const { height } = await chip.getSize();
    if (height > tallest.height) tallest = { height, label: await chipLabel(chip) };
  }
  return tallest.label;
};

test('AND-15 Location, dates and showtimes', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-15', 'kiosk');

  // 1–2. The movie opens at Cinescape 360 with today and future dates.
  const { title } = await openFirstMovieDetails(app);
  expect((await app.$(id('cinemaName')).getText()).trim()).toBe('Cinescape 360');
  expect((await app.$(id('textView110')).getText()).trim()).toBe('360 Mall, Zahra');
  const dateLabels = await allDates(app);
  expect(dateLabels.length, 'Today and at least one future date are offered').toBeGreaterThan(1);
  expect(dateLabels[0]).toMatch(/^Today \d{2}$/);
  expect(new Set(dateLabels).size, 'Every date is listed once').toBe(dateLabels.length);
  await snap(`AND-15: ${title} dates ${dateLabels.join(', ')}`);

  // 3. Changing the date highlights it and lists that date's showtimes, grouped by experience.
  const schedule: Record<string, string[][]> = {};
  for (const date of dateLabels) {
    await chooseDate(app, date);
    expect(await selectedDateLabel(app), `${date} is highlighted once chosen`).toBe(date);
    const groups = await readShowtimes(app);
    schedule[date] = groups;
    for (const times of groups) {
      expect(times.length, `${date}: every experience lists showtimes`).toBeGreaterThan(0);
      for (const time of times) expect(time, date).toMatch(/^\d{2}:\d{2}$/);
    }
  }
  test.info().annotations.push({
    type: 'schedule',
    description: Object.entries(schedule).map(([date, groups]) => `${date}: ${groups.map((times) => times.join(' ')).join(' | ') || 'none'}`).join('; '),
  });
  const futureDates = dateLabels.slice(1).filter((date) => schedule[date].length > 0);
  expect(futureDates.length, 'At least one future date has showtimes').toBeGreaterThan(0);

  // 4. Today's shows that have already started are not offered.
  const now = kuwaitMinutesNow();
  const startedToday = schedule[dateLabels[0]].flat()
    .filter((time) => minutesOf(time) >= 6 * 60 && minutesOf(time) < now);
  expect(startedToday, 'Showtimes that have already started today are not offered').toEqual([]);
  await snap(`AND-15: ${Object.values(schedule).flat(2).length} showtimes across ${dateLabels.length} dates`);

  // 5. A showtime offers the seat categories, and checkout prices the chosen seat.
  await chooseDate(app, futureDates[0]);
  const showtime = (await app.$$(id('card_scroll')))[0];
  const showtimeLabel = (await showtime.$(id('text_times')).getText()).trim();
  await tapElementCenter(app, showtime);
  await app.$(id('select_seat_category')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'The showtime did not open seat categories' });
  const categories = await app.$$(id('tv_seat_selectiopn')).map(async (name) => (await name.getText()).trim());
  expect(categories).toEqual(['Family', 'General']);
  await snap(`AND-15: ${futureDates[0]} ${showtimeLabel} offers ${categories.join(' and ')}`);

  await app.$('android=new UiSelector().text("General")').click();
  await app.$(id('text_proceeds')).click();
  const progress = app.$(id('progress'));
  await app.$(id('seat_table')).waitForDisplayed({ timeout: 60_000, timeoutMsg: 'General did not open the seat map' });
  await progress.waitForDisplayed({ reverse: true, timeout: 60_000 });
  expect((await app.$(id('tv_seat_timing_date')).getText()).trim()).toContain(showtimeLabel);
  expect((await app.$(id('text_type')).getText()).trim()).toMatch(/^General\s*\|/);
  const seat = await (async () => {
    for (const cell of await app.$(id('seat_table')).$$('android.widget.TextView')) {
      if (/^\d+$/.test((await cell.getText()).trim()) && await cell.isEnabled()) return cell;
    }
    throw new Error('The seat map has no available seat.');
  })();
  const location = await seat.getLocation();
  const size = await seat.getSize();
  await app.execute('mobile: clickGesture', { x: Math.round(location.x + size.width / 2), y: Math.round(location.y + size.height / 2) });
  await app.$(id('txt_proceed')).click();
  const ticketPrice = app.$(id('text_kds'));
  await ticketPrice.waitForDisplayed({ timeout: 60_000, timeoutMsg: 'The chosen seat did not open the payment review' });
  const price = readKwd(await ticketPrice.getText(), 'Ticket price');
  const quantity = Number((await app.$(id('text_qty_number')).getText()).trim());
  const total = readKwd(await app.$(id('text_kd_total')).getText(), 'Ticket total');
  expect(price, 'The General ticket has a price').toBeGreaterThan(0);
  expect(quantity).toBe(1);
  expect(total, 'Total = price × quantity').toBeCloseTo(price * quantity, 3);
  expect((await app.$(id('textView19')).getText()).trim()).toBe(showtimeLabel);
  await snap(`AND-15: General ticket KWD ${price.toFixed(3)} for ${futureDates[0]} ${showtimeLabel}`);
  test.info().annotations.push({ type: 'scope', description: 'Comparison with the website schedule and prices is left to the Web UI suite.' });

  await cancelUnpaidCheckout(app);
});
