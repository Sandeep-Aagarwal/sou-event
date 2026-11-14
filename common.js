import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Replace with your Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyAhLpQWAbq3iAD34fKguzFH57tCiLONxyM",
  authDomain: "collegeevents-58a9c.firebaseapp.com",
  projectId: "collegeevents-58a9c",
  storageBucket: "collegeevents-58a9c.firebasestorage.app",
  messagingSenderId: "355429436152",
  appId: "1:355429436152:web:22dbb6fbd2fe2553ca890d",
  measurementId: "G-51M0X4J95P",
};

// Special admin emails. Only these accounts can use admin.html.
// Keep this list in sync with firestore.rules.
export const ADMIN_EMAILS = ["admin@silveroakcollege.edu"];

// Configure your College/Club UPI details for paid events
export const UPI_CONFIG = {
  upiId: "sandy0401@ptyes",          // Your UPI ID
  payeeName: "Silver Oak University",// Display name in UPI apps
  qrImageUrl: "./images/upi-qr.png"  // Optional: place your static QR image here (falls back to auto-generated QR)
};

export const isAdminEmail = (email) =>
  ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(String(email || "").trim().toLowerCase());

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---------- Shared helpers ----------
export const $ = (id) => document.getElementById(id);

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const icons = {
  calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  users: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  gift: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>'
};

export function formatPrice(price) {
  const num = Number(price || 0);
  return num > 0 ? `\u20B9${num}` : 'Free';
}

export function buildUpiUri(amount, note = 'Event Registration') {
  const params = new URLSearchParams({
    pa: UPI_CONFIG.upiId,
    pn: UPI_CONFIG.payeeName,
    am: String(Number(amount || 0).toFixed(2)),
    cu: 'INR',
    tn: note.slice(0, 40)
  });
  return `upi://pay?${params.toString()}`;
}

export function getQrImageUrl(data, size = 180) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

export function formatDisplayName(studentName, email) {
  if (studentName && String(studentName).trim()) return String(studentName).trim();
  const prefix = String(email || '').split('@')[0] || 'Student';
  return prefix
    .replace(/[._-]+/g, ' ')
    .replace(/ \w/g, (c) => c.toUpperCase());
}

function parseDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

export function formatDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : escapeHtml(value);
}

export function formatLongDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : String(value || '');
}

export function dateTile(value) {
  const d = parseDate(value);
  if (!d) return '';
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  return `<div class="date-tile" aria-hidden="true"><div class="month">${escapeHtml(month.toUpperCase())}</div><div class="day">${d.getDate()}</div></div>`;
}

export function isPastDate(value) {
  const d = parseDate(value);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  $('toast-region').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export function friendlyAuthError(error) {
  const map = {
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  return map[error.code] || 'Something went wrong. Please try again.';
}

export const emptyState = (title, text) =>
  `<div class="empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`;

export const sortByDate = (list) =>
  list.sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)));
