# Use lightweight Node.js image
FROM node:18-alpine

# Create working directory inside the container
WORKDIR /app

# Copy only dependency files first (for caching)
COPY package*.json ./

# Install node modules
RUN npm install

# Copy everything else (source code, etc.)
COPY . .

# Expose the port your app uses (update if it's not 8080)
EXPOSE 8080

# Run your app using npm start
CMD ["npm", "start"]
