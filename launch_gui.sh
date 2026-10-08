#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ -x .venv/bin/python ]; then
    exec .venv/bin/python -m qobuz_dl.gui_app
fi
exec python3 -m qobuz_dl.gui_app
