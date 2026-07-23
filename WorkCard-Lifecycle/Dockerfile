ARG PYTHON_IMAGE=python:3.12.11-slim-bookworm
FROM ${PYTHON_IMAGE} AS dependencies

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --prefix=/install -r requirements.txt

FROM ${PYTHON_IMAGE} AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    PATH=/home/workcard/.local/bin:${PATH}

RUN groupadd --system --gid 10001 workcard \
    && useradd --system --uid 10001 --gid workcard --home-dir /home/workcard workcard

COPY --from=dependencies /install /usr/local
WORKDIR /app
COPY --chown=workcard:workcard src ./src
COPY --chown=workcard:workcard db ./db

USER 10001:10001
EXPOSE 8000

CMD ["uvicorn", "workcard_api.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--no-proxy-headers"]
