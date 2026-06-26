# Task shortcuts — run `just <name>`. Optional; everything is also available via npm scripts.
# Install just from https://github.com/casey/just

# List the available recipes
default:
    @just --list

# Install dependencies
install:
    npm install

# Rebuild automatically as you edit
dev:
    npm run dev

# Link into a Signal K server and watch (just link /path/to/.signalk)
link dir="":
    scripts/dev-link.sh {{ dir }}

# Run the unit tests
test:
    npm test

# Run the tests with coverage
coverage:
    npm run test:coverage

# Lint and check formatting (what CI does)
check:
    npm run format:check
    npm run lint
    npm run build
    npm test

# Auto-format the code
format:
    npm run format

# Bring the end-to-end stack up
e2e-up:
    cd e2e && ./run.sh

# Tear the end-to-end stack down
e2e-down:
    cd e2e && ./run.sh --down
