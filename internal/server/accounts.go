package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	accountPasswordIterations = 210_000
	accountSessionLifetime    = 7 * 24 * time.Hour
)

var (
	errAccountExists      = errors.New("username already exists")
	errInvalidCredentials = errors.New("invalid username or password")
	errInvalidUsername    = errors.New("username must contain 2-16 letters, numbers, dots, dashes or underscores")
	errInvalidPassword    = errors.New("password must contain 8-128 characters")
)

type storedAccount struct {
	Username     string    `json:"username"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
}

type accountFile struct {
	Version  int                      `json:"version"`
	Accounts map[string]storedAccount `json:"accounts"`
}

type accountSession struct {
	Username  string
	ExpiresAt time.Time
}

type accountStore struct {
	mu       sync.Mutex
	path     string
	accounts map[string]storedAccount
	sessions map[string]accountSession
	loadErr  error
}

func newAccountStore(path string) *accountStore {
	if strings.TrimSpace(path) == "" {
		path = filepath.Join("data", "users.json")
	}
	store := &accountStore{
		path:     path,
		accounts: make(map[string]storedAccount),
		sessions: make(map[string]accountSession),
	}
	store.loadErr = store.load()
	return store
}

func normalizeAccountUsername(username string) (string, string, error) {
	display := strings.TrimSpace(username)
	if len(display) < 2 || len(display) > 16 {
		return "", "", errInvalidUsername
	}
	for _, character := range display {
		valid := character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '.' || character == '-' || character == '_'
		if !valid {
			return "", "", errInvalidUsername
		}
	}
	return strings.ToLower(display), display, nil
}

func validateAccountPassword(password string) error {
	length := len([]rune(password))
	if length < 8 || length > 128 {
		return errInvalidPassword
	}
	return nil
}

func deriveAccountPassword(password string, salt []byte, iterations int) []byte {
	// PBKDF2-HMAC-SHA256, one 32-byte block. The password is never written to
	// disk and the random salt prevents identical passwords sharing a hash.
	block := append(append([]byte(nil), salt...), 0, 0, 0, 1)
	mac := hmac.New(sha256.New, []byte(password))
	_, _ = mac.Write(block)
	previous := mac.Sum(nil)
	result := append([]byte(nil), previous...)
	for iteration := 1; iteration < iterations; iteration++ {
		mac.Reset()
		_, _ = mac.Write(previous)
		previous = mac.Sum(nil)
		for index := range result {
			result[index] ^= previous[index]
		}
	}
	return result
}

func hashAccountPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := deriveAccountPassword(password, salt, accountPasswordIterations)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s",
		accountPasswordIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func verifyAccountPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil || iterations < 100_000 || iterations > 1_000_000 {
		return false
	}
	salt, saltErr := base64.RawStdEncoding.DecodeString(parts[2])
	expected, hashErr := base64.RawStdEncoding.DecodeString(parts[3])
	if saltErr != nil || hashErr != nil || len(salt) < 16 || len(expected) != sha256.Size {
		return false
	}
	actual := deriveAccountPassword(password, salt, iterations)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func (store *accountStore) load() error {
	data, err := os.ReadFile(store.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read accounts: %w", err)
	}
	var file accountFile
	if err := json.Unmarshal(data, &file); err != nil {
		return fmt.Errorf("decode accounts: %w", err)
	}
	if file.Accounts != nil {
		store.accounts = file.Accounts
	}
	return nil
}

func (store *accountStore) persistLocked() error {
	if err := os.MkdirAll(filepath.Dir(store.path), 0o700); err != nil {
		return fmt.Errorf("create account directory: %w", err)
	}
	data, err := json.MarshalIndent(accountFile{Version: 1, Accounts: store.accounts}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode accounts: %w", err)
	}
	if err := os.WriteFile(store.path, data, 0o600); err != nil {
		return fmt.Errorf("write accounts: %w", err)
	}
	return nil
}

func (store *accountStore) register(username, password string) (storedAccount, error) {
	key, display, err := normalizeAccountUsername(username)
	if err != nil {
		return storedAccount{}, err
	}
	if err := validateAccountPassword(password); err != nil {
		return storedAccount{}, err
	}
	hash, err := hashAccountPassword(password)
	if err != nil {
		return storedAccount{}, err
	}

	store.mu.Lock()
	defer store.mu.Unlock()
	if store.loadErr != nil {
		return storedAccount{}, store.loadErr
	}
	if _, exists := store.accounts[key]; exists {
		return storedAccount{}, errAccountExists
	}
	account := storedAccount{Username: display, PasswordHash: hash, CreatedAt: time.Now().UTC()}
	store.accounts[key] = account
	if err := store.persistLocked(); err != nil {
		delete(store.accounts, key)
		return storedAccount{}, err
	}
	return account, nil
}

func (store *accountStore) authenticate(username, password string) (storedAccount, error) {
	key, _, usernameErr := normalizeAccountUsername(username)
	store.mu.Lock()
	account, exists := store.accounts[key]
	loadErr := store.loadErr
	store.mu.Unlock()
	if loadErr != nil {
		return storedAccount{}, loadErr
	}
	if usernameErr != nil || !exists || !verifyAccountPassword(account.PasswordHash, password) {
		// Perform equivalent work for missing users to reduce account probing by
		// response timing. This hash is intentionally valid but never accepted.
		if !exists {
			dummySalt := []byte("rocket-vibe-auth")
			_ = deriveAccountPassword(password, dummySalt, accountPasswordIterations)
		}
		return storedAccount{}, errInvalidCredentials
	}
	return account, nil
}

func (store *accountStore) createSession(username string) (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	store.mu.Lock()
	store.sessions[token] = accountSession{Username: username, ExpiresAt: time.Now().Add(accountSessionLifetime)}
	store.mu.Unlock()
	return token, nil
}

func (store *accountStore) session(token string) (storedAccount, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	session, exists := store.sessions[token]
	if !exists || time.Now().After(session.ExpiresAt) {
		delete(store.sessions, token)
		return storedAccount{}, false
	}
	account, exists := store.accounts[strings.ToLower(session.Username)]
	return account, exists
}

func (store *accountStore) deleteSession(token string) {
	store.mu.Lock()
	delete(store.sessions, token)
	store.mu.Unlock()
}
