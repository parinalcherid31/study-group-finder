import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from './api.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const Auth = createContext();
const useAuth = () => useContext(Auth);

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const login = ({ token, user }) => { localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); setUser(user); };
  const logout = () => { localStorage.clear(); setUser(null); };
  return <Auth.Provider value={{ user, login, logout }}>{children}</Auth.Provider>;
}

const Protected = ({ children }) => (useAuth().user ? children : <Navigate to="/login" />);
const Err = ({ msg }) => (msg ? <p className="error" role="alert">{msg}</p> : null);

function Navbar() {
  const { user, logout } = useAuth();
  return (
    <header className="nav">
      <Link to="/" className="brand">Study Group Finder</Link>
      <nav>
        {user ? (<>
          <Link to="/mine">My groups</Link>
          <Link to="/groups/new" className="btn">New group</Link>
          <button className="link" onClick={logout}>Log out ({user.name.split(' ')[0]})</button>
        </>) : (<><Link to="/login">Log in</Link><Link to="/register" className="btn">Sign up</Link></>)}
      </nav>
    </header>
  );
}

function GroupCard({ g }) {
  return (
    <Link to={`/groups/${g._id}`} className="card">
      <span className="tag">{g.subject}</span>
      <h3>{g.title}</h3>
      <p className="muted">{g.mode}{g.location ? ` · ${g.location}` : ''}</p>
      <p>{g.schedule?.map(s => `${s.day} ${s.startTime || ''}`).join(', ') || 'Schedule to be set'}</p>
      <p className="muted">{g.members.length}/{g.maxMembers} members</p>
    </Link>
  );
}

function Groups() {
  const [f, setF] = useState({ q: '', subject: '', mode: '', day: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ groups: [], pages: 1 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page }).toString();
      setLoading(true);
      api('/groups?' + qs).then(setData).catch(e => setError(e.message)).finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [f, page]);

  const set = k => e => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <main>
      <h1>Find people to study with</h1>
      <div className="filters">
        <input placeholder="Search groups" value={f.q} onChange={set('q')} aria-label="Search" />
        <input placeholder="Subject" value={f.subject} onChange={set('subject')} aria-label="Subject" />
        <select value={f.mode} onChange={set('mode')} aria-label="Mode">
          <option value="">Any mode</option><option>online</option><option>in-person</option><option>hybrid</option>
        </select>
        <select value={f.day} onChange={set('day')} aria-label="Day">
          <option value="">Any day</option>{DAYS.map(d => <option key={d}>{d}</option>)}
        </select>
      </div>
      <Err msg={error} />
      {loading ? <p className="muted">Loading groups…</p> : data.groups.length === 0
        ? <p className="muted">No groups match. Try fewer filters, or <Link to="/groups/new">start one</Link>.</p>
        : <div className="grid">{data.groups.map(g => <GroupCard key={g._id} g={g} />)}</div>}
      {data.pages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {data.pages}</span>
          <button disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>)}
    </main>
  );
}

function GroupDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [g, setG] = useState(null);
  const [error, setError] = useState('');
  const load = () => api(`/groups/${id}`).then(setG).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);

  const act = (path, method = 'POST') => async () => {
    if (!user) return nav('/login');
    try { setError(''); await api(`/groups/${id}${path}`, { method }); await load(); } catch (e) { setError(e.message); }
  };
  const remove = async () => {
    if (!confirm('Delete this group for everyone?')) return;
    try { await api(`/groups/${id}`, { method: 'DELETE' }); nav('/mine'); } catch (e) { setError(e.message); }
  };

  if (!g) return <main>{error ? <Err msg={error} /> : <p className="muted">Loading…</p>}</main>;
  const isOwner = user && g.owner._id === user._id;
  const isMember = user && g.members.some(m => m._id === user._id);
  return (
    <main className="detail">
      <span className="tag">{g.subject}</span>
      <h1>{g.title}</h1>
      <p className="muted">Hosted by {g.owner.name}{g.owner.school ? `, ${g.owner.school}` : ''}</p>
      <p>{g.description || 'No description yet.'}</p>
      <h2>When and where</h2>
      <p>{g.mode}{g.location ? ` · ${g.location}` : ''}</p>
      <ul>{g.schedule.map((s, i) => <li key={i}>{s.day} {s.startTime}–{s.endTime}</li>)}</ul>
      <h2>Members ({g.members.length}/{g.maxMembers})</h2>
      <ul>{g.members.map(m => <li key={m._id}>{m.name}{m.course ? `, ${m.course}` : ''}</li>)}</ul>
      <Err msg={error} />
      <div className="actions">
        {isOwner ? (<><Link className="btn" to={`/groups/${id}/edit`}>Edit group</Link><button className="danger" onClick={remove}>Delete group</button></>)
          : isMember ? <button onClick={act('/leave')}>Leave group</button>
          : <button className="btn" onClick={act('/join')} disabled={g.members.length >= g.maxMembers}>
              {g.members.length >= g.maxMembers ? 'Group is full' : 'Join group'}</button>}
      </div>
    </main>
  );
}

function GroupForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState({ title: '', subject: '', description: '', mode: 'online', location: '', maxMembers: 8, schedule: [{ day: 'Mon', startTime: '18:00', endTime: '19:00' }] });
  const [error, setError] = useState('');
  useEffect(() => { if (id) api(`/groups/${id}`).then(g => setF({ ...g })).catch(e => setError(e.message)); }, [id]);

  const set = k => e => setF({ ...f, [k]: e.target.value });
  const setSlot = (i, k, v) => setF({ ...f, schedule: f.schedule.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const submit = async e => {
    e.preventDefault(); setError('');
    try {
      const g = await api(id ? `/groups/${id}` : '/groups', { method: id ? 'PUT' : 'POST', body: { ...f, maxMembers: Number(f.maxMembers) } });
      nav(`/groups/${g._id}`);
    } catch (e) { setError(e.message); }
  };
  return (
    <main className="narrow">
      <h1>{id ? 'Edit group' : 'Start a study group'}</h1>
      <form onSubmit={submit}>
        <label>Title<input required maxLength={80} value={f.title} onChange={set('title')} /></label>
        <label>Subject<input required value={f.subject} onChange={set('subject')} placeholder="e.g. Calculus II" /></label>
        <label>Description<textarea rows={4} maxLength={1000} value={f.description || ''} onChange={set('description')} /></label>
        <div className="row">
          <label>Mode<select value={f.mode} onChange={set('mode')}><option>online</option><option>in-person</option><option>hybrid</option></select></label>
          <label>Max members<input type="number" min={2} max={50} value={f.maxMembers} onChange={set('maxMembers')} /></label>
        </div>
        <label>Location or meeting link<input value={f.location || ''} onChange={set('location')} /></label>
        <fieldset><legend>Schedule</legend>
          {f.schedule.map((s, i) => (
            <div className="row" key={i}>
              <select value={s.day} onChange={e => setSlot(i, 'day', e.target.value)}>{DAYS.map(d => <option key={d}>{d}</option>)}</select>
              <input type="time" value={s.startTime} onChange={e => setSlot(i, 'startTime', e.target.value)} />
              <input type="time" value={s.endTime} onChange={e => setSlot(i, 'endTime', e.target.value)} />
              <button type="button" onClick={() => setF({ ...f, schedule: f.schedule.filter((_, j) => j !== i) })}>Remove</button>
            </div>))}
          <button type="button" onClick={() => setF({ ...f, schedule: [...f.schedule, { day: 'Mon', startTime: '18:00', endTime: '19:00' }] })}>Add a session</button>
        </fieldset>
        <Err msg={error} />
        <button className="btn" type="submit">{id ? 'Save changes' : 'Create group'}</button>
      </form>
    </main>
  );
}

function MyGroups() {
  const [d, setD] = useState({ owned: [], joined: [] });
  const [error, setError] = useState('');
  useEffect(() => { api('/groups/mine').then(setD).catch(e => setError(e.message)); }, []);
  const Section = ({ title, list, empty }) => (<>
    <h2>{title}</h2>
    {list.length ? <div className="grid">{list.map(g => <GroupCard key={g._id} g={g} />)}</div> : <p className="muted">{empty}</p>}
  </>);
  return (
    <main>
      <h1>My groups</h1><Err msg={error} />
      <Section title="Groups I run" list={d.owned} empty="You haven't created a group yet." />
      <Section title="Groups I joined" list={d.joined} empty="You haven't joined any groups yet." />
    </main>
  );
}

function AuthForm({ mode }) {
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', school: '', course: '' });
  const [error, setError] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const submit = async e => {
    e.preventDefault(); setError('');
    try { login(await api(`/auth/${mode}`, { method: 'POST', body: f })); nav('/'); } catch (e) { setError(e.message); }
  };
  const reg = mode === 'register';
  return (
    <main className="narrow">
      <h1>{reg ? 'Create your account' : 'Log in'}</h1>
      <form onSubmit={submit}>
        {reg && <label>Name<input required value={f.name} onChange={set('name')} /></label>}
        <label>Email<input type="email" required value={f.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required minLength={8} value={f.password} onChange={set('password')} /></label>
        {reg && <div className="row"><label>School<input value={f.school} onChange={set('school')} /></label><label>Course<input value={f.course} onChange={set('course')} /></label></div>}
        <Err msg={error} />
        <button className="btn" type="submit">{reg ? 'Sign up' : 'Log in'}</button>
      </form>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Navbar />
      <Routes>
        <Route path="/" element={<Groups />} />
        <Route path="/login" element={<AuthForm mode="login" />} />
        <Route path="/register" element={<AuthForm mode="register" />} />
        <Route path="/groups/new" element={<Protected><GroupForm /></Protected>} />
        <Route path="/groups/:id" element={<GroupDetail />} />
        <Route path="/groups/:id/edit" element={<Protected><GroupForm /></Protected>} />
        <Route path="/mine" element={<Protected><MyGroups /></Protected>} />
        <Route path="*" element={<main><h1>Page not found</h1><Link to="/">Back to groups</Link></main>} />
      </Routes>
    </AuthProvider>
  );
}
