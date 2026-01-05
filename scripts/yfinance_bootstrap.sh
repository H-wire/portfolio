#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/yfinance_service"
VENV_DIR="$SERVICE_DIR/.venv"

if [ ! -d "$SERVICE_DIR" ]; then
  echo "yfinance_service directory not found." >&2
  exit 1
fi

python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
pip install -r "$SERVICE_DIR/requirements.txt"

echo "yfinance service virtualenv ready in $VENV_DIR"
