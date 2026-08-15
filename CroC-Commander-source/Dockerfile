# croc-commander — AppImage build in a container (Fedora 41 + Node 20)
FROM node:20-bookworm

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx electron-builder --linux AppImage --x64

# artifacts land in ./dist
CMD ["/bin/bash"]
