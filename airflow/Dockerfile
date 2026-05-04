# Stage 0: borrow Spark 4.1.1 from the cluster image (already cached locally)
FROM apache/spark:4.1.1 AS spark-dist

FROM apache/airflow:2.9.3

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
    && ln -sfn "/usr/lib/jvm/java-17-openjdk-$(dpkg --print-architecture)" \
           /usr/lib/jvm/java-17-openjdk \
    && rm -rf /var/lib/apt/lists/*

# Copy Spark 4.1.1 from the cluster image — version-matched, no pip download needed
COPY --from=spark-dist /opt/spark /opt/spark

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
    SPARK_HOME=/opt/spark \
    PATH="/usr/lib/jvm/java-17-openjdk/bin:/opt/spark/bin:${PATH}" \
    PYTHONPATH=/opt/spark/python \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER airflow
COPY airflow/requirements.txt /tmp/requirements.txt
# Install the Spark provider without its pyspark dep (pyspark comes from /opt/spark).
# apache-airflow-providers-common-sql is installed first so the provider's
# remaining transitive deps are satisfied.
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir apache-airflow-providers-common-sql \
    && pip install --no-cache-dir --no-deps apache-airflow-providers-apache-spark==4.10.0 \
    && pip install --no-cache-dir -r /tmp/requirements.txt
