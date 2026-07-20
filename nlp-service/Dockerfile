FROM python:3.11-slim

WORKDIR /app

# CPU-only torch keeps the image smaller and avoids GPU wheel OOM on Railway.
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && python -m spacy download en_core_web_sm

# Bake the embedding model into the image so a fresh container never downloads
# at boot. Docker copies /models into an empty named volume on first mount, so
# the compose volume cache stays warm too.
ENV HF_HOME=/models
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

COPY . .
RUN python -c "import app.main; print('nlp import ok')"

ENV DATABASE_URL=""
EXPOSE 5000
CMD ["sh", "-c", "echo starting on port $PORT && uvicorn app.main:app --host 0.0.0.0 --port $PORT --log-level info"]
