import { test, expect } from '../src/fixtures';
import {
  beginCaseJourney,
  cancelBooking,
  cleanUpBooking,
  hasKioskCustomer,
  openPaymentMethods,
  openUpcomingTicket,
  payWithWallet,
  readTicketDetails,
} from '../src/android-navigation';

test('AND-33 Confirmed ticket matches the choices', async ({ app, snap, androidConfig }) => {
  test.setTimeout(600_000);
  if (!hasKioskCustomer(androidConfig)) {
    throw new Error('AND-33 needs the configured Kiosk UAT customer (username, password and OTP), whose wallet pays for the test booking.');
  }

  // 1. Complete a booking, noting the movie, date, time, category and seat that were chosen.
  await beginCaseJourney(app, androidConfig, snap, 'movies', true, 'AND-33', 'kiosk');
  const { title, seatRow, seatNumber, review } = await openPaymentMethods(app, snap, 'AND-33');
  const chosen = {
    movie: title.trim().toLowerCase(),
    location: review.location,
    dateTime: `${review.date} ${review.time}`,
    screen: review.screen,
    category: 'General',
    seat: `${seatRow}${seatNumber}`,
  };
  expect(review.seats, 'The review screen lists the chosen seat').toContain(chosen.seat);
  let bookingId = '';
  let cancelled = false;
  try {
    bookingId = await payWithWallet(app);

    // 2. The success ticket shows the Booking ID and exactly the choices.
    const expectMatches = async (where: string) => {
      const ticket = await readTicketDetails(app);
      expect(ticket.bookingId, `${where}: Booking ID`).toBe(bookingId);
      expect(ticket.movie.toLowerCase(), `${where}: movie`).toContain(chosen.movie);
      expect(ticket.location, `${where}: location`).toBe(chosen.location);
      expect(ticket.dateTime, `${where}: date and time`).toBe(chosen.dateTime);
      expect(ticket.screen, `${where}: screen`).toBe(chosen.screen);
      expect(ticket.category, `${where}: seat category`).toBe(chosen.category);
      expect(ticket.seats, `${where}: seats`).toEqual([chosen.seat]);
      return ticket;
    };
    await expectMatches('Success ticket');
    await snap(`AND-33: success ticket ${bookingId} matches ${chosen.movie} ${chosen.dateTime} seat ${chosen.seat}`);

    // 3. Upcoming Bookings shows the same booking with its QR code.
    await app.back();
    await openUpcomingTicket(app, bookingId);
    expect((await expectMatches('Upcoming booking')).hasQrCode, 'The booked ticket shows a QR code').toBe(true);
    await snap(`AND-33: upcoming booking ${bookingId} shows the same details and QR code`);

    // 4. Leave and reopen the app; the booking is still listed with the same details.
    await app.back();
    await app.background(3);
    await app.activateApp(androidConfig.appPackage);
    await openUpcomingTicket(app, bookingId);
    await expectMatches('After reopening the app');
    await snap(`AND-33: ${bookingId} unchanged after reopening the app`);

    await cancelBooking(app, bookingId);
    cancelled = true;
  } finally {
    if (bookingId && !cancelled) await cleanUpBooking(app, bookingId);
  }
});
