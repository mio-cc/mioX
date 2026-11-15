package server

import (
	"log"
	"strconv"
	"strings"
	"sync"

	"github.com/Autumn-27/norma/llm"
)

// refusalFallbackSetting is the settings key holding the LLM profile id used at ladder
// step L3. Empty / invalid means "no fallback configured", and the ladder then stops
// instead of retrying the same refusing model.
const refusalFallbackSetting = "refusal_fallback_profile"

var (
	fallbackProvMu   sync.Mutex
	fallbackProvKey  string
	fallbackProvVal  llm.Provider
	fallbackProvMiss bool
)

// refusalFallbackProvider resolves the configured fallback provider. Results are cached
// by profile id so a long-lived task does not rebuild a provider on every refusal.
func (s *Server) refusalFallbackProvider() llm.Provider {
	if s.m == nil || s.m.pg == nil {
		return nil
	}
	raw, _, err := s.m.pg.GetSetting(refusalFallbackSetting)
	if err != nil {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	id, convErr := strconv.ParseInt(raw, 10, 64)
	if convErr != nil || id <= 0 {
		return nil
	}

	fallbackProvMu.Lock()
	defer fallbackProvMu.Unlock()
	key := raw
	if fallbackProvKey == key {
		if fallbackProvMiss {
			return nil
		}
		return fallbackProvVal
	}
	prov, _, ok := s.providerForProfile(id)
	if !ok || prov == nil {
		// Cache the miss too: a broken profile should not be rebuilt per refusal.
		fallbackProvKey, fallbackProvVal, fallbackProvMiss = key, nil, true
		log.Printf("[refusal] fallback profile %d 不可用，L3 将降级为 give_up", id)
		return nil
	}
	fallbackProvKey, fallbackProvVal, fallbackProvMiss = key, prov, false
	log.Printf("[refusal] L3 fallback 使用 profile %d", id)
	return prov
}
