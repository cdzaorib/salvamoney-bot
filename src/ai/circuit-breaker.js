'use strict';

// Circuit breaker simples por provedor: após falhas consecutivas, bloqueia chamadas
// durante o cooldown e depois libera uma única tentativa (half-open).
function createCircuitBreaker({
  cooldownMs = 60000,
  failureThreshold = 3,
  now = () => Date.now(),
} = {}) {
  const states = new Map();

  function stateFor(key) {
    if (!states.has(key)) {
      states.set(key, {
        failures: 0,
        halfOpenInFlight: false,
        openedAt: null,
      });
    }

    return states.get(key);
  }

  function canRequest(key) {
    const state = stateFor(key);

    if (state.openedAt === null) {
      return true;
    }

    if (now() - state.openedAt < cooldownMs) {
      return false;
    }

    if (state.halfOpenInFlight) {
      return false;
    }

    state.halfOpenInFlight = true;

    return true;
  }

  function recordSuccess(key) {
    states.set(key, {
      failures: 0,
      halfOpenInFlight: false,
      openedAt: null,
    });
  }

  function recordFailure(key) {
    const state = stateFor(key);
    const wasHalfOpen = state.halfOpenInFlight;

    state.failures += 1;
    state.halfOpenInFlight = false;

    if (wasHalfOpen || state.failures >= failureThreshold) {
      state.openedAt = now();
    }
  }

  function status(key) {
    const state = stateFor(key);

    if (state.openedAt === null) {
      return 'closed';
    }

    return now() - state.openedAt < cooldownMs ? 'open' : 'half_open';
  }

  return {
    canRequest,
    recordFailure,
    recordSuccess,
    status,
  };
}

module.exports = {
  createCircuitBreaker,
};
