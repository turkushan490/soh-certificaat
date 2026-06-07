/* =============================================================================
 * storage.js — opslag-abstractie
 * -----------------------------------------------------------------------------
 * Fase 1 (offline): bewaart records in localStorage van de browser.
 * Fase 3 (online):  zelfde interface, dan ingevuld met Firebase Firestore.
 *
 * Interface:
 *   Storage.list()            -> Promise<[record]>
 *   Storage.add(record)       -> Promise<record (met id)>
 *   Storage.remove(id)        -> Promise<void>
 *   Storage.mode              -> 'offline' | 'firebase'
 * ========================================================================== */
(function (global) {
  'use strict';

  const KEY = 'soh_records_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function save(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

  const LocalStorageBackend = {
    mode: 'offline',
    async list() {
      return load().sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    },
    async add(record) {
      const arr = load();
      record.id = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      record.uploaded_at = new Date().toISOString();
      arr.push(record);
      save(arr);
      return record;
    },
    async remove(id) {
      save(load().filter(r => r.id !== id));
    },
  };

  // Later: als window.FIREBASE_BACKEND wordt geïnjecteerd, gebruik die.
  global.Storage = global.FIREBASE_BACKEND || LocalStorageBackend;
})(typeof window !== 'undefined' ? window : globalThis);
