package server

import (
	"strings"
	"unicode"
)

const maximumPlayerNameRunes = 16

func sanitizePlayerName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	result := make([]rune, 0, maximumPlayerNameRunes)
	lastWasSpace := false
	for _, character := range value {
		if len(result) >= maximumPlayerNameRunes {
			break
		}
		if unicode.IsSpace(character) {
			if len(result) > 0 && !lastWasSpace {
				result = append(result, ' ')
				lastWasSpace = true
			}
			continue
		}
		if !unicode.IsLetter(character) && !unicode.IsNumber(character) && character != '_' && character != '-' {
			continue
		}
		result = append(result, character)
		lastWasSpace = false
	}
	return strings.TrimSpace(string(result))
}

const defaultCarStyle = "vortex"

func sanitizeCarStyle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "vortex", "titan", "apex", "razor":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return defaultCarStyle
	}
}

const defaultBoostStyle = "solar"

func sanitizeBoostStyle(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "solar", "ion", "plasma", "starfall":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return defaultBoostStyle
	}
}
