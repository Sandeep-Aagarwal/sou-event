import { signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, addDoc, onSnapshot, updateDoc, doc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  auth, db, $, isAdminEmail, escapeHtml, icons, formatDate, dateTile,
  formatPrice, formatDisplayName, toast, friendlyAuthError, emptyState, sortByDate
} from "./common.js";

let unsubscribers = [];
let latestEvents = [];
let latestRegistrations = [];

const authScreen = $('auth-screen');
const mainApp = $('main-app');

function stopListeners() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
}

function showNotice(text) {
  const el = $('auth-notice');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

// ---------- Auth: only special admin emails get in ----------
onAuthStateChanged(auth, (user) => {
  stopListeners();
  if (user && isAdminEmail(user.email)) {
    showNotice('');
    $('user-display').textContent = user.email;
    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    loadAdminData();
  } else {
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
    showNotice(user ? 'You are signed in with a student account, which cannot open the admin panel. Sign in below with an admin account.' : '');
  }
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('auth-email').value.trim();
  const pass = $('auth-password').value;
  const errorDiv = $('auth-error');
  const btn = $('auth-btn');
  errorDiv.textContent = '';

  if (!isAdminEmail(email)) {
    errorDiv.textContent = 'This email is not authorised for admin access.';
    return;
  }

  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    e.target.reset();
  } catch (error) {
    console.error("Admin login error:", error);
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') {
      errorDiv.textContent = 'Invalid password, or admin@silveroakcollege.edu has not been created in Firebase Authentication > Users yet.';
    } else if (error.code === 'auth/operation-not-allowed') {
      errorDiv.textContent = 'Enable Email/Password sign-in in Firebase Console > Authentication > Sign-in method.';
    } else {
      errorDiv.textContent = `${friendlyAuthError(error)} (${error.code || 'error'})`;
    }
  } finally {
    btn.disabled = false;
  }
});

$('nav-logout').addEventListener('click', () => signOut(auth));

