FROM python:3.11-slim

WORKDIR /app

# Core deps first so the service boots and /health works even if the heavy ML
# stack fails to install. CPU-only torch keeps the image smaller.
COPY requirements.txt requirements-ml.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements-ml.txt || echo "ml extras skipped"

COPY . .
RUN python -c "import app.main; print('simulation import ok')"

ENV MODEL_DIR=/app/artifacts
EXPOSE 5100
CMD ["sh", "-c", "echo starting on port $PORT && uvicorn app.main:app --host 0.0.0.0 --port $PORT --log-level info"]
