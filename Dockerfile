FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV HEADED=false
EXPOSE 3000
CMD ["npm", "start"]
