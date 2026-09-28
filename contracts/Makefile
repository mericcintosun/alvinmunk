default: build

build:
	stellar contract build

test:
	cargo test

fmt:
	cargo fmt --all

lint:
	cargo clippy --all-targets -- -D warnings

clean:
	cargo clean

# Release wasm of every contract, committed as fixtures for the `upgrade_to_identical_wasm_*`
# tests. Re-run after changing a contract so those tests exercise the current code.
upgrade-fixtures: build
	for c in gate quest_registry registry reputation rewards; do \
		cp target/wasm32v1-none/release/alvinmunk_$$c.wasm $$c/testdata/; \
	done

.PHONY: default build test fmt lint clean upgrade-fixtures