// ---------- Create event ----------
$('create-event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = $('create-event-btn');
  btn.disabled = true;
  try {
    const price = Math.max(0, Number($('event-price').value || 0));
    await addDoc(collection(db, "events"), {
      name: $('event-name').value.trim(),
      date: $('event-date').value,
      location: $('event-location').value.trim(),
      price,
      createdAt: new Date()
    });
    form.reset();
    $('event-price').value = '0';
    toast('Event created.', 'success');
  } catch (error) {
    console.error("Error adding event:", error);
    const msg = error.code === 'permission-denied'
      ? 'Permission denied: Publish the updated firestore.rules in Firebase Console.'
      : 'Could not create the event. Please try again.';
    toast(msg, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ---------- CSV Download Helper ----------
function csvCell(val) {
  const s = String(val ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function getPaymentOutcomeLabel(payStatus) {
  if (payStatus === 'paid') return 'Payment Successful';
  if (payStatus === 'free') return 'Free Event (Confirmed)';
  if (payStatus === 'pending') return 'Pending Verification';
  if (payStatus === 'rejected') return 'Payment Failed / Rejected';
  return 'Confirmed';
}

function downloadStudentPaymentCsv(regsList, fileLabel) {
  if (!regsList.length) {
    toast('No student registrations to export.', 'error');
    return;
  }

  const headers = [
    'Registration ID',
    'Student Name',
    'Student Email',
    'Event Name',
    'Event Date',
    'Amount (INR)',
    'Payment Status',
    'UPI Transaction / UTR ID',
    'Attendance Status',
    'Certificate Issued'
  ];

  const rows = regsList.map(({ id, data: reg }) => {
    const payStatus = reg.paymentStatus || 'free';
    const studentName = formatDisplayName(reg.studentName, reg.userEmail);
    return [
      id,
      studentName,
      reg.userEmail,
      reg.eventName,
      reg.eventDate,
      Number(reg.amount || 0),
      getPaymentOutcomeLabel(payStatus),
      reg.utr || 'N/A',
      reg.attended ? 'Present' : 'Not Marked',
      reg.attended ? 'Yes' : 'No'
    ].map(csvCell).join(',');
  });

  const csvContent = '﻿' + [headers.map(csvCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  const safeName = fileLabel.replace(/[^a-z0-9]+/gi, '_');
  link.href = url;
  link.download = `SOU_Students_Payment_List_${safeName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Student payment list downloaded.', 'success');
}

$('download-all-csv-btn').addEventListener('click', () => {
  downloadStudentPaymentCsv(latestRegistrations, 'All_Events');
});

// ---------- Manage events ----------
function loadAdminData() {
  const adminGrid = $('admin-events-grid');
  adminGrid.innerHTML = emptyState('Loading events…', '');

  const render = () => {
    if (!latestEvents.length) {
      adminGrid.innerHTML = emptyState('No events created', 'Use the form above to create your first event.');
      return;
    }
    adminGrid.innerHTML = latestEvents.map(({ id, data: ev }) => {
      const regs = latestRegistrations.filter((r) => r.data.eventId === id);
      const price = Number(ev.price || 0);
      const isPaid = price > 0;

      const rows = regs.length
        ? regs.map(({ id: regId, data: reg }) => {
            const payStatus = reg.paymentStatus || 'free';
            const studentName = formatDisplayName(reg.studentName, reg.userEmail);

            let payBadge = '';
            if (payStatus === 'paid') {
              payBadge = `<span class="mini-status status-paid-tag">Payment Successful</span>`;
            } else if (payStatus === 'pending') {
              payBadge = `<span class="mini-status status-pending-tag">Pending Verification</span>`;
            } else if (payStatus === 'rejected') {
              payBadge = `<span class="mini-status status-rejected-tag">Payment Unsuccessful</span>`;
            } else {
              payBadge = `<span class="mini-status status-free-tag">Free Entry</span>`;
            }

            let rightControls = '';
            if (payStatus === 'pending') {
              rightControls = `
                <div class="admin-actions-inline">
                  <button class="btn btn-success btn-sm" data-action="approve-pay" data-id="${escapeHtml(regId)}">Approve</button>
                  <button class="btn btn-danger btn-sm" data-action="reject-pay" data-id="${escapeHtml(regId)}">Reject</button>
                </div>`;
            } else if (payStatus === 'rejected') {
              rightControls = `<span class="status-rejected">Rejected</span>`;
            } else if (reg.attended) {
              rightControls = `<span class="status-present">Present</span>`;
            } else {
              rightControls = `<button class="btn btn-primary btn-sm" data-action="attend" data-id="${escapeHtml(regId)}">Mark present</button>`;
            }

            const subInfo = reg.utr
              ? `<div class="utr-sub">${escapeHtml(reg.userEmail)} • UTR: <code>${escapeHtml(reg.utr)}</code> (${formatPrice(reg.amount)}) • ${payBadge}</div>`
              : `<div class="utr-sub">${escapeHtml(reg.userEmail)} • ${payBadge}</div>`;

            return `
              <div class="attendee-row">
                <div class="attendee-info">
                  <span class="attendee-email"><strong>${escapeHtml(studentName)}</strong></span>
                  ${subInfo}
                </div>
                ${rightControls}
              </div>`;
          }).join('')
        : `<div class="empty-inline">No registrations yet.</div>`;

      return `
        <article class="card event-card">
          <div class="event-top">
            ${dateTile(ev.date)}
            <div class="event-meta">
              <div class="event-title-row">
                <h3>${escapeHtml(ev.name)}</h3>
                <span class="price-pill ${isPaid ? 'price-paid' : 'price-free'}">${formatPrice(price)}</span>
              </div>
              <div class="meta-line">${icons.calendar}<span>${formatDate(ev.date)}</span></div>
              <div class="meta-line">${icons.pin}<span>${escapeHtml(ev.location)}</span></div>
            </div>
          </div>
          <div>
            <div class="attendee-header-row">
              <div class="attendee-title">Registered students (${regs.length})</div>
              ${regs.length
                ? `<button type="button" class="btn btn-ghost btn-xs" data-action="export-event" data-id="${escapeHtml(id)}" data-name="${escapeHtml(ev.name)}">
                     ${icons.download} Export List
                   </button>`
                : ''}
            </div>
            <div class="attendee-list">${rows}</div>
          </div>
        </article>`;
    }).join('');
  };

  unsubscribers.push(onSnapshot(collection(db, "events"), (snap) => {
    latestEvents = sortByDate(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    render();
  }, (error) => {
    console.error("Events snapshot error:", error);
    adminGrid.innerHTML = emptyState('Could not load events', 'Check your connection or Firestore rules and refresh.');
  }));

  unsubscribers.push(onSnapshot(collection(db, "registrations"), (snap) => {
    latestRegistrations = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    render();
  }, (error) => {
    console.error("Registrations snapshot error:", error);
    if (error.code === 'permission-denied') {
      toast('Firestore permission denied for admin. Please publish the updated firestore.rules.', 'error');
    }
  }));
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name } = btn.dataset;

  if (action === 'export-event') {
    const eventRegs = latestRegistrations.filter((r) => r.data.eventId === id);
    downloadStudentPaymentCsv(eventRegs, name || id);
    return;
  }

  if (action === 'attend') {
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "registrations", id), { attended: true });
      toast('Attendance recorded. Student can now download their certificate.', 'success');
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      toast('Could not update attendance. Please try again.', 'error');
    }
  }

  if (action === 'approve-pay') {
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "registrations", id), { paymentStatus: 'paid' });
      toast('Payment approved. Student entry pass unlocked.', 'success');
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      toast('Could not approve payment.', 'error');
    }
  }

  if (action === 'reject-pay') {
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "registrations", id), { paymentStatus: 'rejected' });
      toast('Payment rejected.', 'error');
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      toast('Could not reject payment.', 'error');
    }
  }
});
