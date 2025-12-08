# JAMIE App - Start Guide

## 🚀 Quick Start

### 1. Database Setup (PostgreSQL must be running)

```powershell
# Create database
createdb jamie_db

# Initialize schema
psql -U postgres -d jamie_db -f backend/src/config/schema.sql
```

### 2. Start Backend (Terminal 1)

```powershell
cd backend
npm run dev
```

✅ Backend runs on: **http://localhost:5000**

### 3. Start Frontend (Terminal 2)

```powershell
cd frontend
npm run dev
```

✅ Frontend runs on: **http://localhost:3000**

### 4. Test the App

- Open http://localhost:3000 in browser
- Register a new account
- Create groups/clubs
- Join groups
- Send messages in group chats

## 📋 Available Commands

### Backend
- `npm run dev` - Start with auto-reload (nodemon)
- `npm start` - Start production server
- `npm test` - Run tests

### Frontend
- `npm run dev` - Start dev server (Vite)
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## 🔑 Features Ready

✅ User Authentication (Register & Login)
✅ Create Groups & Clubs
✅ Join/Leave Groups
✅ Favorites System
✅ Real-time Chat Messages
✅ User Profiles
✅ Responsive Mobile UI

## 📚 API Endpoints

All endpoints are documented in the README.md

## 🐛 Troubleshooting

**Database Connection Error?**
- Check PostgreSQL is running
- Verify .env variables match your DB config

**Port already in use?**
- Change PORT in backend/.env
- Change port in frontend/vite.config.js

**CORS Error?**
- Backend CORS is configured for frontend
- Make sure ports match (backend 5000, frontend 3000)

## 📝 Next Features to Add

- Profile picture upload
- Real-time WebSocket chat
- Search functionality
- Location-based groups
- Notifications
- Map integration
