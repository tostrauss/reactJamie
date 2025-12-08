# JAMIE - Social Activity App

A modern full-stack application for discovering and creating groups/clubs for social activities.
help people meet others and participate in group activities. The app particularly targets people who have recently moved to new cities or want to expand their social circles. Jamie features two main social structures: groups (3-10 people with specific dates/times) and clubs (larger, permanent communities). This follows tobi's previous experience building CollegeRecruit, a sports recruiting app based on Tinder's concept. The goal is to create a professional, production-ready mobile application that facilitates real-world social connections through organized activities.
React, newest frameworks and best, easy smooth code and styling. Use all capaciteies but go after a plan but do not exceed limits!!
The development approach emphasizes creating a complete, professional application rather than prototyping. Tobi values systematic, thorough implementation - requesting that every file be reviewed and delivered as 100% correct, production-ready code. The focus is on modern development practices including Angular signals, standalone components, and mobile-first responsive design. The app's design system is carefully planned with specific brand colors (primary coral/orange #FD7666, dark purple backgrounds #1c1c2e/#242340) and user experience requirements that match provided Adobe XD designs.



## Project Structure

```
jamie/
├── backend/
│   ├── src/
│   │   ├── config/        # Database & config
│   │   ├── controllers/   # Business logic
│   │   ├── middleware/    # Auth & validators
│   │   ├── routes/        # API routes
│   │   └── server.js      # Express server
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── components/    # React components
    │   ├── context/       # Context providers
    │   ├── pages/         # Page components
    │   ├── styles/        # CSS files
    │   ├── utils/         # API client
    │   ├── App.jsx        # Main app
    │   └── main.jsx       # Entry point
    ├── index.html
    ├── vite.config.js
    └── package.json
```

## Features

- **User Authentication** - Register & login with JWT
- **Groups & Clubs** - Create and discover social groups
- **Group Management** - Join, leave, and favorite groups
- **Real-time Chat** - Message in group chats
- **User Profiles** - Manage your profile
- **Responsive UI** - Works on mobile and desktop

## Tech Stack

### Backend
- Node.js + Express
- PostgreSQL
- JWT Authentication
- bcrypt for password hashing

### Frontend
- React 18
- React Router
- Axios for API calls
- Vite as bundler
- CSS3 with gradient styling

## Setup Instructions

### Prerequisites
- Node.js (v16+)
- PostgreSQL (v12+)
- npm or yarn

### Backend Setup

1. Navigate to backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file (copy from `.env.example`):
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jamie_db
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=your_jwt_secret_key_here
PORT=5000
NODE_ENV=development
```

4. Create PostgreSQL database:
```bash
createdb jamie_db
```

5. Run SQL schema:
```bash
psql -U postgres -d jamie_db -f src/config/schema.sql
```

6. Start the server:
```bash
npm run dev
```

### Frontend Setup

1. Navigate to frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm run dev
```

4. Open http://localhost:3000 in your browser

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get user profile (auth required)
- `PUT /api/auth/profile` - Update user profile (auth required)

### Groups
- `GET /api/groups` - Get all groups (with optional type filter)
- `GET /api/groups/:id` - Get group by ID
- `POST /api/groups` - Create new group (auth required)
- `POST /api/groups/:id/join` - Join group (auth required)
- `POST /api/groups/:id/leave` - Leave group (auth required)
- `POST /api/groups/:id/favorite` - Toggle favorite (auth required)
- `GET /api/groups/user/favorites` - Get user's favorites (auth required)
- `GET /api/groups/user/joined` - Get user's joined groups (auth required)

### Messages
- `POST /api/messages` - Send message (auth required)
- `GET /api/messages/:groupId` - Get group messages
- `DELETE /api/messages/:messageId` - Delete message (auth required)

## Development Notes

- Backend runs on port 5000
- Frontend runs on port 3000
- Frontend proxy configured to /api routes to backend
- JWT tokens stored in localStorage
- CORS enabled for development

## License

ISC
