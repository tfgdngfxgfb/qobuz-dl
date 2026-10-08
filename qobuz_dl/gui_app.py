"""GUI entry point for source installs and the desktop bundle."""
from qobuz_dl.gui_backend.gui_app import main

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
