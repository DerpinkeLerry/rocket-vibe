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

func TestSanitizeCarStyle(t *testing.T) {
	checks := map[string]string{
		"vortex":  "vortex",
		" TITAN ": defaultCarStyle,
		"Apex":    "apex",
		"razor":   "razor",
		"octane":  defaultCarStyle,
		"":        defaultCarStyle,
	}
	for input, expected := range checks {
		if actual := sanitizeCarStyle(input); actual != expected {
			t.Fatalf("sanitizeCarStyle(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestSanitizeBoostStyle(t *testing.T) {
	checks := map[string]string{
		"solar":    "solar",
		" ION ":    "ion",
		"Plasma":   "plasma",
		"STARFALL": "starfall",
		"rainbow":  defaultBoostStyle,
		"":         defaultBoostStyle,
	}
	for input, expected := range checks {
		if actual := sanitizeBoostStyle(input); actual != expected {
			t.Fatalf("sanitizeBoostStyle(%q) = %q, want %q", input, actual, expected)
		}
	}
}
