# Build stage
FROM node:18-bookworm AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm install --save-dev @playwright/test

    # Production stage with Playwright browser
    # Use the latest official Playwright image (tag may change over time).
    # If you prefer a specific Playwright version, replace `latest` with that version.
    FROM mcr.microsoft.com/playwright:latest

WORKDIR /app

# Install additional utilities for headed mode and debugging
RUN apt-get update && apt-get install -y \
    xvfb \
    x11-utils \
    dbus-x11 \
    libxss1 \
    libxkbcommon0 \
    libxcursor1 \
    && rm -rf /var/lib/apt/lists/*

# Copy node modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/test-results \
    && mkdir -p /app/shared/logs \
    && mkdir -p /app/shared/test-cases

# Set environment variables
ENV NODE_ENV=production
ENV HEADED=true
ENV HOME=/app

# Expose port for server
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
