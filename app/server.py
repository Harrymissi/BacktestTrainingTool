from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlparse

from instruments import CONTRACT_TYPES, INSTRUMENTS, TIMEFRAMES, get_instrument, tq_symbol

ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT / "static"


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env()
DB_PATH = ROOT / os.environ.get("DB_PATH", "data/backtest.db")
DOWNLOAD_LOCK = Lock()
DOWNLOAD_TIMEOUT = 120


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def init_db() -> None:
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS market_data (
                instrument_id TEXT NOT NULL,
                contract_type TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                time INTEGER NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                volume REAL NOT NULL DEFAULT 0,
                open_interest REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (instrument_id, contract_type, timeframe, time)
            );

            CREATE TABLE IF NOT EXISTS replay_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_id TEXT NOT NULL,
                contract_type TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                initial_capital REAL NOT NULL,
                total_pnl REAL NOT NULL,
                win_rate REAL NOT NULL DEFAULT 0,
                trade_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                direction TEXT NOT NULL,
                entry_time INTEGER NOT NULL,
                entry_price REAL NOT NULL,
                exit_time INTEGER NOT NULL,
                exit_price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                take_profit REAL NOT NULL,
                stop_loss REAL NOT NULL,
                pnl REAL NOT NULL,
                exit_reason TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES replay_sessions(id)
            );
            """
        )


def json_response(handler: SimpleHTTPRequestHandler, payload, status=200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_body(handler: SimpleHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def parse_dt(value: str) -> int:
    if not value:
        raise ValueError("Missing datetime")
    value = value.replace("Z", "+00:00")
    if "T" not in value and len(value) == 10:
        value = value + "T00:00:00"
    dt = datetime.fromisoformat(value)
    return int(dt.timestamp())


def to_tq_datetime(value: int) -> datetime:
    return datetime.fromtimestamp(value)


def rows_to_bars(rows):
    return [
        {
            "time": row["time"],
            "open": row["open"],
            "high": row["high"],
            "low": row["low"],
            "close": row["close"],
            "volume": row["volume"],
            "open_interest": row["open_interest"],
        }
        for row in rows
    ]


def fetch_cached_bars(params):
    instrument_id = params["instrument_id"]
    contract_type = params["contract_type"]
    timeframe = params["timeframe"]
    start_ts = parse_dt(params["start"])
    end_ts = parse_dt(params["end"])

    with connect() as con:
        rows = con.execute(
            """
            SELECT * FROM market_data
            WHERE instrument_id = ? AND contract_type = ? AND timeframe = ?
              AND time >= ? AND time <= ?
            ORDER BY time
            """,
            (instrument_id, contract_type, timeframe, start_ts, end_ts),
        ).fetchall()
    return rows_to_bars(rows)


def run_download_process(payload):
    import psutil

    with subprocess.Popen(
        [sys.executable, "-X", "utf8", str(ROOT / "app" / "download_worker.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", cwd=ROOT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    ) as worker:
        try:
            stdout, stderr = worker.communicate(json.dumps(payload), timeout=DOWNLOAD_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            # Windows venv launchers create a second Python process. Stop both
            # so a timed-out SDK cannot keep running or hold its cache lock.
            try:
                children = psutil.Process(worker.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            worker.kill()
            worker.communicate()
            psutil.wait_procs(children, timeout=5)
            raise RuntimeError("行情下载超过 120 秒，已停止。请缩短时间区间后重试") from exc
    if stderr:
        print(stderr.rstrip(), file=sys.stderr, flush=True)
    if not stdout.strip():
        raise RuntimeError("行情下载进程异常退出，请查看服务日志")
    downloaded = json.loads(stdout)
    if worker.returncode or "error" in downloaded:
        raise RuntimeError(downloaded.get("error", "行情下载失败"))
    return downloaded


def download_tq_bars(params):
    account = os.environ.get("TQ_ACCOUNT")
    password = os.environ.get("TQ_PASSWORD")
    if not account or not password:
        raise RuntimeError("请先在 .env 中配置 TQ_ACCOUNT 和 TQ_PASSWORD")

    instrument_id = params["instrument_id"]
    contract_type = params["contract_type"]
    timeframe = params["timeframe"]
    start_ts = parse_dt(params["start"])
    end_ts = parse_dt(params["end"])
    duration = TIMEFRAMES[timeframe]["seconds"]
    symbol = tq_symbol(instrument_id, contract_type)

    if end_ts <= start_ts:
        raise ValueError("结束时间必须晚于开始时间")
    if not DOWNLOAD_LOCK.acquire(blocking=False):
        raise RuntimeError("已有行情下载正在进行，请等待完成后再试")
    try:
        # Isolate SDK file locks/network waits so a timeout can stop the work too.
        downloaded = run_download_process({"symbol": symbol, "duration": duration,
                                           "start": start_ts, "end": end_ts})
    finally:
        DOWNLOAD_LOCK.release()

    records = []
    for row in downloaded["rows"]:
        ns = int(row.get("datetime", 0))
        if ns <= 0:
            continue
        ts = int(ns / 1_000_000_000)
        if ts < start_ts or ts > end_ts:
            continue
        close = float(row.get("close", 0))
        if close <= 0:
            continue
        records.append(
            (
                instrument_id,
                contract_type,
                timeframe,
                ts,
                float(row.get("open", close)),
                float(row.get("high", close)),
                float(row.get("low", close)),
                close,
                float(row.get("volume", 0) or 0),
                float(row.get("open_oi", row.get("close_oi", 0)) or 0),
            )
        )

    with connect() as con:
        con.executemany(
            """
            INSERT OR REPLACE INTO market_data
            (instrument_id, contract_type, timeframe, time, open, high, low, close, volume, open_interest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            records,
        )
    return len(records)


