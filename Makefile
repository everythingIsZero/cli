.PHONY: test lint

test:
	node --test 'test/**/*.test.mjs'

lint:
	@find src bin -name '*.mjs' -exec node --check {} \;
