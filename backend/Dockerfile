FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libglib2.0-0 \
    libgdk-pixbuf-xlib-2.0-0 \
    libffi8 \
    shared-mime-info \
    fonts-freefont-ttf \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Headless Chromium + its system libraries for the nightly AutoProctor sync
# (app/services/autoproctor_scraper.py). Lives in the shared image because the
# task runs on the existing celery worker; adds roughly 400 MB.
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
