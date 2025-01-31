# Start with official Node.js docker image: https://hub.docker.com/_/node
FROM node:22-alpine

# Install system packages
RUN apk add --no-cache ffmpeg

# Set the default directory
WORKDIR /usr/src/app

# Install Node.js packages
COPY package*.json ./
RUN npm ci

# Copy our code into the image
COPY public public
COPY server server

# Run the application
CMD node server/server.js
