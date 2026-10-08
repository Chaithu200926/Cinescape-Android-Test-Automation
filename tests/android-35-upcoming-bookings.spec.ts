import { test, expect } from '../src/fixtures';
import {
  type AndroidApp,
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openAccountTop,
  openPaymentMethods,
  openUpcomingTicket,
  payWithWallet,
  readTicketDetails,
} from '../src/android-navigation';

const id = (name: string) => `id=com.cinescape:id/${name}`;
type UpcomingCard = { movie: string; location: string; screen: string; date: string; time: string };

/** Scrolls Your Upcoming Bookings until a card for the given movie, date and time is on screen and returns it. */
const findUpcomingCard = async (app: AndroidApp, wanted: Pick<UpcomingCard, 'movie' | 'date' | 'time'>) => {
  const seen: UpcomingCard[] = [];
  let previous = '';
  for (let page = 0; page < 20; page += 1) {
    const cards = await app.$$('//android.widget.GridView[@resource-id="com.cinescape:id/recyclerview_booking"]/*');
    for (const card of cards) {
      const read = async (name: string) => (await card.$(id(name)).getText().catch(() => '')).trim();
      const entry = {
        movie: await read('text_name_movie'),
        location: await read('text_location_names'),
        screen: await read('tv_no_of_screen'),
        date: await read('txt_date'),
        time: await read('text_times2'),
      };
      if (!entry.movie || !entry.time) continue;
      seen.push(entry);
      if (entry.movie === wanted.movie && entry.date === wanted.date && entry.time === wanted.time) return { entry, seen };
    }
    const signature = seen.map((card) => `${card.movie}${card.date}${card.time}`).join('|');
    if (signature === previous) break;
    previous = signature;
    await app.execute('mobile: swipeGesture', { left: 80, top: 1300, width: 920, height: 900, direction: 'up', percent: 0.6 });
    await app.pause(1_000);
  }
  return { entry: undefined, seen };
};

test('AND-35 Upcoming bookings', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-35 needs the configured Kiosk UAT customer, whose wallet pays for the booking that is listed and then cancelled.');
  }

  // A booking made in this run guarantees an upcoming booking whose details are known.
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-35', 'kiosk');
  const { review, seatRow, seatNumber } = await openPaymentMethods(app, snap, 'AND-35');
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);
    await snap(`AND-35: ${review.movie} booked as ${bookingId}`);

    // 1–2. Account > Bookings lists the booking with its movie, location, screen, date and time.
    await openAccountTop(app);
    await app.$(id('view_booking')).click();
    await app.$(id('text_upcoming_booking')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Bookings did not open Your Upcoming Bookings' });
    await app.$(id('recyclerview_booking')).waitForDisplayed({ timeout: 30_000, timeoutMsg: 'Your Upcoming Bookings listed no bookings' });
    const { entry: card, seen } = await findUpcomingCard(app, review);
    expect(card, `Upcoming Bookings lists ${review.movie} on ${review.date} at ${review.time} (listed: ${
      seen.map((item) => `${item.movie} ${item.date} ${item.time}`).join('; ')})`).toBeDefined();
    expect(card?.location).toBe(review.location);
    expect(card?.screen).toBe(review.screen);
    await snap(`AND-35: upcoming card for ${review.movie} ${review.date} ${review.time}`);

    // 3. Opening it shows the ticket: Booking ID, details, seat and QR code.
    await openUpcomingTicket(app, bookingId);
    const ticket = await readTicketDetails(app);
    expect(ticket.bookingId).toBe(bookingId);
    expect(ticket.movie.trim()).toBe(review.movie);
    expect(ticket.location).toBe(review.location);
    expect(ticket.dateTime).toBe(`${review.date} ${review.time}`);
    expect(ticket.screen).toBe(review.screen);
    expect(ticket.category).toBe('General');
    expect(ticket.seats).toEqual([`${seatRow}${seatNumber}`]);
    expect(ticket.hasQrCode, 'The upcoming ticket shows its QR code').toBe(true);
    await snap(`AND-35: ticket ${bookingId} — seat ${ticket.seats.join(', ')} with QR code`);
    test.info().annotations.push({
      type: 'scope',
      description: 'Step 4 (the same booking listed on the website) is covered by the Web UI suite, not this Android run.',
    });

    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
});
