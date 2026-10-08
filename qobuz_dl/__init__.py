__version__ = "2.5.9.3"
from .qopy import Client
def main(*args, **kwargs):
    from .cli import main as cli_main
    return cli_main(*args, **kwargs)
