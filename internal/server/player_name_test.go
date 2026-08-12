package server

import "testing"

func TestSanitizePlayerName(t *testing.T) {
	checks := map[string]string{
		"  Anna   Blau ":       "Anna Blau",
		"<b>Goofy</b>":         "bGoofyb",
		"Äpfel-42_Pro":         "Äpfel-42_Pro",
		"\n\t":                 "",
		"12345678901234567890": "1234567890123456",
	}
	for input, expected := range checks {
		if actual := sanitizePlayerName(input); actual != expected {
			t.Fatalf("sanitizePlayerName(%q) = %q, want %q", input, actual, expected)
		}
	}
}
