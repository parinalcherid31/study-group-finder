require('dns').setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const express = require('express'), mongoose = require('mongoose'), cors = require('cors');
const jwt = require('jsonwebtoken'), bcrypt = require('bcryptjs');

// ---------- Models ----------
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 8, select: false },
  school: String, course: String,
}, { timestamps: true }));

const groupSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 80 },
  subject: { type: String, required: true, trim: true },
  description: { type: String, maxlength: 1000 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxMembers: { type: Number, default: 8, min: 2, max: 50 },
  mode: { type: String, enum: ['online', 'in-person', 'hybrid'], default: 'online' },
  location: String,
  schedule: [{ day: { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] }, startTime: String, endTime: String }],
}, { timestamps: true });
groupSchema.index({ title: 'text', subject: 'text', description: 'text' });
const Group = mongoose.model('Group', groupSchema);

// ---------- Helpers ----------
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const sign = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const auth = wrap(async (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ message: 'Not authorized' });
  try {
    const { id } = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET);
    req.user = await User.findById(id);
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch { res.status(401).json({ message: 'Invalid or expired token' }); }
});

const owned = wrap(async (req, res, next) => {
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Group not found' });
  if (!g.owner.equals(req.user._id)) return res.status(403).json({ message: 'Only the owner can do this' });
  req.group = g; next();
});

const pick = (b) => ({ title: b.title, subject: b.subject, description: b.description,
  maxMembers: b.maxMembers, mode: b.mode, location: b.location, schedule: b.schedule });
  app.get('/', (req, res) => res.json({ message: 'Study Group Finder API is running' }));

// ---------- Auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password, school, course } = req.body;
  if (!name || !email || !password || password.length < 8)
    return res.status(400).json({ message: 'Name, email and a password of 8+ characters are required' });
  if (await User.findOne({ email: email.toLowerCase() })) return res.status(400).json({ message: 'Email already registered' });
  const u = await User.create({ name, email, school, course, password: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: sign(u._id), user: { _id: u._id, name: u.name, email: u.email } });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const u = await User.findOne({ email: (req.body.email || '').toLowerCase() }).select('+password');
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password)))
    return res.status(401).json({ message: 'Incorrect email or password' });
  res.json({ token: sign(u._id), user: { _id: u._id, name: u.name, email: u.email } });
}));

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

// ---------- Groups ----------
app.get('/api/groups', wrap(async (req, res) => {
  const { q, subject, mode, day, page = 1, limit = 9 } = req.query;
  const f = {};
  if (q) f.$text = { $search: q };
  if (subject) f.subject = new RegExp(esc(subject), 'i');
  if (mode) f.mode = mode;
  if (day) f['schedule.day'] = day;
  const groups = await Group.find(f).populate('owner', 'name school').sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(Number(limit));
  const total = await Group.countDocuments(f);
  res.json({ groups, total, pages: Math.ceil(total / limit) });
}));

app.get('/api/groups/mine', auth, wrap(async (req, res) => {
  const id = req.user._id;
  res.json({
    owned: await Group.find({ owner: id }).sort({ createdAt: -1 }),
    joined: await Group.find({ members: id, owner: { $ne: id } }).sort({ createdAt: -1 }),
  });
}));

app.get('/api/groups/:id', wrap(async (req, res) => {
  const g = await Group.findById(req.params.id).populate('owner', 'name school').populate('members', 'name school course');
  if (!g) return res.status(404).json({ message: 'Group not found' });
  res.json(g);
}));

app.post('/api/groups', auth, wrap(async (req, res) => {
  const g = await Group.create({ ...pick(req.body), owner: req.user._id, members: [req.user._id] });
  res.status(201).json(g);
}));

app.put('/api/groups/:id', auth, owned, wrap(async (req, res) => {
  Object.entries(pick(req.body)).forEach(([k, v]) => v !== undefined && (req.group[k] = v));
  await req.group.save();
  res.json(req.group);
}));

app.delete('/api/groups/:id', auth, owned, wrap(async (req, res) => {
  await req.group.deleteOne();
  res.json({ message: 'Group deleted' });
}));

app.post('/api/groups/:id/join', auth, wrap(async (req, res) => {
  // Atomic: blocks duplicates and overfilling even if two people join at once
  const g = await Group.findOneAndUpdate(
    { _id: req.params.id, members: { $ne: req.user._id }, $expr: { $lt: [{ $size: '$members' }, '$maxMembers'] } },
    { $addToSet: { members: req.user._id } }, { new: true });
  if (!g) return res.status(400).json({ message: 'Group is full or you are already a member' });
  res.json(g);
}));

app.post('/api/groups/:id/leave', auth, wrap(async (req, res) => {
  const g = await Group.findById(req.params.id);
  if (!g) return res.status(404).json({ message: 'Group not found' });
  if (g.owner.equals(req.user._id)) return res.status(400).json({ message: 'Owners cannot leave. Delete the group instead.' });
  g.members.pull(req.user._id); await g.save();
  res.json(g);
}));

// ---------- Errors + start ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.name === 'ValidationError' ? 400 : err.status || 500).json({ message: err.message || 'Server error' });
});

mongoose.connect(process.env.MONGO_URI).then(() => {
  app.listen(process.env.PORT || 5000, () => console.log('API running on port', process.env.PORT || 5000));
}).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