def save_session(payload):
    trades = payload.get("trades") or []
    total_pnl = float(sum(float(t.get("pnl", 0)) for t in trades))
    winners = sum(1 for t in trades if float(t.get("pnl", 0)) > 0)
    win_rate = winners / len(trades) if trades else 0
    created_at = datetime.now(timezone.utc).isoformat()

    with connect() as con:
        cur = con.execute(
            """
            INSERT INTO replay_sessions
            (instrument_id, contract_type, timeframe, start_time, end_time, initial_capital,
             total_pnl, win_rate, trade_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["instrument_id"],
                payload["contract_type"],
                payload["timeframe"],
                int(payload["start_time"]),
                int(payload["end_time"]),
                float(payload["initial_capital"]),
                total_pnl,
                win_rate,
                len(trades),
                created_at,
            ),
        )
        session_id = cur.lastrowid
        con.executemany(
            """
            INSERT INTO trades
            (session_id, direction, entry_time, entry_price, exit_time, exit_price,
             quantity, take_profit, stop_loss, pnl, exit_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    session_id,
                    t["direction"],
                    int(t["entry_time"]),
                    float(t["entry_price"]),
                    int(t["exit_time"]),
                    float(t["exit_price"]),
                    int(t["quantity"]),
                    float(t["take_profit"]),
                    float(t["stop_loss"]),
                    float(t["pnl"]),
                    t["exit_reason"],
                )
                for t in trades
            ],
        )
    return session_id


def list_sessions():
    with connect() as con:
        sessions = con.execute(
            "SELECT * FROM replay_sessions ORDER BY id DESC LIMIT 100"
        ).fetchall()
    return [dict(row) for row in sessions]


def get_session(session_id):
    with connect() as con:
        session = con.execute("SELECT * FROM replay_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session:
            return None
        trades = con.execute(
            "SELECT * FROM trades WHERE session_id = ? ORDER BY entry_time", (session_id,)
        ).fetchall()
    payload = dict(session)
    payload["trades"] = [dict(row) for row in trades]
    return payload


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def translate_path(self, path):
        parsed = urlparse(path)
        rel = parsed.path.lstrip("/") or "index.html"
        return str(STATIC_DIR / rel)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        try:
            if parsed.path == "/api/instruments":
                json_response(
                    self,
                    {
                        "instruments": INSTRUMENTS,
                        "timeframes": TIMEFRAMES,
                        "contract_types": CONTRACT_TYPES,
                    },
                )
            elif parsed.path == "/api/bars":
                instrument = get_instrument(qs.get("instrument_id"))
                if not instrument:
                    raise ValueError("Unknown instrument")
                bars = fetch_cached_bars(qs)
                json_response(self, {"bars": bars, "instrument": instrument})
            elif parsed.path == "/api/sessions":
                json_response(self, {"sessions": list_sessions()})
            elif parsed.path.startswith("/api/sessions/"):
                session_id = int(parsed.path.rsplit("/", 1)[-1])
                session = get_session(session_id)
                if not session:
                    json_response(self, {"error": "Session not found"}, 404)
                else:
                    json_response(self, session)
            else:
                super().do_GET()
        except Exception as exc:
            json_response(self, {"error": str(exc)}, 400)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            payload = read_body(self)
            if parsed.path == "/api/download":
                count = download_tq_bars(payload)
                bars = fetch_cached_bars(payload)
                json_response(self, {"downloaded": count, "bars": bars})
            elif parsed.path == "/api/sessions":
                session_id = save_session(payload)
                json_response(self, {"id": session_id})
            else:
                json_response(self, {"error": "Not found"}, 404)
        except Exception as exc:
            json_response(self, {"error": str(exc)}, 400)


def main() -> None:
    init_db()
    host = os.environ.get("APP_HOST", "127.0.0.1")
    port = int(os.environ.get("APP_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Trading Backtest Replay running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
