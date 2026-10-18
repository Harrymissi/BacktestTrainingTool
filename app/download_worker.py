"""Run each SDK download in a process with a project-local cache."""
from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile

from server import DB_PATH, to_tq_datetime


def download(params):
    try:
        from tqsdk import TqApi, TqAuth
        import tqsdk.data_series as data_series
    except ImportError as exc:
        raise RuntimeError("未安装 tqsdk，请先运行 pip install -r requirements.txt") from exc

    # The SDK otherwise writes under ~/.tqsdk and retries inaccessible file
    # locks indefinitely. Keep cache alongside the application's own database.
    cache_dir = DB_PATH.parent / "tqsdk-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile(dir=cache_dir):
        pass  # Fail immediately if the cache directory is not writable.
    data_series.CACHE_DIR = str(cache_dir)

    api = TqApi(auth=TqAuth(os.environ["TQ_ACCOUNT"], os.environ["TQ_PASSWORD"]))
    try:
        df = api.get_kline_data_series(
            symbol=params["symbol"], duration_seconds=params["duration"],
            start_dt=to_tq_datetime(params["start"]),
            end_dt=to_tq_datetime(params["end"]),
        )
        return {"rows": json.loads(df.to_json(orient="records"))}
    finally:
        api.close()


def main():
    try:
        params = json.load(sys.stdin)
        # Keep SDK messages out of the JSON protocol on stdout.
        with contextlib.redirect_stdout(sys.stderr):
            result = download(params)
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        return 1
    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
