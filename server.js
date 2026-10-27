require('dotenv').config();
const express=require('express'),cors=require('cors'),path=require('path'),crypto=require('crypto');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const app=express();app.use(cors(),express.json());
const DEV=process.env.DEV_AUTH==='true';
let fb=null;
if(process.env.FIREBASE_SERVICE_ACCOUNT){try{fb=require('firebase-admin');fb.initializeApp({credential:fb.credential.cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT)))});}catch(e){console.warn('Firebase admin not loaded:',e.message);fb=null;}}
const PERIODS=['8:45 - 9:35','9:35 - 10:25','10:40 - 11:30','11:30 - 12:10','1:40 - 2:25','2:25 - 3:10','3:25 - 4:20'];
const list=s=>(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
const ADMINS=list(process.env.ADMIN_EMAILS),FACULTY=list(process.env.FACULTY_EMAILS);
const roleOf=e=>ADMINS.includes(e)?'admin':FACULTY.includes(e)?'faculty':'student';
const wrap=f=>(q,s,n)=>Promise.resolve(f(q,s,n)).catch(e=>{console.error(e);s.status(500).json({error:'Server error'});});
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const fmt=(d,p)=>`${new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}, ${PERIODS[p]}`;

async function auth(req,res,next){
  const t=(req.headers.authorization||'').replace('Bearer ','');
  try{
    let uid,email,name;
    if(DEV&&t.startsWith('dev:')){email=t.slice(4).toLowerCase();uid=email;name=email.split('@')[0];}
    else if(fb){const d=await fb.auth().verifyIdToken(t);uid=d.uid;email=(d.email||'').toLowerCase();name=d.name||email.split('@')[0];}
    else return res.status(401).json({error:'Sign-in is not configured on the server'});
    if(!email.endsWith('@bitsathy.ac.in'))return res.status(403).json({error:'Use your @bitsathy.ac.in email'});
    const role=roleOf(email);
    await pool.query('INSERT INTO users(uid,email,name,role) VALUES($1,$2,$3,$4) ON CONFLICT(uid) DO UPDATE SET name=$3,role=$4',[uid,email,name,role]);
    req.user={uid,email,name,role};next();
  }catch(e){res.status(401).json({error:'Please sign in again'});}
}
const need=(...r)=>(q,s,n)=>r.includes(q.user.role)?n():s.status(403).json({error:'Not allowed'});
async function notify(uid,title,body){
  await pool.query('INSERT INTO notifications(user_uid,title,body) VALUES($1,$2,$3)',[uid,title,body]);
  if(!fb)return;
  const {rows}=await pool.query('SELECT fcm_token FROM users WHERE uid=$1',[uid]);
  if(rows[0]&&rows[0].fcm_token)fb.messaging().send({token:rows[0].fcm_token,notification:{title,body}}).catch(()=>{});
}
const api=express.Router();api.use(wrap(auth));

api.get('/me',(q,s)=>s.json(q.user));
api.get('/config',wrap(async(q,s)=>{
  const b=await pool.query('SELECT code,name,ST_Y(geom::geometry) lat,ST_X(geom::geometry) lng FROM blocks ORDER BY code');
  s.json({periods:PERIODS,blocks:b.rows});}));
api.post('/fcm-token',wrap(async(q,s)=>{await pool.query('UPDATE users SET fcm_token=$1 WHERE uid=$2',[q.body.token,q.user.uid]);s.json({ok:true});}));
api.get('/facilities',wrap(async(q,s)=>{
  const {rows}=await pool.query('SELECT id,block,name,type FROM facilities WHERE active ORDER BY block NULLS LAST,id');s.json(rows);}));

api.get('/facilities/:id/slots',wrap(async(q,s)=>{
  const d=q.query.date;if(!/^\d{4}-\d{2}-\d{2}$/.test(d||''))return s.status(400).json({error:'Pick a date'});
  const f=await pool.query("SELECT user_uid,period FROM bookings WHERE facility_id=$1 AND booking_date=$2 AND status='booked'",[q.params.id,d]);
  const m=await pool.query("SELECT b.period,f.name FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.user_uid=$1 AND b.booking_date=$2 AND b.status='booked'",[q.user.uid,d]);
  s.json(PERIODS.map((label,i)=>{
    const taken=f.rows.find(r=>r.period===i),mine=m.rows.find(r=>r.period===i);
    if(taken&&taken.user_uid===q.user.uid)return{i,label,state:'mine'};
    if(taken)return{i,label,state:'booked'};
    if(mine)return{i,label,state:'busy',note:'You already booked '+mine.name};
    return{i,label,state:'free'};}));}));

api.post('/bookings',wrap(async(q,s)=>{
  const {facility_id,date,period}=q.body;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isInteger(period)||period<0||period>6)return s.status(400).json({error:'Invalid booking details'});
  if(new Date(date+'T00:00:00Z').getUTCDay()===0)return s.status(400).json({error:'Bookings are closed on Sundays'});
  if(date<today())return s.status(400).json({error:'You can’t book a past date'});
  const f=await pool.query('SELECT name FROM facilities WHERE id=$1 AND active',[facility_id]);
  if(!f.rows[0])return s.status(404).json({error:'Facility not found'});
  const dup=await pool.query("SELECT f.name FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.user_uid=$1 AND b.booking_date=$2 AND b.period=$3 AND b.status='booked'",[q.user.uid,date,period]);
  if(dup.rows[0])return s.status(409).json({error:`Warning: you already booked ${dup.rows[0].name} for this time.`});
  try{
    const r=await pool.query('INSERT INTO bookings(user_uid,facility_id,booking_date,period,qr_token) VALUES($1,$2,$3,$4,$5) RETURNING id,qr_token',[q.user.uid,facility_id,date,period,crypto.randomBytes(16).toString('hex')]);
    await notify(q.user.uid,'Booking confirmed',`${f.rows[0].name} booked for ${fmt(date,period)}.`);
    s.json(r.rows[0]);
  }catch(e){
    if(e.code==='23505'){
      if(e.constraint==='one_student_slot')return s.status(409).json({error:'Warning: you already booked somewhere else for this time.'});
      return s.status(409).json({error:'Someone just booked this slot. Pick another period.'});}
    throw e;}}));

