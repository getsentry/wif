# WIF - Express 5 Application

Express 5 application with Slack webhook endpoint built with TypeScript.

## Setup

Install dependencies:

```bash
npm install
```

## Running the Application

### Development mode (with auto-restart)
```bash
npm run dev
```

### Build for production
```bash
npm run build
```

### Production mode
```bash
npm start
```

The server will start on `http://localhost:3000` by default.

## Endpoints

- `POST /api/webhooks/slack` - Slack webhook endpoint (returns 200 OK)
- `GET /health` - Health check endpoint

## Environment Variables

- `PORT` - Server port (default: 3000)

## Project Structure

```
.
├── src/
│   └── index.ts       # Main application file
├── dist/              # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```
