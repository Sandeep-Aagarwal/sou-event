import { signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, addDoc, onSnapshot, updateDoc, deleteDoc, doc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  auth, db, $, isAdminEmail, escapeHtml, icons, formatDate, dateTile,
  formatPrice, formatDisplayName, toast, friendlyAuthError, emptyState, sortByDate
} from "./common.js";

let unsubscribers = [];
let latestEvents = [];
let latestRegistrations = [];
let html5QrInstance = null;
let activeScanMode = 'entry'; // 'entry' | 'swag' | 'lunch'

const authScreen = $('auth-screen');
const mainApp = $('main-app');
const scannerModal = $('scanner-modal');

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
    const maxSeats = Math.max(0, Number($('event-seats').value || 0));
    await addDoc(collection(db, "events"), {
      name: $('event-name').value.trim(),
      category: $('event-category').value,
      date: $('event-date').value,
      time: $('event-time').value.trim(),
      location: $('event-location').value.trim(),
      price,
      maxSeats,
      description: $('event-desc').value.trim(),
      hasSwag: $('event-has-swag').checked,
      hasLunch: $('event-has-lunch').checked,
      registrationClosed: false,
      createdAt: new Date()
    });
    form.reset();
    $('event-price').value = '0';
    $('event-seats').value = '0';
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
    'Enrollment ID',
    'Department',
    'Student Email',
    'Event Name',
    'Event Date',
    'Amount (INR)',
    'Payment Status',
    'UPI Transaction / UTR ID',
    'Attendance Status',
    'Swag Kit Status',
    'Lunch Coupon Status',
    'Certificate Issued'
  ];

  const rows = regsList.map(({ id, data: reg }) => {
    const payStatus = reg.paymentStatus || 'free';
    const studentName = formatDisplayName(reg.studentName, reg.userEmail);
    const swagStatus = reg.hasSwag ? (reg.swagClaimed ? 'Claimed' : 'Unclaimed') : 'N/A';
    const lunchStatus = reg.hasLunch ? (reg.lunchClaimed ? 'Redeemed' : 'Unclaimed') : 'N/A';

    return [
      id,
      studentName,
      reg.enrollment || 'N/A',
      reg.department || 'N/A',
      reg.userEmail,
      reg.eventName,
      reg.eventDate,
      Number(reg.amount || 0),
      getPaymentOutcomeLabel(payStatus),
      reg.utr || 'N/A',
      reg.attended ? 'Present' : 'Not Marked',
      swagStatus,
      lunchStatus,
      reg.attended ? 'Yes' : 'No'
    ].map(csvCell).join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  const safeName = fileLabel.replace(/[^a-z0-9]+/gi, '_');
  link.href = url;
  link.download = `SOU_Students_Payment_List_${safeName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast('Student payment & redemption list downloaded.', 'success');
}

$('download-all-csv-btn').addEventListener('click', () => {
  downloadStudentPaymentCsv(latestRegistrations, 'All_Events');
});

// ---------- KPI Summary Updater ----------
function updateKpis() {
  const activeRegs = latestRegistrations.filter((r) => r.data.paymentStatus !== 'rejected');
  const verifiedRevenue = latestRegistrations
    .filter((r) => r.data.paymentStatus === 'paid')
    .reduce((sum, r) => sum + Number(r.data.amount || 0), 0);
  const pendingCount = latestRegistrations.filter((r) => r.data.paymentStatus === 'pending').length;

  $('kpi-events').textContent = String(latestEvents.length);
  $('kpi-regs').textContent = String(activeRegs.length);
  $('kpi-revenue').textContent = `\u20B9${verifiedRevenue.toLocaleString('en-IN')}`;
  $('kpi-pending').textContent = String(pendingCount);
  $('kpi-pending-card').classList.toggle('kpi-alert', pendingCount > 0);
}

// ---------- Manage events ----------
function renderAdminDashboard() {
  const adminGrid = $('admin-events-grid');
  updateKpis();

  if (!latestEvents.length) {
    adminGrid.innerHTML = emptyState('No events created', 'Use the form above to create your first event.');
    return;
  }

  const searchTerm = ($('admin-attendee-search')?.value || '').trim().toLowerCase();
  const statusFilter = $('admin-status-filter')?.value || 'all';

  adminGrid.innerHTML = latestEvents.map(({ id, data: ev }) => {
    const allEventRegs = latestRegistrations.filter((r) => r.data.eventId === id);
    const activeCount = allEventRegs.filter((r) => r.data.paymentStatus !== 'rejected').length;
    const price = Number(ev.price || 0);
    const maxSeats = Number(ev.maxSeats || 0);
    const isPaid = price > 0;
    const isClosed = Boolean(ev.registrationClosed);

    const filteredRegs = allEventRegs.filter(({ data: reg }) => {
      const payStatus = reg.paymentStatus || 'free';
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'pending' && payStatus === 'pending') ||
        (statusFilter === 'confirmed' && (payStatus === 'paid' || payStatus === 'free')) ||
        (statusFilter === 'present' && Boolean(reg.attended));

      const matchesSearch = !searchTerm ||
        String(reg.studentName || '').toLowerCase().includes(searchTerm) ||
        String(reg.userEmail || '').toLowerCase().includes(searchTerm) ||
        String(reg.enrollment || '').toLowerCase().includes(searchTerm) ||
        String(reg.utr || '').toLowerCase().includes(searchTerm);

      return matchesStatus && matchesSearch;
    });

    const rows = filteredRegs.length
      ? filteredRegs.map(({ id: regId, data: reg }) => {
          const payStatus = reg.paymentStatus || 'free';
          const studentName = formatDisplayName(reg.studentName, reg.userEmail);
          const acadMeta = [reg.enrollment, reg.department].filter(Boolean).join(' • ');

          let payBadge = '';
          if (payStatus === 'paid') {
            payBadge = `<span class="mini-status status-paid-tag">Paid</span>`;
          } else if (payStatus === 'pending') {
            payBadge = `<span class="mini-status status-pending-tag">Pending UTR</span>`;
          } else if (payStatus === 'rejected') {
            payBadge = `<span class="mini-status status-rejected-tag">Rejected</span>`;
          } else {
            payBadge = `<span class="mini-status status-free-tag">Free</span>`;
          }

          // Swag & Lunch quick-toggle pills for confirmed attendees
          const perkControls = [];
          if (payStatus === 'paid' || payStatus === 'free') {
            if (ev.hasSwag || reg.hasSwag) {
              perkControls.push(`
                <button type="button" class="mini-toggle ${reg.swagClaimed ? 'is-claimed' : ''}"
                  data-action="toggle-swag" data-id="${escapeHtml(regId)}" data-claimed="${Boolean(reg.swagClaimed)}">
                  ${reg.swagClaimed ? 'Swag ✓' : 'Swag'}
                </button>`);
            }
            if (ev.hasLunch || reg.hasLunch) {
              perkControls.push(`
                <button type="button" class="mini-toggle ${reg.lunchClaimed ? 'is-claimed' : ''}"
                  data-action="toggle-lunch" data-id="${escapeHtml(regId)}" data-claimed="${Boolean(reg.lunchClaimed)}">
                  ${reg.lunchClaimed ? 'Lunch ✓' : 'Lunch'}
                </button>`);
            }
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
          } else {
            const attendCtrl = reg.attended
              ? `<span class="status-present">Present ✓</span>`
              : `<button class="btn btn-primary btn-xs" data-action="attend" data-id="${escapeHtml(regId)}">Mark present</button>`;
            rightControls = `<div class="admin-actions-inline">${perkControls.join('')}${attendCtrl}</div>`;
          }

          const subInfo = reg.utr
            ? `<div class="utr-sub">${escapeHtml(reg.userEmail)} • UTR: <code>${escapeHtml(reg.utr)}</code> (${formatPrice(reg.amount)}) • ${payBadge}</div>`
            : `<div class="utr-sub">${escapeHtml(reg.userEmail)} • ${payBadge}</div>`;

          return `
            <div class="attendee-row">
              <div class="attendee-info">
                <span class="attendee-email"><strong>${escapeHtml(studentName)}</strong>${acadMeta ? ` <span class="muted text-xs">(${escapeHtml(acadMeta)})</span>` : ''}</span>
                ${subInfo}
              </div>
              ${rightControls}
            </div>`;
        }).join('')
      : `<div class="empty-inline">${allEventRegs.length ? 'No attendees match current filter.' : 'No registrations yet.'}</div>`;

    const capacityText = maxSeats > 0 ? `${activeCount} / ${maxSeats} seats` : `${activeCount} registered`;
    const perkSummary = [
      ev.hasSwag ? 'Swag Kit' : '',
      ev.hasLunch ? 'Lunch Coupon' : ''
    ].filter(Boolean).join(' • ');

    return `
      <article class="card event-card">
        <div class="event-top">
          ${dateTile(ev.date)}
          <div class="event-meta">
            <div class="event-title-row">
              <h3>${escapeHtml(ev.name)}</h3>
              <span class="price-pill ${isPaid ? 'price-paid' : 'price-free'}">${formatPrice(price)}</span>
            </div>
            <div class="meta-line">${icons.calendar}<span>${formatDate(ev.date)}${ev.time ? ` • ${escapeHtml(ev.time)}` : ''}</span></div>
            <div class="meta-line">${icons.pin}<span>${escapeHtml(ev.location)}</span></div>
            ${perkSummary ? `<div class="meta-line text-perk">${icons.gift}<span>Coupons: ${perkSummary}</span></div>` : ''}
          </div>
        </div>
        <div class="admin-event-controls">
          <button type="button" class="btn btn-ghost btn-xs" data-action="toggle-close" data-id="${escapeHtml(id)}" data-closed="${isClosed}">
            ${isClosed ? 'Reopen Reg' : 'Close Reg'}
          </button>
          <button type="button" class="btn btn-ghost btn-xs text-danger" data-action="delete-event" data-id="${escapeHtml(id)}" data-name="${escapeHtml(ev.name)}">
            Delete
          </button>
        </div>
        <div>
          <div class="attendee-header-row">
            <div class="attendee-title">Students (${capacityText})</div>
            ${allEventRegs.length
              ? `<button type="button" class="btn btn-ghost btn-xs" data-action="export-event" data-id="${escapeHtml(id)}" data-name="${escapeHtml(ev.name)}">
                   ${icons.download} Export List
                 </button>`
              : ''}
          </div>
          <div class="attendee-list">${rows}</div>
        </div>
      </article>`;
  }).join('');
}

$('admin-attendee-search')?.addEventListener('input', renderAdminDashboard);
$('admin-status-filter')?.addEventListener('change', renderAdminDashboard);

function loadAdminData() {
  const adminGrid = $('admin-events-grid');
  adminGrid.innerHTML = emptyState('Loading events…', '');

  unsubscribers.push(onSnapshot(collection(db, "events"), (snap) => {
    latestEvents = sortByDate(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    renderAdminDashboard();
  }, (error) => {
    console.error("Events snapshot error:", error);
    adminGrid.innerHTML = emptyState('Could not load events', 'Check your connection or Firestore rules and refresh.');
  }));

  unsubscribers.push(onSnapshot(collection(db, "registrations"), (snap) => {
    latestRegistrations = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    renderAdminDashboard();
  }, (error) => {
    console.error("Registrations snapshot error:", error);
    if (error.code === 'permission-denied') {
      toast('Firestore permission denied for admin. Please publish the updated firestore.rules.', 'error');
    }
  }));
}

// ---------- Multi-Mode QR Scanner Logic (Gate Entry | Swag Kit | Lunch Coupon) ----------
document.querySelectorAll('[data-scan-mode]').forEach((tab) => {
  tab.addEventListener('click', () => {
    activeScanMode = tab.dataset.scanMode;
    document.querySelectorAll('[data-scan-mode]').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('scan-result-banner').classList.add('hidden');
  });
});

async function processQrScan(passId) {
  const cleanId = String(passId || '').trim();
  const banner = $('scan-result-banner');
  if (!cleanId) return;

  banner.className = 'scan-result';
  banner.textContent = 'Checking pass…';
  banner.classList.remove('hidden');

  try {
    const regRef = doc(db, "registrations", cleanId);
    const snap = await getDoc(regRef);

    if (!snap.exists()) {
      banner.className = 'scan-result scan-error';
      banner.innerHTML = `<strong>Invalid Pass!</strong> No registration found for ID <code>${escapeHtml(cleanId)}</code>.`;
      return;
    }

    const reg = snap.data();
    const studentName = formatDisplayName(reg.studentName, reg.userEmail);
    const ev = latestEvents.find((e) => e.id === reg.eventId)?.data || {};

    if (reg.paymentStatus === 'pending') {
      banner.className = 'scan-result scan-warn';
      banner.innerHTML = `<strong>Payment Pending!</strong> ${escapeHtml(studentName)} (${escapeHtml(reg.eventName)}) is awaiting UPI verification.`;
      return;
    }

    if (reg.paymentStatus === 'rejected') {
      banner.className = 'scan-result scan-error';
      banner.innerHTML = `<strong>Payment Rejected!</strong> Pass invalid for ${escapeHtml(studentName)}.`;
      return;
    }

    // Mode 1: Gate Entry
    if (activeScanMode === 'entry') {
      if (reg.attended) {
        banner.className = 'scan-result scan-warn';
        banner.innerHTML = `<strong>Already Checked In!</strong> ${escapeHtml(studentName)} already entered <em>${escapeHtml(reg.eventName)}</em>.`;
        return;
      }
      await updateDoc(regRef, { attended: true, checkedInAt: new Date() });
      banner.className = 'scan-result scan-success';
      banner.innerHTML = `<strong>Gate Entry Approved ✓</strong> Welcome <strong>${escapeHtml(studentName)}</strong> to <em>${escapeHtml(reg.eventName)}</em>!`;
      toast(`Gate check-in: ${studentName}`, 'success');
      return;
    }

    // Mode 2: Swag Kit Redemption
    if (activeScanMode === 'swag') {
      const eligible = Boolean(ev.hasSwag || reg.hasSwag);
      if (!eligible) {
        banner.className = 'scan-result scan-error';
        banner.innerHTML = `<strong>Not Included!</strong> <em>${escapeHtml(reg.eventName)}</em> does not include a Swag Kit.`;
        return;
      }
      if (reg.swagClaimed) {
        banner.className = 'scan-result scan-warn';
        banner.innerHTML = `<strong>Already Claimed!</strong> ${escapeHtml(studentName)} already collected their Swag Kit.`;
        return;
      }
      await updateDoc(regRef, { swagClaimed: true, swagClaimedAt: new Date() });
      banner.className = 'scan-result scan-success';
      banner.innerHTML = `<strong>Swag Kit Issued ✓</strong> Hand kit to <strong>${escapeHtml(studentName)}</strong> (${escapeHtml(reg.eventName)}).`;
      toast(`Swag issued to ${studentName}`, 'success');
      return;
    }

    // Mode 3: Lunch Coupon Redemption
    if (activeScanMode === 'lunch') {
      const eligible = Boolean(ev.hasLunch || reg.hasLunch);
      if (!eligible) {
        banner.className = 'scan-result scan-error';
        banner.innerHTML = `<strong>No Meal Coupon!</strong> <em>${escapeHtml(reg.eventName)}</em> does not include a Lunch Coupon.`;
        return;
      }
      if (reg.lunchClaimed) {
        banner.className = 'scan-result scan-warn';
        banner.innerHTML = `<strong>Coupon Already Used!</strong> ${escapeHtml(studentName)} already redeemed their Lunch Coupon.`;
        return;
      }
      await updateDoc(regRef, { lunchClaimed: true, lunchClaimedAt: new Date() });
      banner.className = 'scan-result scan-success';
      banner.innerHTML = `<strong>Lunch Coupon Redeemed ✓</strong> Valid meal for <strong>${escapeHtml(studentName)}</strong> (${escapeHtml(reg.eventName)}).`;
      toast(`Lunch redeemed: ${studentName}`, 'success');
    }
  } catch (err) {
    console.error(err);
    banner.className = 'scan-result scan-error';
    banner.textContent = 'Error verifying pass. Check connection and try again.';
  }
}

function openScannerModal() {
  $('scan-result-banner').classList.add('hidden');
  $('manual-pass-id').value = '';
  scannerModal.classList.remove('hidden');

  if (window.Html5Qrcode) {
    html5QrInstance = new window.Html5Qrcode("qr-reader");
    let lastScanned = '';
    html5QrInstance.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        if (decodedText !== lastScanned) {
          lastScanned = decodedText;
          processQrScan(decodedText);
          setTimeout(() => { lastScanned = ''; }, 3000);
        }
      },
      () => {}
    ).catch((err) => {
      console.warn("Camera unavailable:", err);
      $('qr-reader').innerHTML = `<div class="empty-inline" style="padding:1rem;text-align:center;">Camera unavailable or permission denied. Use manual Pass ID entry below.</div>`;
    });
  } else {
    $('qr-reader').innerHTML = `<div class="empty-inline" style="padding:1rem;text-align:center;">QR Scanner library loading… You can use manual Pass ID entry below.</div>`;
  }
}

async function closeScannerModal() {
  scannerModal.classList.add('hidden');
  if (html5QrInstance) {
    try {
      await html5QrInstance.stop();
      html5QrInstance.clear();
    } catch {}
    html5QrInstance = null;
  }
}

$('open-scanner-btn').addEventListener('click', openScannerModal);
$('scanner-close-btn').addEventListener('click', closeScannerModal);
scannerModal.addEventListener('click', (e) => {
  if (e.target === scannerModal) closeScannerModal();
});

$('manual-checkin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  processQrScan($('manual-pass-id').value);
  $('manual-pass-id').value = '';
});

// ---------- Card Button Actions ----------
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name, closed, claimed } = btn.dataset;

  if (action === 'export-event') {
    const eventRegs = latestRegistrations.filter((r) => r.data.eventId === id);
    downloadStudentPaymentCsv(eventRegs, name || id);
    return;
  }

  if (action === 'toggle-swag') {
    btn.disabled = true;
    const nextState = claimed !== 'true';
    try {
      await updateDoc(doc(db, "registrations", id), { swagClaimed: nextState });
      toast(nextState ? 'Marked Swag Kit as claimed.' : 'Swag Kit reset to available.', 'success');
    } catch (error) {
      console.error(error);
      toast('Could not update Swag Kit status.', 'error');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === 'toggle-lunch') {
    btn.disabled = true;
    const nextState = claimed !== 'true';
    try {
      await updateDoc(doc(db, "registrations", id), { lunchClaimed: nextState });
      toast(nextState ? 'Marked Lunch Coupon as redeemed.' : 'Lunch Coupon reset to available.', 'success');
    } catch (error) {
      console.error(error);
      toast('Could not update Lunch Coupon status.', 'error');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === 'toggle-close') {
    btn.disabled = true;
    const nextState = closed !== 'true';
    try {
      await updateDoc(doc(db, "events", id), { registrationClosed: nextState });
      toast(nextState ? 'Registrations closed for this event.' : 'Registrations reopened.', 'success');
    } catch (error) {
      console.error(error);
      toast('Could not update event status.', 'error');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  if (action === 'delete-event') {
    if (!confirm(`Delete "${name}"? Existing student registrations will remain in the database.`)) return;
    btn.disabled = true;
    try {
      await deleteDoc(doc(db, "events", id));
      toast('Event deleted.', 'success');
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      toast('Could not delete event.', 'error');
    }
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
      toast('Payment approved. Student QR pass & coupons unlocked.', 'success');
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
