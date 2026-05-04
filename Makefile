# Smart Campus Digital Twin — development helpers
# Requires: docker, docker-compose, python >= 3.12, kcat (optional)

.PHONY: help env up down dev logs ps build test lint clean

COMPOSE      = docker compose -f docker-compose.yml
COMPOSE_DEV  = docker compose -f docker-compose.dev.yml
PYTHON       = python3

##@ Setup

env: ## Copy .env.example files to .env (safe defaults, fill in real secrets)
	@for f in env/*.env.example; do \
		dest="$${f%.example}"; \
		if [ ! -f "$$dest" ]; then \
			cp "$$f" "$$dest"; \
			echo "Created $$dest (edit with real values)"; \
		else \
			echo "Skipped $$dest (already exists)"; \
		fi; \
	done

##@ Full stack

up: ## Start all services (full pipeline)
	$(COMPOSE) up -d

down: ## Stop and remove all containers (data volumes preserved)
	$(COMPOSE) down

build: ## Rebuild all custom images
	$(COMPOSE) build

logs: ## Tail logs for all services
	$(COMPOSE) logs -f

ps: ## Show running containers and health
	$(COMPOSE) ps

##@ Dev (minimal — broker + databases only, run services on host)

dev: ## Start only broker + databases (simulator runs on host)
	$(COMPOSE_DEV) up -d
	@echo ""
	@echo "  MQTT     → localhost:1883"
	@echo "  InfluxDB → http://localhost:8086"
	@echo "  Postgres → localhost:5432"
	@echo ""
	@echo "  Run the simulator: python -m simulator.main"

dev-down: ## Stop dev stack
	$(COMPOSE_DEV) down

##@ Testing

test: ## Run all unit tests
	$(PYTHON) -m pytest tests/ -v

test-schemas: ## Test shared schemas only (fast, no infra needed)
	$(PYTHON) -m pytest tests/unit/test_schemas.py -v

##@ Code quality

lint: ## Run ruff linter across all Python code
	ruff check .

format: ## Auto-format with ruff
	ruff format .

##@ Utilities

kafka-topics: ## List Kafka topics
	docker exec campus-kafka kafka-topics.sh --bootstrap-server localhost:9092 --list

kafka-tail: ## Tail a topic (TOPIC=sensors.temperature make kafka-tail)
	kcat -b localhost:9092 -t $(TOPIC) -C -o end

influx-query: ## Open InfluxDB Data Explorer in browser
	open http://localhost:8086

clean: ## Remove Python cache files
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null; true
	find . -name "*.pyc" -delete 2>/dev/null; true

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
