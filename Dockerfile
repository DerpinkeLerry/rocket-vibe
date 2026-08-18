# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend
WORKDIR /source
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM golang:1.23-alpine AS backend
WORKDIR /source
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go test ./...
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /rocket-server ./cmd/server

FROM alpine:3.21 AS runtime
RUN addgroup -S rocket && adduser -S -G rocket rocket
WORKDIR /app
RUN mkdir -p /app/data && chown rocket:rocket /app/data
COPY --from=backend --chown=rocket:rocket /rocket-server ./rocket-server
COPY --from=frontend --chown=rocket:rocket /source/dist ./dist
ENV PORT=10000
ENV STATIC_DIR=/app/dist
ENV AUTH_DATA_FILE=/app/data/users.json
USER rocket
EXPOSE 10000
ENTRYPOINT ["./rocket-server"]
