#!/usr/bin/env bash
set -eu
cp -a /src/. /work/
sed -i 's/127.0.0.1/postgres/g' worker/tests/conftest.py
pip install -q -e "./worker[dev]" "moto[server]"
python - <<'PY'
from daftar.parsers import register_builtin_parsers
print("parsers", [p.name for p in register_builtin_parsers()])
PY
cd worker
pytest -v --tb=short
