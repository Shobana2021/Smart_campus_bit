CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS users(uid TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT,role TEXT NOT NULL DEFAULT 'student',fcm_token TEXT,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS blocks(code TEXT PRIMARY KEY,name TEXT NOT NULL,geom GEOGRAPHY(Point,4326) NOT NULL);
CREATE TABLE IF NOT EXISTS facilities(id SERIAL PRIMARY KEY,block TEXT REFERENCES blocks(code),name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('classroom','seminar','lab','sports')),active BOOLEAN DEFAULT true,UNIQUE(block,name));
CREATE TABLE IF NOT EXISTS bookings(id SERIAL PRIMARY KEY,user_uid TEXT NOT NULL REFERENCES users(uid),facility_id INT NOT NULL REFERENCES facilities(id),booking_date DATE NOT NULL,period INT NOT NULL CHECK(period BETWEEN 0 AND 6),status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN('booked','cancelled')),qr_token TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ DEFAULT now(),cancelled_at TIMESTAMPTZ);
-- Race-proof rules (enforced by PostgreSQL even for simultaneous requests):
-- 1) a facility can have only one active booking per date+period
CREATE UNIQUE INDEX IF NOT EXISTS one_facility_slot ON bookings(facility_id,booking_date,period) WHERE status='booked';
-- 2) a student can have only one active booking per date+period (any block)
CREATE UNIQUE INDEX IF NOT EXISTS one_student_slot ON bookings(user_uid,booking_date,period) WHERE status='booked';
CREATE TABLE IF NOT EXISTS lost_found(id SERIAL PRIMARY KEY,user_uid TEXT REFERENCES users(uid),type TEXT CHECK(type IN('lost','found')),item TEXT NOT NULL,description TEXT,location TEXT,report_date DATE,resolved BOOLEAN DEFAULT false,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_uid TEXT REFERENCES users(uid),title TEXT,body TEXT,read BOOLEAN DEFAULT false,created_at TIMESTAMPTZ DEFAULT now());
