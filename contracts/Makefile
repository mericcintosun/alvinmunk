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

.PHONY: default build test fmt lint clean
