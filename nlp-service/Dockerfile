FROM python:3.11-slim

WORKDIR /app

# CPU-only torch keeps the image smaller and avoids GPU wheel OOM on Railway.
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m spacy download en_core_web_sm

COPY . .
RUN python -c "import app.main; print('nlp import ok')"

ENV DATABASE_URL=""
EXPOSE 5000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-5000} --log-level info"]
