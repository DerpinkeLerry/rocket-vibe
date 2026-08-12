package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"rocket-vibe/internal/game"
	gameserver "rocket-vibe/internal/server"
)

const version = "1.6.0-go"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	rootContext, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()

	config := game.DefaultConfig()
	match := gameserver.NewMatch(rootContext, config)
	port := environment("PORT", "8080")
	httpHandler := gameserver.NewHTTPServer(match, gameserver.HTTPOptions{
		StaticDirectory: environment("STATIC_DIR", "dist"),
		Version:         version,
		AllowedOrigins:  commaSeparated(os.Getenv("ALLOWED_ORIGINS")),
	}, logger)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           httpHandler.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("rocket server listening",
			"port", port, "version", version,
			"physicsHz", config.PhysicsHz, "snapshotHz", config.SnapshotHz,
		)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-rootContext.Done():
		logger.Info("shutdown signal received")
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			match.Stop()
			os.Exit(1)
		}
	}

	match.Stop()
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Error("http shutdown failed", "error", err)
	}
}

func environment(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func commaSeparated(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
