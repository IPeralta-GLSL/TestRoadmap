#!/bin/bash
trap cleanup SIGINT SIGTERM

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo "Deteniendo servicios..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
  echo "Detenido."
  exit 0
}

echo "Iniciando backend..."
cd "$ROOT/backend" && npm run dev &
BACKEND_PID=$!

sleep 2

echo "Iniciando frontend..."
cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend corriendo en http://localhost:3000"
echo "Frontend corriendo en http://localhost:5173"
echo "Presiona Ctrl+C para detener"

wait $BACKEND_PID $FRONTEND_PID
