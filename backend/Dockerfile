# Build context is the PROJECT ROOT (see docker-compose.yml) so the unmodified Tier 0-4 scripts + data ship in the image.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg PYTHONPATH=/app/backend PROJECT_ROOT=/app
WORKDIR /app
COPY requirements.txt /app/requirements.txt
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY src /app/src
COPY data /app/data
COPY backend /app/backend
RUN mkdir -p /app/report/figures /app/data/incoming
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:%s/api/v1/health' % __import__('os').environ.get('PORT','8000')).status==200 else 1)"
CMD ["sh", "-c", "python -m app.bootstrap && exec uvicorn app.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]