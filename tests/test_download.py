import gc
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import psutil

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
import server


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # Existing SQLite helpers rely on connection garbage collection.
        # Release those handles before deleting the temporary DB on Windows.
        self.addCleanup(gc.collect)
        self.root = Path(self.temp.name)
        self.db = patch.object(server, "DB_PATH", self.root / "backtest.db")
        self.db.start()
        self.addCleanup(self.db.stop)
        self.auth = patch.dict(os.environ, TQ_ACCOUNT="test", TQ_PASSWORD="test")
        self.auth.start()
        self.addCleanup(self.auth.stop)
        server.init_db()
        self.params = dict(instrument_id="SHFE.rb", contract_type="main", timeframe="5m",
                           start="2026-09-28T09:00:00", end="2026-09-28T10:00:00")

    def test_success_caches_bars_without_duplicates(self):
        start = server.parse_dt(self.params["start"])
        rows = [{"datetime": ts * 1_000_000_000, "open": 3000, "high": 3010,
                 "low": 2990, "close": 3005, "volume": 20, "open_oi": 10}
                for ts in (start - 300, start, start + 300)]
        with patch.object(server, "run_download_process", return_value={"rows": rows}):
            self.assertEqual(server.download_tq_bars(self.params), 2)
            self.assertEqual(server.download_tq_bars(self.params), 2)
        self.assertEqual(len(server.fetch_cached_bars(self.params)), 2)

    def test_duplicate_request_is_rejected_immediately(self):
        with server.DOWNLOAD_LOCK:
            with self.assertRaisesRegex(RuntimeError, "已有行情下载"):
                server.download_tq_bars(self.params)

    def test_failed_download_allows_retry(self):
        with patch.object(server, "run_download_process", side_effect=RuntimeError("failed")):
            with self.assertRaisesRegex(RuntimeError, "failed"):
                server.download_tq_bars(self.params)
        with patch.object(server, "run_download_process", return_value={"rows": []}):
            self.assertEqual(server.download_tq_bars(self.params), 0)

    def test_timeout_terminates_worker_and_windows_launcher(self):
        app = self.root / "app"
        app.mkdir()
        (app / "download_worker.py").write_text(
            "import os, time\n"
            "from pathlib import Path\n"
            "Path('worker.pid').write_text(str(os.getpid()))\n"
            "Path('parent.pid').write_text(str(os.getppid()))\n"
            "time.sleep(60)\n", encoding="utf-8")
        with patch.object(server, "ROOT", self.root), patch.object(server, "DOWNLOAD_TIMEOUT", 2):
            with self.assertRaisesRegex(RuntimeError, "已停止"):
                server.run_download_process({})
        pid = int((self.root / "worker.pid").read_text())
        self.assertFalse(psutil.pid_exists(pid), "Timed-out worker is still alive")
        parent_pid = int((self.root / "parent.pid").read_text())
        if parent_pid != os.getpid():
            self.assertFalse(psutil.pid_exists(parent_pid), "Windows launcher is still alive")


if __name__ == "__main__":
    unittest.main()
