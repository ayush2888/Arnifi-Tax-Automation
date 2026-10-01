FROM python:3.12-slim-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/pyproject.toml ./pyproject.toml
COPY worker/src ./src
RUN pip install --no-cache-dir .
EXPOSE 4711
CMD ["python", "-m", "daftar.worker"]
