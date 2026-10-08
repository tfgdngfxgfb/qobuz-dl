import os
import tempfile
import unittest
from unittest.mock import Mock, patch

from qobuz_dl.gui_backend import gui_app


class GuiStartupTests(unittest.TestCase):
    def test_window_opens_before_saved_login_network_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            config = os.path.join(folder, "config.ini")
            with open(config, "w", encoding="utf-8") as source:
                source.write("[DEFAULT]\nuser_id = 123\nuser_auth_token = example-token\n")
            webview = Mock()
            with (
                patch.object(gui_app, "CONFIG_PATH", folder),
                patch.object(gui_app, "CONFIG_FILE", config),
                patch.object(gui_app, "_build_qobuz_from_config", side_effect=AssertionError("Login blocked GUI startup")),
                patch.object(gui_app, "_listen_port", return_value=5569),
                patch.object(gui_app, "_wait_for_port"),
                patch.object(gui_app.app, "run"),
                patch("qobuz_dl.gui_backend.db.prune_lrclib_by_audio_orphans"),
                patch("qobuz_dl.gui_backend.db.prune_gui_download_history_orphans"),
                patch("qobuz_dl.gui_backend.updater.cleanup_stale_exe_backup"),
                patch.dict("sys.modules", {"webview": webview}),
                patch.object(gui_app.os, "_exit") as exit_process,
                patch.dict(os.environ, {"QOBUZ_DL_GUI_BROWSER": ""}),
            ):
                gui_app.main()
            webview.create_window.assert_called_once()
            self.assertEqual(webview.create_window.call_args.args[1], "http://127.0.0.1:5569/")
            webview.start.assert_called_once_with(debug=False)
            exit_process.assert_called_once_with(0)


if __name__ == "__main__":
    unittest.main()
