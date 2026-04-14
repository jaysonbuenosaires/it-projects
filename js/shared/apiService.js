/**
 * apiService.js — Centralized HTTP/JSON fetch wrapper.
 *
 * Provides factory functions that produce portal-specific GET and POST
 * helpers, each pre-configured with:
 *   • the portal's base URL
 *   • the caller-ID key (admin_id | staff_id | rider_id)
 *   • a session resolver callback
 *
 * Usage
 * ─────
 *   const { apiGet, apiPost, rawPost } = createApiService({
 *     baseUrl:      'api/admin_api.php',
 *     callerKey:    'admin_id',
 *     getCallerId:  () => adminState.user?.user_id ?? 0,
 *   });
 *
 * Alternatively the customer portal uses createSimpleApiFetch()
 * which returns a single fetch wrapper without caller-id injection.
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   CORE FETCH PRIMITIVE
═══════════════════════════════════════════════════════════════*/

/**
 * Raw fetch → JSON helper.  Returns a normalised response object on
 * any network failure (never throws).
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Object>}
 */
async function coreFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    return await res.json();
  } catch (e) {
    console.error('[PoultryMart] API Error:', e);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

/* ════════════════════════════════════════════════════════════
   PORTAL API SERVICE FACTORY
   Suitable for admin, fulfillment, and rider portals that
   always attach a caller-id to every request.
═══════════════════════════════════════════════════════════════*/

/**
 * Create a set of bound API helpers for a specific portal.
 *
 * @param {Object} config
 * @param {string}   config.baseUrl      - e.g. 'api/admin_api.php'
 * @param {string}   config.callerKey    - e.g. 'admin_id' | 'staff_id' | 'rider_id'
 * @param {Function} config.getCallerId  - zero-arg fn that returns current user id (int)
 * @returns {{ apiGet: Function, apiPost: Function, rawPost: Function }}
 */
function createApiService({ baseUrl, callerKey, getCallerId }) {
  /**
   * Issue a GET request to the portal API.
   *
   * @param {string} action
   * @param {Object} [params]  - additional URL params
   * @returns {Promise<Object>}
   */
  function apiGet(action, params = {}) {
    const q = new URLSearchParams({
      action,
      [callerKey]: getCallerId(),
      ...params,
    });
    return coreFetch(`${baseUrl}?${q}`);
  }

  /**
   * Issue a POST request to the portal API.
   *
   * @param {string} action
   * @param {Object} [body]  - JSON body (caller-id is merged in automatically)
   * @returns {Promise<Object>}
   */
  function apiPost(action, body = {}) {
    const q = new URLSearchParams({ action });
    return coreFetch(`${baseUrl}?${q}`, {
      method: 'POST',
      body:   JSON.stringify({ ...body, [callerKey]: getCallerId() }),
    });
  }

  /**
   * Issue a POST to the portal API using URLSearchParams-style routing.
   * Used by the fulfillment portal where action is in params, body is separate.
   *
   * @param {Object} params - URL params (must include action)
   * @param {Object} [body]
   * @returns {Promise<Object>}
   */
  function rawPost(params = {}, body = null) {
    const url = new URL(baseUrl, window.location.href);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set(callerKey, getCallerId());

    const opts = { headers: { 'Content-Type': 'application/json' } };
    if (body) {
      opts.method = 'POST';
      opts.body   = JSON.stringify({ ...body, [callerKey]: getCallerId() });
    }
    return coreFetch(url.toString(), opts);
  }

  return { apiGet, apiPost, rawPost };
}

/* ════════════════════════════════════════════════════════════
   SIMPLE API FETCH FACTORY
   Suitable for the customer portal: no automatic caller-id,
   returns a single apiFetch function.
═══════════════════════════════════════════════════════════════*/

/**
 * Create a simple fetch wrapper bound to a base URL.
 *
 * @param {string} baseUrl
 * @returns {{ apiFetch: Function, apiUrl: Function }}
 */
function createSimpleApiFetch(baseUrl) {
  /**
   * Build the full URL for an action.
   * @param {string} action
   * @returns {string}
   */
  function apiUrl(action) {
    return `${baseUrl}?action=${action}`;
  }

  /**
   * Fetch any URL with JSON handling.
   * @param {string}      url
   * @param {RequestInit} [options]
   * @returns {Promise<Object>}
   */
  function apiFetch(url, options = {}) {
    return coreFetch(url, options);
  }

  return { apiFetch, apiUrl };
}

/* ════════════════════════════════════════════════════════════
   ONE-TIME LOGIN FETCH
   Login requests must bypass caller-id injection (the user
   has no session yet).  All portals call this directly.
═══════════════════════════════════════════════════════════════*/

/**
 * POST login credentials to a portal API.
 *
 * @param {string} baseUrl
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Object>}
 */
function loginFetch(baseUrl, email, password) {
  return coreFetch(`${baseUrl}?action=login`, {
    method: 'POST',
    body:   JSON.stringify({ email, password }),
  });
}