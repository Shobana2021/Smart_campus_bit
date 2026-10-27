
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', err => {
  console.error('Unexpected database error:', err.message);
});

const app = express();
app.use(cors());
app.use(express.json());

const DEV = process.env.DEV_AUTH === 'true';

let fb = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    fb = require('firebase-admin');

    if (!fb.apps.length) {
      fb.initializeApp({
        credential: fb.credential.cert(
          require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT))
        )
      });
    }
  } catch (e) {
    console.warn('Firebase admin not loaded:', e.message);
    fb = null;
  }
}

const PERIODS = [
  '8:45 - 9:35',
  '9:35 - 10:25',
  '10:40 - 11:30',
  '11:30 - 12:10',
  '1:40 - 2:25',
  '2:25 - 3:10',
  '3:25 - 4:20'
];

const list = s =>
  (s || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);

const ADMINS = list(process.env.ADMIN_EMAILS);
const FACULTY = list(process.env.FACULTY_EMAILS);

const roleOf = email =>
  ADMINS.includes(email) ? 'admin' :
  FACULTY.includes(email) ? 'faculty' : 'student';

const wrap = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Server error' });
    }
  });

// India-local calendar date: YYYY-MM-DD
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

const tomorrow = () => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const isSunday = date =>
  new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

const validDateFormat = date =>
  /^\d{4}-\d{2}-\d{2}$/.test(date || '') &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

const fmt = (date, period) =>
  `${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  })}, ${PERIODS[period]}`;

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');

  try {
    let uid, email, name;

    if (DEV && token.startsWith('dev:')) {
      email = token.slice(4).toLowerCase();
      uid = email;
      name = email.split('@')[0];
    } else if (fb) {
      const decoded = await fb.auth().verifyIdToken(token);
      uid = decoded.uid;
      email = (decoded.email || '').toLowerCase();
      name = decoded.name || email.split('@')[0];
    } else {
      return res.status(401).json({
        error: 'Sign-in is not configured on the server'
      });
    }

    if (!email.endsWith('@bitsathy.ac.in')) {
      return res.status(403).json({
        error: 'Use your @bitsathy.ac.in email'
      });
    }

    const role = roleOf(email);

    await pool.query(
      `INSERT INTO users(uid,email,name,role)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(uid)
       DO UPDATE SET name=$3, role=$4`,
      [uid, email, name, role]
    );

    req.user = { uid, email, name, role };
    next();
  } catch (err) {
    console.error('Authentication error:', err.message);
    return res.status(401).json({ error: 'Please sign in again' });
  }
}

const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Not allowed' });

async function notify(uid, title, body) {
  await pool.query(
    'INSERT INTO notifications(user_uid,title,body) VALUES($1,$2,$3)',
    [uid, title, body]
  );

  if (!fb) return;

  const { rows } = await pool.query(
    'SELECT fcm_token FROM users WHERE uid=$1',
    [uid]
  );

  if (rows[0]?.fcm_token) {
    fb.messaging().send({
      token: rows[0].fcm_token,
      notification: { title, body }
    }).catch(err => console.error('Push notification error:', err.message));
  }
}

const api = express.Router();
api.use(auth);

// Current user
api.get('/me', (req, res) => res.json(req.user));

// Campus map and period configuration
api.get('/config', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT code,name,
       ST_Y(geom::geometry) AS lat,
       ST_X(geom::geometry) AS lng
     FROM blocks ORDER BY code`
  );

  res.json({ periods: PERIODS, blocks: rows });
}));

// Save push notification token
api.post('/fcm-token', wrap(async (req, res) => {
  await pool.query(
    'UPDATE users SET fcm_token=$1 WHERE uid=$2',
    [req.body.token, req.user.uid]
  );
  res.json({ ok: true });
}));

// List active facilities
api.get('/facilities', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,block,name,type
     FROM facilities WHERE active
     ORDER BY block NULLS LAST,id`
  );
  res.json(rows);
}));

// Check slots. Only tomorrow can be selected.
api.get('/facilities/:id/slots', wrap(async (req, res) => {
  const date = req.query.date;

  if (!validDateFormat(date)) {
    return res.status(400).json({ error: 'Pick a valid date' });
  }

  if (isSunday(date)) {
    return res.status(400).json({
      error: 'Bookings are closed on Sundays'
    });
  }

  if (date !== tomorrow()) {
    return res.status(400).json({
      error: 'Bookings are allowed for tomorrow only.'
    });
  }

  const facility = await pool.query(
    'SELECT id FROM facilities WHERE id=$1 AND active',
    [req.params.id]
  );

  if (!facility.rows.length) {
    return res.status(404).json({ error: 'Facility not found' });
  }

  const booked = await pool.query(
    `SELECT user_uid,period FROM bookings
     WHERE facility_id=$1 AND booking_date=$2 AND status='booked'`,
    [req.params.id, date]
  );

  const mine = await pool.query(
    `SELECT b.period,f.name
     FROM bookings b
     JOIN facilities f ON f.id=b.facility_id
     WHERE b.user_uid=$1 AND b.booking_date=$2 AND b.status='booked'`,
    [req.user.uid, date]
  );

  res.json(PERIODS.map((label, i) => {
    const taken = booked.rows.find(r => r.period === i);
    const myBooking = mine.rows.find(r => r.period === i);

    if (myBooking) {
      return {
        i, label, state: 'busy',
        note: `You already booked ${myBooking.name}`
      };
    }

    if (taken) {
      return { i, label, state: 'booked' };
    }

    return { i, label, state: 'free' };
  }));
}));

