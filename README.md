# WIF - Express 5 Application

Express 5 application with Slack webhook endpoint built with TypeScript.

## Setup

Install dependencies:

```bash
pnpm install
```

## Running the Application

### Development mode (with auto-restart)
```bash
pnpm dev
```

### Build for production
```bash
pnpm build
```

### Production mode
```bash
pnpm start
```

The server will start on `http://localhost:3000` by default.

## Docker

### Build Docker image
```bash
docker build -t wif-app .
```

### Run Docker container
```bash
docker run -p 3000:3000 wif-app
```

### Run with custom port
```bash
docker run -p 8080:8080 -e PORT=8080 wif-app
```

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
