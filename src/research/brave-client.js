'use strict';

// Cliente da Brave Search API. Recebe apenas consultas genéricas (sem dados pessoais)
// e devolve somente título, URL, trecho e idade do resultado.
function createBraveClient({ config, httpClient }) {
  const settings = config?.brave || {};
  const http = httpClient || require('axios');

  function isConfigured() {
    return Boolean(settings.apiKey && settings.url);
  }

  async function search(query, { timeoutMs = settings.timeoutMs || 5000 } = {}) {
    if (!isConfigured()) {
      const error = new Error('not_configured');

      error.code = 'not_configured';
      throw error;
    }

    try {
      const response = await http.get(settings.url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': settings.apiKey,
        },
        params: {
          count: settings.resultsPerQuery || 8,
          country: settings.country || 'BR',
          q: query,
          safesearch: 'strict',
          search_lang: settings.searchLang || 'pt-br',
        },
        timeout: timeoutMs,
      });

      return (response?.data?.web?.results || []).map((result) => ({
        age: result.page_age || result.age || null,
        description: String(result.description || ''),
        title: String(result.title || ''),
        url: String(result.url || ''),
      }));
    } catch (err) {
      const error = new Error(err?.code === 'ECONNABORTED' ? 'timeout' : `http_${err?.response?.status || 'erro'}`);

      error.code = err?.code === 'ECONNABORTED' ? 'timeout' : 'search_failed';
      throw error;
    }
  }

  return {
    isConfigured,
    search,
  };
}

module.exports = {
  createBraveClient,
};
