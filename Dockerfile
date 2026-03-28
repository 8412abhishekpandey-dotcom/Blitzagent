FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy application code
COPY . .

# Create required directories
RUN mkdir -p logs screenshots

# Expose the server port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV HEADLESS=true

# Start the server
CMD ["node", "server.js"]
