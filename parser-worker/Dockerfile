FROM python:3.11-slim

# libgl/libglib are needed by OpenCV (pulled in via docling's OCR stack).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Layer 1: Install dependencies (cached unless requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=1000 -r requirements.txt

# Layer 2: Copy application code
COPY main.py .

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8787"]
