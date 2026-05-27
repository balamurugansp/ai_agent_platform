#!/usr/bin/env bash
set -e

echo "╔══════════════════════════════════════════════════════╗"
echo "║   Yuno AI Agent Orchestration Platform — Setup      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Check .env
if [ ! -f .env ]; then
  if [ -f backend/.env.example ]; then
    cp backend/.env.example .env
    echo "✅ Created .env from example. Please edit it with your OPENAI_API_KEY."
  else
    echo "⚠️  No .env found. Creating minimal one..."
    echo "OPENAI_API_KEY=sk-your-key-here" > .env
    echo "TELEGRAM_BOT_TOKEN=" >> .env
  fi
  echo ""
  echo "👉 REQUIRED: Edit .env and set OPENAI_API_KEY before continuing."
  echo "   Optional: Set TELEGRAM_BOT_TOKEN to enable the Telegram integration."
  echo ""
fi

# Check Docker
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
  echo "🐳 Docker detected. Starting with docker-compose..."
  echo ""
  docker-compose up --build -d
  echo ""
  echo "✅ Platform started!"
  echo ""
  echo "  🌐 Web UI:   http://localhost:3000"
  echo "  🔌 API:      http://localhost:8000"
  echo "  📖 API Docs: http://localhost:8000/docs"
  echo ""
  echo "Run 'docker-compose logs -f' to tail logs."
else
  echo "🐍 Docker not found. Starting in local dev mode..."
  echo ""

  # Backend
  echo "→ Setting up Python backend..."
  cd backend
  python3 -m venv venv 2>/dev/null || true
  source venv/bin/activate
  pip install -q -r requirements.txt
  cp ../.env . 2>/dev/null || true

  echo "→ Starting backend (port 8000)..."
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
  BACKEND_PID=$!
  cd ..

  # Frontend
  echo "→ Setting up frontend..."
  cd frontend
  npm install --silent
  echo "→ Starting frontend dev server (port 5173)..."
  npm run dev &
  FRONTEND_PID=$!
  cd ..

  echo ""
  echo "✅ Platform started in dev mode!"
  echo ""
  echo "  🌐 Web UI:   http://localhost:5173"
  echo "  🔌 API:      http://localhost:8000"
  echo "  📖 API Docs: http://localhost:8000/docs"
  echo ""
  echo "Press Ctrl+C to stop all services."
  wait $BACKEND_PID $FRONTEND_PID
fi
