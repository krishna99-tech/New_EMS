# ==========================================
# FUSO Energy Monitoring System (EMS)
# Multi-protocol Container (HTTP + UDP)
# ==========================================

FROM python:3.11-slim

# Prevent Python from writing .pyc files and enable unbuffered logging
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install lightweight system dependencies for healthcheck & network tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose ports:
# 10012: Web Dashboard & REST API (TCP)
# 10011: ESP32 Energy Meter Ingestion (UDP)
EXPOSE 10012
EXPOSE 10011/udp

# Healthcheck to verify FastAPI is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:10012/ || exit 1

# Start the application with Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "10012"]