api.get('/bookings/mine',wrap(async(q,s)=>{
  const {rows}=await pool.query("SELECT b.id,b.booking_date::text date,b.period,b.status,b.qr_token,f.name facility,f.block FROM bookings b JOIN facilities f ON f.id=b.facility_id WHERE b.user_uid=$1 AND b.booking_date>=CURRENT_DATE-7 ORDER BY b.booking_date DESC,b.period",[q.user.uid]);s.json(rows);}));

api.delete('/bookings/:id',wrap(async(q,s)=>{
  const r=await pool.query("UPDATE bookings b SET status='cancelled',cancelled_at=now() FROM facilities f WHERE f.id=b.facility_id AND b.id=$1 AND b.status='booked' AND ($2 OR b.user_uid=$3) RETURNING b.user_uid,b.booking_date::text d,b.period,f.name",[q.params.id,q.user.role==='admin',q.user.uid]);
  if(!r.rows[0])return s.status(404).json({error:'Booking not found'});
  const b=r.rows[0];
  await notify(b.user_uid,'Booking cancelled',`${b.name} on ${fmt(b.d,b.period)} was cancelled.`);
  s.json({ok:true});}));

// Faculty/admin: verify a student's QR
api.get('/verify/:token',need('faculty','admin'),wrap(async(q,s)=>{
  const {rows}=await pool.query("SELECT b.status,b.booking_date::text date,b.period,f.name facility,f.block,u.name student,u.email FROM bookings b JOIN facilities f ON f.id=b.facility_id JOIN users u ON u.uid=b.user_uid WHERE b.qr_token=$1",[q.params.token]);
  const b=rows[0];if(!b)return s.json({valid:false,reason:'No booking found for this code'});
  const reason=b.status!=='booked'?'Booking was cancelled':b.date!==today()?'Booking is for '+b.date:null;
  s.json({valid:!reason,reason,...b,time:PERIODS[b.period]});}));

api.get('/notifications',wrap(async(q,s)=>{
  const {rows}=await pool.query('SELECT id,title,body,read,created_at FROM notifications WHERE user_uid=$1 ORDER BY id DESC LIMIT 30',[q.user.uid]);s.json(rows);}));
api.post('/notifications/read',wrap(async(q,s)=>{await pool.query('UPDATE notifications SET read=true WHERE user_uid=$1',[q.user.uid]);s.json({ok:true});}));

