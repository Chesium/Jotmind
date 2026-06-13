# JotMind canonical PostgreSQL image.
#
# Combines Apache AGE (graph) with pgvector (embeddings) on PostgreSQL 18.
# The apache/age base image ships PostgreSQL 18 + AGE; we compile pgvector
# (which supports PG 18 from v0.8.1) on top.
FROM apache/age:latest

ARG PGVECTOR_VERSION=v0.8.1

USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        build-essential git ca-certificates postgresql-server-dev-18; \
    git clone --branch "${PGVECTOR_VERSION}" --depth 1 \
        https://github.com/pgvector/pgvector.git /tmp/pgvector; \
    cd /tmp/pgvector; \
    make; \
    make install; \
    rm -rf /tmp/pgvector; \
    apt-get purge -y --auto-remove build-essential git postgresql-server-dev-18; \
    rm -rf /var/lib/apt/lists/*
