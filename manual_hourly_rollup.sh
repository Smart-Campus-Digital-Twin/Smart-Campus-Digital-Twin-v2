#!/bin/bash
# Manual hourly rollup - populates campus_1h bucket with aggregated data

echo "Running manual hourly rollup for current hour..."
docker exec campus-airflow bash -c "cd /opt/campus && PYTHONPATH=/opt/campus python3 -c '
import sys
sys.path.insert(0, \"/opt/campus\")
from processing.spark.jobs.hourly_rollup import run
from datetime import datetime, timezone

# Run for current hour
current_hour = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
hour_str = current_hour.strftime(\"%Y-%m-%dT%H:%M:%S\")
print(f\"Processing hour: {hour_str}\")
run(hour_str)
'"

echo "Done! Check InfluxDB campus_1h bucket for data."
