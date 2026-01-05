# Portfolio Management App

This is a multi-user, multi-tenant (org/team) web app for managing investment portfolios with a focus on buy-and-hold strategies. It features daily price updates, performance analysis, a strategy-based signal engine, and LLM-powered insights.

## Getting Started

Follow these steps to get the full application running in a local development environment.

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- [Docker](https://www.docker.com/get-started/)
- [Python](https://www.python.org/downloads/) (v3.10 or later)

### 2. Initial Setup
First, create a `.env` file from the example template. This will hold your database credentials and other secrets.

```bash
cp .env.example .env
```
Review the `.env` file and change the default passwords if desired.

### 3. Install Dependencies
Install the required Node.js packages for the backend and frontend, and set up the Python environment for the `yfinance` service.

```bash
# Install backend and frontend dependencies
npm install

# Set up and bootstrap the yfinance Python service
npm run yfinance:bootstrap
```

### 4. Run the Application
This command starts the Postgres database in Docker, the Node.js backend, the React frontend, and the Python `yfinance` service concurrently.

```bash
npm run dev:all
```
Your services should now be available:
- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://localhost:3000`
- **Yfinance Service**: `http://localhost:8001`

### 5. Database Migrations & Seeding
To set up the database schema and add initial test data (like a default organization and user), run these scripts in a separate terminal:

```bash
# Apply all database migrations
npm run db:migrate

# Seed the database with an initial org and user
npm run db:seed
```

## Project Structure

This repository is a monorepo containing several key components:

```
/
├── .ai/                    <-- Internal state and logs for AI agents.
├── frontend/               <-- The React/Vite frontend application.
├── src/                    <-- The Node.js/Express backend API.
├── yfinance_service/       <-- A Python/FastAPI microservice for fetching market data.
├── migrations/             <-- SQL database migration files.
├── scripts/                <-- Helper scripts for tasks like migrations and seeding.
│
├── README.md               <-- This file: Project overview and setup guide.
├── TASKS.md                <-- The single source of truth for all project tasks and bugs.
├── AGENTS.md               <-- Rules and protocols for the AI agents working on this codebase.
└── ARCHITECTURE.md         <-- Detailed technical documentation (data models, APIs, etc.).
```

## Key Documentation

- **[TASKS.md](TASKS.md)**: View the project backlog, current priorities, and reported bugs. This is the main task board.
- **[ARCHITECTURE.md](ARCHITECTURE.md)**: Read the detailed technical specifications, including the data model, API design, and system architecture.
- **[AGENTS.md](AGENTS.md)**: Understand the rules and protocols that govern the AI agents contributing to this project.