# Use official light-weight Node.js image
FROM node:20-slim

# Create and define the working directory
WORKDIR /usr/src/app

# Copy package files and install production dependencies
COPY package.json ./
RUN npm install --only=production

# Copy application source code
COPY . .

# Expose port 8080 (Cloud Run environment default)
EXPOSE 8080

# Run the web service on container startup
CMD [ "npm", "start" ]
