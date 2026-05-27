PYTHON ?= python3
UV ?= uv
UV_CACHE_DIR ?= .uv-cache
UV_RUN = $(UV) --cache-dir $(UV_CACHE_DIR)

.PHONY: install install-dev sync sync-frozen test test-unittest compile doctor smoke

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e ".[dev]"

sync:
	$(UV_RUN) sync --dev

sync-frozen:
	$(UV_RUN) sync --dev --frozen

test:
	$(UV_RUN) run pytest -q

test-unittest:
	PYTHONPATH=src $(PYTHON) -m unittest discover -s tests -v

compile:
	$(UV_RUN) run python -m compileall -q src tests examples

doctor:
	$(UV_RUN) run noveltrans doctor --backend auto --strict

smoke:
	$(UV_RUN) run noveltrans run-local --name smoke --input examples/smoke_input.txt --dry-run --confirm-rights --no-redistribute --formats txt,docx,epub
