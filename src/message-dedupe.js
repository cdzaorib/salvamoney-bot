'use strict';

const MESSAGE_TTL = 10 * 60 * 1000;

function createMessageDedupe() {
  const processedMessages = new Map();

  function isDuplicateMessage(messageId) {
    if (!messageId) return false;

    const now = Date.now();

    for (const [id, ts] of processedMessages.entries()) {
      if (now - ts > MESSAGE_TTL) {
        processedMessages.delete(id);
      }
    }

    if (processedMessages.has(messageId)) {
      return true;
    }

    processedMessages.set(messageId, now);
    return false;
  }

  return {
    isDuplicateMessage,
  };
}

module.exports = {
  createMessageDedupe,
};
