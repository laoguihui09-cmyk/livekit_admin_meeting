# LiveKit Meeting Admin

Admin is the management console for invite codes, API URL configuration, and chat history.

It should connect to PostgreSQL only. LiveKit token generation belongs to the API service.

## Required environment variables

- `DATABASE_URL`
- `API_SECRET`
- `ADMIN_CONSOLE_USERNAME`
- `ADMIN_CONSOLE_PASSWORD`

## Optional environment variables

- `ADMIN_CONSOLE_JWT_SECRET`
- `PORT`

## Commands

```bash
npm ci
npm run build
npm start
```

## Main routes

- `POST /console/auth/login`
- `GET /console/codes/stats`
- `GET /console/codes`
- `POST /console/codes/create`
- `DELETE /console/codes`
- `GET /console/api-urls`
- `PUT /console/api-urls/main`
- `GET /console/chat/messages`
- `GET /console/chat/rooms`
- `GET /health`
