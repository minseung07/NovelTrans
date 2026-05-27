"""NovelTrans command line entry point."""

from __future__ import annotations

import sys

from . import __version__
from .cli_commands import build_parser
from .errors import NovelTransError


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(sys.argv[1:] if argv is None else argv))
    if args.version:
        print(__version__)
        return 0
    handler = getattr(args, "handler", None)
    if handler is None:
        from .wizard import wizard_main

        handler = lambda _args: wizard_main()
    try:
        return int(handler(args))
    except (KeyboardInterrupt, EOFError):
        print("\n취소했습니다.")
        return 130
    except NovelTransError as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"파일 오류: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