// Lost & Found
api.get('/lost',wrap(async(q,s)=>{
  const t='%'+(q.query.q||'')+'%';
  const {rows}=await pool.query("SELECT l.id,l.type,l.item,l.description,l.location,l.report_date::text date,u.name reporter,u.email,(l.user_uid=$2) mine FROM lost_found l JOIN users u ON u.uid=l.user_uid WHERE NOT l.resolved AND (l.item ILIKE $1 OR l.description ILIKE $1) ORDER BY l.id DESC LIMIT 100",[t,q.user.uid]);s.json(rows);}));
api.post('/lost',wrap(async(q,s)=>{
  const {type,item,description,location,date}=q.body;
  if(!['lost','found'].includes(type)||!item||!item.trim())return s.status(400).json({error:'Add the report type and item name'});
  await pool.query('INSERT INTO lost_found(user_uid,type,item,description,location,report_date) VALUES($1,$2,$3,$4,$5,$6)',[q.user.uid,type,item.trim(),description,location,date||today()]);s.json({ok:true});}));
api.post('/lost/:id/resolve',wrap(async(q,s)=>{
  const r=await pool.query('UPDATE lost_found SET resolved=true WHERE id=$1 AND ($2 OR user_uid=$3)',[q.params.id,q.user.role==='admin',q.user.uid]);
  r.rowCount?s.json({ok:true}):s.status(404).json({error:'Report not found'});}));

// Nexus: campus helper (rule-based; swap in an LLM later)
const FAQ=[
 [/period|timing|time/,'Class periods: '+PERIODS.join(', ')+'. Breaks and lunch can’t be booked.'],
 [/same time|another block|double|two/,'You can’t hold two bookings in the same period, even in different blocks.'],
 [/cancel/,'Open Bookings and tap Cancel. That slot becomes free for others, and you can book another.'],
 [/qr|pass|verify/,'After booking, open Bookings and tap QR pass. Show it to faculty so they can verify your booking.'],
 [/lost|found|missing|laptop/,'Open Lost & Found. Choose Lost or Found, add the item details and location, then publish the report.'],
 [/map|direction|where/,'Open Facilities and tap Get directions or View on map. Blocks: IB, AS, Mechanical and SF.'],
 [/sunday|holiday/,'Rooms can’t be booked on Sundays.'],
 [/book|room|hall|lab|sport/,'Open Facilities, tap a block, press Book, pick a date and a period. You’ll get a notification when it’s confirmed. Sundays are closed.']];
api.post('/nexus',(q,s)=>{const m=(q.body.message||'').toLowerCase();const h=FAQ.find(([r])=>r.test(m));
  s.json({reply:h?h[1]:'I can help with bookings, QR passes, campus locations, class periods and Lost & Found. Try asking about one of those.'});});

// Admin
const adm=need('admin');
api.get('/admin/stats',adm,wrap(async(q,s)=>{
  const c=async x=>+(await pool.query(x)).rows[0].n;
  s.json({students:await c("SELECT count(*) n FROM users WHERE role='student'"),bookings:await c("SELECT count(*) n FROM bookings WHERE status='booked' AND booking_date>=CURRENT_DATE"),facilities:await c('SELECT count(*) n FROM facilities WHERE active'),lost:await c('SELECT count(*) n FROM lost_found WHERE NOT resolved')});}));
api.get('/admin/bookings',adm,wrap(async(q,s)=>{
  const {rows}=await pool.query("SELECT b.id,b.booking_date::text date,b.period,b.status,f.name facility,u.name student,u.email FROM bookings b JOIN facilities f ON f.id=b.facility_id JOIN users u ON u.uid=b.user_uid ORDER BY b.booking_date DESC,b.period LIMIT 200");s.json(rows);}));
api.post('/admin/facilities',adm,wrap(async(q,s)=>{
  const {block,name,type}=q.body;await pool.query('INSERT INTO facilities(block,name,type) VALUES($1,$2,$3)',[block||null,name,type]);s.json({ok:true});}));
api.delete('/admin/facilities/:id',adm,wrap(async(q,s)=>{await pool.query('UPDATE facilities SET active=false WHERE id=$1',[q.params.id]);s.json({ok:true});}));

app.use('/api',api);
app.use(express.static(path.join(__dirname,'../frontend')));
app.listen(process.env.PORT||3000,()=>console.log('Smart Campus running on http://localhost:'+(process.env.PORT||3000)));
