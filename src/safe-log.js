'use strict';

function createSafeLog(logSensitiveData) {
  function maskPhone(value) {
    const phone = String(value || '');

    if (logSensitiveData || !phone) {
      return phone;
    }

    const visible = phone.slice(-4);

    return `${'*'.repeat(Math.max(phone.length - visible.length, 0))}${visible}`;
  }

  function logText(value, limit = 120) {
    const text = String(value || '');

    if (!text) {
      return '';
    }

    if (!logSensitiveData) {
      return `[${text.length} chars]`;
    }

    return text.slice(0, limit);
  }

  function logMediaUrl(value) {
    if (!value) {
      return '';
    }

    return logSensitiveData ? String(value) : '[media-url]';
  }

  function logPhoneCandidates(candidates) {
    return Object.fromEntries(
      Object.entries(candidates || {}).map(([key, value]) => [key, maskPhone(value)])
    );
  }

  return {
    logMediaUrl,
    logPhoneCandidates,
    logText,
    maskPhone,
  };
}

module.exports = {
  createSafeLog,
};
