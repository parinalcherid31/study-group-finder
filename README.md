# Study Group Finder (MERN)

## Run locally
Requires Node 18+ and MongoDB (local or Atlas).

```bash
# Terminal 1: API
cd server && cp .env.example .env   # edit MONGO_URI and JWT_SECRET
npm install && npm run dev

# Terminal 2: client
cd client && cp .env.example .env
npm install && npm run dev          # opens http://localhost:5173
```

## Included
Register/login (JWT + bcrypt), create/edit/delete groups (owner only), search and filter
(text, subject, mode, day), pagination, atomic join/leave with member limits, My Groups.

## Next steps
Socket.io chat, private groups with join requests, profile page, reminders (node-cron).