// Create a booking
api.post('/bookings', wrap(async (req, res) => {
  const { facility_id, date, period } = req.body;

  if (
    !validDateFormat(date) ||
    !Number.isInteger(period) ||
    period < 0 ||
    period > 6 ||
    !Number.isInteger(Number(facility_id)) ||
    Number(facility_id) <= 0
  ) {
    return res.status(400).json({ error: 'Invalid booking details' });
  }

  if (isSunday(date)) {
    return res.status(400).json({
      error: 'Bookings are closed on Sundays'
    });
  }

  if (date !== tomorrow()) {
    return res.status(400).json({
      error: 'Bookings are allowed for tomorrow only.'
    });
  }

  const facility = await pool.query(
    'SELECT name FROM facilities WHERE id=$1 AND active',
    [facility_id]
  );

  if (!facility.rows[0]) {
    return res.status(404).json({ error: 'Facility not found' });
  }

  // A student can hold only one active booking per date and period.
  const duplicate = await pool.query(
    `SELECT f.name
     FROM bookings b
     JOIN facilities f ON f.id=b.facility_id
     WHERE b.user_uid=$1
       AND b.booking_date=$2
       AND b.period=$3
       AND b.status='booked'`,
    [req.user.uid, date, period]
  );

  if (duplicate.rows[0]) {
    return res.status(409).json({
      error: `Warning: you already booked ${duplicate.rows[0].name} for this time.`
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO bookings
       (user_uid,facility_id,booking_date,period,qr_token)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,qr_token`,
      [
        req.user.uid,
        facility_id,
        date,
        period,
        crypto.randomBytes(16).toString('hex')
      ]
    );

    try {
      await notify(
        req.user.uid,
        'Booking confirmed',
        `${facility.rows[0].name} booked for ${fmt(date, period)}.`
      );
    } catch (err) {
      console.error('Booking notification failed:', err.message);
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'one_student_slot') {
        return res.status(409).json({
          error: 'You already booked another facility for this time.'
        });
      }

      if (err.constraint === 'one_facility_slot') {
        return res.status(409).json({
          error: 'Someone just booked this slot. Pick another period.'
        });
      }
    }

    throw err;
  }
}));

// Student booking history
api.get('/bookings/mine', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id,b.booking_date::text AS date,b.period,b.status,
       b.qr_token,f.name AS facility,f.block
     FROM bookings b
     JOIN facilities f ON f.id=b.facility_id
     WHERE b.user_uid=$1 AND b.booking_date >= CURRENT_DATE - 7
     ORDER BY b.booking_date DESC,b.period`,
    [req.user.uid]
  );

  res.json(rows);
}));

// Cancel a booking. Cancelled slots can be booked again.
api.delete('/bookings/:id', wrap(async (req, res) => {
  const result = await pool.query(
    `UPDATE bookings b
     SET status='cancelled',cancelled_at=now()
     FROM facilities f
     WHERE f.id=b.facility_id
       AND b.id=$1
       AND b.status='booked'
       AND ($2 OR b.user_uid=$3)
     RETURNING b.user_uid,b.booking_date::text AS date,b.period,f.name`,
    [req.params.id, req.user.role === 'admin', req.user.uid]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  const booking = result.rows[0];

  try {
    await notify(
      booking.user_uid,
      'Booking cancelled',
      `${booking.name} on ${fmt(booking.date, booking.period)} was cancelled.`
    );
  } catch (err) {
    console.error('Cancellation notification failed:', err.message);
  }

  res.json({ ok: true });
}));

// Faculty/admin: verify QR pass
api.get('/verify/:token', need('faculty', 'admin'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.status,b.booking_date::text AS date,b.period,
       f.name AS facility,f.block,u.name AS student,u.email
     FROM bookings b
     JOIN facilities f ON f.id=b.facility_id
     JOIN users u ON u.uid=b.user_uid
     WHERE b.qr_token=$1`,
    [req.params.token]
  );

  const booking = rows[0];

  if (!booking) {
    return res.json({ valid: false, reason: 'No booking found for this code' });
  }

  const reason =
    booking.status !== 'booked' ? 'Booking was cancelled' :
    booking.date !== today() ? `Booking is for ${booking.date}` :
    null;

  res.json({
    valid: !reason,
    reason,
    ...booking,
    time: PERIODS[booking.period]
  });
}));

// Notifications
api.get('/notifications', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id,title,body,read,created_at
     FROM notifications WHERE user_uid=$1
     ORDER BY id DESC LIMIT 30`,
    [req.user.uid]
  );

  res.json(rows);
}));

api.post('/notifications/read', wrap(async (req, res) => {
  await pool.query(
    'UPDATE notifications SET read=true WHERE user_uid=$1',
    [req.user.uid]
  );
  res.json({ ok: true });
}));

// Lost and Found
api.get('/lost', wrap(async (req, res) => {
  const term = `%${req.query.q || ''}%`;

  const { rows } = await pool.query(
    `SELECT l.id,l.type,l.item,l.description,l.location,
       l.report_date::text AS date,u.name AS reporter,u.email,
       (l.user_uid=$2) AS mine
     FROM lost_found l
     JOIN users u ON u.uid=l.user_uid
     WHERE NOT l.resolved
       AND (l.item ILIKE $1 OR l.description ILIKE $1)
     ORDER BY l.id DESC LIMIT 100`,
    [term, req.user.uid]
  );

  res.json(rows);
}));

api.post('/lost', wrap(async (req, res) => {
  const { type, item, description, location, date } = req.body;

  if (!['lost', 'found'].includes(type) || !item || !item.trim()) {
    return res.status(400).json({
      error: 'Add the report type and item name'
    });
  }

  await pool.query(
    `INSERT INTO lost_found
     (user_uid,type,item,description,location,report_date)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      req.user.uid,
      type,
      item.trim(),
      description || null,
      location || null,
      date || today()
    ]
  );

  res.json({ ok: true });
}));

api.post('/lost/:id/resolve', wrap(async (req, res) => {
  const result = await pool.query(
    `UPDATE lost_found SET resolved=true
     WHERE id=$1 AND ($2 OR user_uid=$3)`,
    [req.params.id, req.user.role === 'admin', req.user.uid]
  );

  if (result.rowCount) {
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Report not found' });
  }
}));

// Nexus campus assistant
const FAQ = [
  [/period|timing|time/i,
    'Class periods: ' + PERIODS.join(', ') + '. Breaks and lunch can’t be booked.'],
  [/same time|another block|double|two/i,
    'You can’t hold two bookings in the same period, even in different blocks.'],
  [/cancel/i,
    'Open Bookings and tap Cancel. That slot becomes free for others, and you can book another.'],
  [/qr|pass|verify/i,
    'After booking, open Bookings and tap QR pass. Show it to faculty so they can verify your booking.'],
  [/lost|found|missing|laptop/i,
    'Open Lost & Found. Choose Lost or Found, add the item details and location, then publish the report.'],
  [/map|direction|where/i,
    'Open Facilities and tap Get directions or View on map. Blocks: IB, AS, Mechanical and SF.'],
  [/sunday|holiday/i,
    'Rooms can’t be booked on Sundays.'],
  [/book|room|hall|lab|sport/i,
    'Open Facilities, tap a block, press Book, pick tomorrow’s date and a period. Sundays are closed.']
];

api.post('/nexus', (req, res) => {
  const message = (req.body.message || '').toLowerCase();
  const match = FAQ.find(([regex]) => regex.test(message));

  res.json({
    reply: match
      ? match[1]
      : 'I can help with bookings, QR passes, campus locations, class periods and Lost & Found. Try asking about one of those.'
  });
});

// Admin
const adminOnly = need('admin');

api.get('/admin/stats', adminOnly, wrap(async (req, res) => {
  const count = async sql => Number((await pool.query(sql)).rows[0].n);

  res.json({
    students: await count("SELECT count(*) AS n FROM users WHERE role='student'"),
    bookings: await count("SELECT count(*) AS n FROM bookings WHERE status='booked' AND booking_date>=CURRENT_DATE"),
    facilities: await count('SELECT count(*) AS n FROM facilities WHERE active'),
    lost: await count('SELECT count(*) AS n FROM lost_found WHERE NOT resolved')
  });
}));

api.get('/admin/bookings', adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id,b.booking_date::text AS date,b.period,b.status,
       f.name AS facility,u.name AS student,u.email
     FROM bookings b
     JOIN facilities f ON f.id=b.facility_id
     JOIN users u ON u.uid=b.user_uid
     ORDER BY b.booking_date DESC,b.period LIMIT 200`
  );

  res.json(rows);
}));

api.post('/admin/facilities', adminOnly, wrap(async (req, res) => {
  const { block, name, type } = req.body;

  await pool.query(
    'INSERT INTO facilities(block,name,type) VALUES($1,$2,$3)',
    [block || null, name, type]
  );

  res.json({ ok: true });
}));

api.delete('/admin/facilities/:id', adminOnly, wrap(async (req, res) => {
  await pool.query(
    'UPDATE facilities SET active=false WHERE id=$1',
    [req.params.id]
  );

  res.json({ ok: true });
}));

app.use('/api', api);

// Serve the frontend if it exists at this path
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Smart Campus running on port ${PORT}`);
});
  
