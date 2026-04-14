/**
 * constants.js — Shared application-wide constants.
 *
 * Imported (or loaded before) every portal controller.
 * No functions live here — pure data only.
 */

'use strict';

/* ── Category → emoji icon map ─────────────────────────────── */
const CAT_ICONS = Object.freeze({
  'Whole Birds':               '🐔',
  'Prime Cuts (Bone-In)':     '🍗',
  'Boneless & Skinless Cuts': '🥩',
  'Minced & Ground Poultry':  '🫙',
  'Giblets & Offal':          '🫀',
  'Ready-to-Cook & Processed':'🍢',
  'Specialty Poultry':        '🦆',
  'Eggs':                     '🥚',
});

/* ── Order status pipeline ──────────────────────────────────── */
const STATUS_FLOW = Object.freeze([
  'Pending',
  'Packed',
  'Out for Delivery',
  'Arrived at Location',
  'Completed',
  'Cancelled',
]);

/* ── Pricing model metadata ─────────────────────────────────── */
const PRICING_MODELS = Object.freeze({
  catch_weight: { label: 'Catch-weight',  unit: 'kg',    badgeClass: 'badge-model-catch', unitBadge: 'unit-badge-kg'    },
  fixed_pack:   { label: 'Fixed Pack',    unit: 'pack',  badgeClass: 'badge-model-pack',  unitBadge: 'unit-badge-pack'  },
  per_piece:    { label: 'Per Piece',     unit: 'piece', badgeClass: 'badge-model-piece', unitBadge: 'unit-badge-piece' },
});

/* ── Unit of measure → display suffix ──────────────────────── */
const UNIT_LABELS = Object.freeze({ kg: 'kg', pack: 'pack', piece: 'pc' });

/* ── Day-of-week labels ─────────────────────────────────────── */
const DAY_NAMES = Object.freeze(['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);

/* ── Low-stock threshold (kg) ───────────────────────────────── */
const LOW_STOCK_THRESHOLD = 5;

/* ── Cancellation poll interval (ms) ───────────────────────── */
const POLL_INTERVAL_MS = 30_000;