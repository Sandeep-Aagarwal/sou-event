import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, addDoc, onSnapshot, query, where, doc, setDoc, getDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  auth, db, $, isAdminEmail, escapeHtml, icons, formatDate, formatLongDate, dateTile,
  formatPrice, formatDisplayName, buildUpiUri, UPI_CONFIG, toast, friendlyAuthError, emptyState, sortByDate
} from "./common.js";

let isLoginMode = true;
let currentUser = null;
let currentStudentName = '';
let unsubscribers = [];
let userRegistrationsMap = new Map(); // eventId -> registration data
let allRegistrationsById = new Map(); // regId -> registration data
let eventsById = new Map();           // eventId -> event data
let pendingPaymentEvent = null;
let activeCertData = null;

const authScreen = $('auth-screen');
const mainApp = $('main-app');
const paymentModal = $('payment-modal');
const certModal = $('cert-modal');

function stopListeners() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
}

function showNotice(text) {
  const el = $('auth-notice');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function applyStudentNameToUI(name, email) {
  currentStudentName = name;
  $('user-display').textContent = `${name} (${email})`;
  const greetingEl = $('student-greeting-name');
  if (greetingEl) greetingEl.textContent = name;
}

// ---------- Auth ----------
onAuthStateChanged(auth, async (user) => {
  stopListeners();
  if (user && isAdminEmail(user.email)) {
    currentUser = null;
    currentStudentName = '';
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
    showNotice('You are signed in with an admin account. Use the admin login, or sign in below with a student account.');
  } else if (user) {
    currentUser = user;
    showNotice('');

    // Resolve student's registered name from Auth profile or Firestore users/{uid}
    let resolvedName = user.displayName || '';
    if (!resolvedName) {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data().fullName) {
          resolvedName = userSnap.data().fullName;
        }
      } catch (err) {
        console.warn("Could not fetch user profile:", err);
      }
    }
    const finalName = formatDisplayName(resolvedName, user.email);
    applyStudentNameToUI(finalName, user.email);

    authScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    loadStudentData();
  } else {
    currentUser = null;
    currentStudentName = '';
    userRegistrationsMap = new Map();
    allRegistrationsById = new Map();
    authScreen.classList.remove('hidden');
    mainApp.classList.add('hidden');
  }
});

$('auth-toggle').addEventListener('click', () => {
  isLoginMode = !isLoginMode;
  $('auth-title').textContent = isLoginMode ? 'Student sign in' : 'Create student account';
  $('auth-sub').textContent = isLoginMode ? 'Use your college email to continue.' : 'Enter your name and college email to get started.';
  $('auth-btn').textContent = isLoginMode ? 'Sign in' : 'Create account';
  $('auth-toggle-text').textContent = isLoginMode ? 'New here?' : 'Already registered?';
  $('auth-toggle').textContent = isLoginMode ? 'Create an account' : 'Sign in';
  $('auth-password').autocomplete = isLoginMode ? 'current-password' : 'new-password';
  $('auth-name-field').classList.toggle('hidden', isLoginMode);
  $('auth-name').required = !isLoginMode;
  $('auth-error').textContent = '';
  if (!isLoginMode) $('auth-name').focus();
});

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fullName = $('auth-name').value.trim();
  const email = $('auth-email').value.trim();
  const pass = $('auth-password').value;
  const errorDiv = $('auth-error');
  const btn = $('auth-btn');
  errorDiv.textContent = '';

  if (isAdminEmail(email)) {
    errorDiv.textContent = 'This email is reserved for administrators. Use the admin login instead.';
    return;
  }

  if (!isLoginMode && fullName.length < 2) {
    errorDiv.textContent = 'Please enter your full name.';
    return;
  }

  btn.disabled = true;
  try {
    if (isLoginMode) {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: fullName });
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          fullName,
          email,
          createdAt: new Date()
        });
      } catch (profileErr) {
        console.warn("Could not save user doc:", profileErr);
      }
      applyStudentNameToUI(fullName, email);
    }
    e.target.reset();
  } catch (error) {
    errorDiv.textContent = friendlyAuthError(error);
  } finally {
    btn.disabled = false;
  }
});

$('nav-logout').addEventListener('click', () => signOut(auth));

// ---------- Student data ----------
function loadStudentData() {
  const eventsGrid = $('events-grid');
  const passesGrid = $('passes-grid');
  eventsGrid.innerHTML = emptyState('Loading events…', '');
  passesGrid.innerHTML = emptyState('Loading your passes…', '');

  let latestEvents = [];

  const renderEvents = () => {
    if (!latestEvents.length) {
      eventsGrid.innerHTML = emptyState('No events yet', 'New events will appear here once they are published.');
      return;
    }
    eventsGrid.innerHTML = latestEvents.map(({ id, data: ev }) => {
      const reg = userRegistrationsMap.get(id);
      const price = Number(ev.price || 0);
      const isPaid = price > 0;

      let actionButton = '';
      if (reg) {
        if (reg.paymentStatus === 'pending') {
          actionButton = `<button class="btn btn-warning btn-block" disabled>Payment Pending Verification</button>`;
        } else if (reg.paymentStatus === 'rejected') {
          actionButton = `<button class="btn btn-primary btn-block" data-action="register"
            data-id="${escapeHtml(id)}" data-name="${escapeHtml(ev.name)}" data-date="${escapeHtml(ev.date)}" data-price="${price}">
            Payment Rejected — Retry (${formatPrice(price)})
          </button>`;
        } else {
          actionButton = `<button class="btn btn-ghost btn-block" disabled>Registered</button>`;
        }
      } else {
        actionButton = `<button class="btn btn-primary btn-block" data-action="register"
          data-id="${escapeHtml(id)}" data-name="${escapeHtml(ev.name)}" data-date="${escapeHtml(ev.date)}" data-price="${price}">
          ${isPaid ? `Pay ${formatPrice(price)} & Register` : 'Register (Free)'}
        </button>`;
      }

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
          <div class="card-footer">
            ${actionButton}
          </div>
        </article>`;
    }).join('');
  };

  unsubscribers.push(onSnapshot(collection(db, "events"), (snapshot) => {
    eventsById = new Map();
    latestEvents = sortByDate(snapshot.docs.map((d) => {
      eventsById.set(d.id, d.data());
      return { id: d.id, data: d.data() };
    }));
    renderEvents();
  }, (error) => {
    console.error(error);
    eventsGrid.innerHTML = emptyState('Could not load events', 'Check your connection and refresh the page.');
  }));

  const q = query(collection(db, "registrations"), where("userId", "==", currentUser.uid));
  unsubscribers.push(onSnapshot(q, (snapshot) => {
    userRegistrationsMap = new Map();
    allRegistrationsById = new Map();

    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      allRegistrationsById.set(docSnap.id, data);
      const existing = userRegistrationsMap.get(data.eventId);
      if (!existing || existing.paymentStatus === 'rejected') {
        userRegistrationsMap.set(data.eventId, data);
      }
    });
    renderEvents();

    if (snapshot.empty) {
      passesGrid.innerHTML = emptyState('No passes yet', 'Register for an event above to receive your entry pass.');
      return;
    }

    passesGrid.innerHTML = snapshot.docs.map((docSnap) => {
      const reg = docSnap.data();
      const status = reg.paymentStatus || 'free';
      const holderName = currentStudentName || formatDisplayName(reg.studentName, reg.userEmail);

      if (status === 'pending') {
        return `
          <article class="card pass-card is-pending">
            <span class="badge badge-pending">Payment verifying</span>
            <h3>${escapeHtml(reg.eventName)}</h3>
            <div class="meta-line">${icons.calendar}<span>${formatDate(reg.eventDate)}</span></div>
            <div class="pass-holder">Issued to: <strong>${escapeHtml(holderName)}</strong></div>
            <div class="pass-code">
              Submitted UTR (${formatPrice(reg.amount)})
              <strong>${escapeHtml(reg.utr || '—')}</strong>
            </div>
            <p class="pass-hint">Your entry pass will unlock once the admin verifies your payment.</p>
          </article>`;
      }

      if (status === 'rejected') {
        return `
          <article class="card pass-card is-rejected">
            <span class="badge badge-rejected">Payment rejected</span>
            <h3>${escapeHtml(reg.eventName)}</h3>
            <div class="meta-line">${icons.calendar}<span>${formatDate(reg.eventDate)}</span></div>
            <div class="pass-holder">Issued to: <strong>${escapeHtml(holderName)}</strong></div>
            <div class="pass-code">
              Rejected UTR (${formatPrice(reg.amount)})
              <strong>${escapeHtml(reg.utr || '—')}</strong>
            </div>
            <p class="pass-hint">Payment could not be verified. Please register again with a valid UTR.</p>
          </article>`;
      }

      return `
        <article class="card pass-card ${reg.attended ? 'is-complete' : ''}">
          <span class="badge ${reg.attended ? 'badge-done' : 'badge-pass'}">${reg.attended ? 'Certificate issued' : 'Entry pass'}</span>
          <h3>${escapeHtml(reg.eventName)}</h3>
          <div class="meta-line">${icons.calendar}<span>${formatDate(reg.eventDate)}</span></div>
          <div class="pass-holder">Issued to: <strong>${escapeHtml(holderName)}</strong></div>
          <div class="pass-code">
            ${reg.attended ? 'Certificate ID' : 'Pass code'}
            <strong>${escapeHtml(docSnap.id)}</strong>
          </div>
          ${reg.attended
            ? `<button class="btn btn-primary btn-block" data-action="certificate" data-reg-id="${escapeHtml(docSnap.id)}">Download certificate</button>`
            : `<p class="pass-hint">Show this code at entry.</p>`}
        </article>`;
    }).join('');
  }, (error) => {
    console.error(error);
    passesGrid.innerHTML = emptyState('Could not load your passes', 'Check your connection and refresh the page.');
  }));
}

// ---------- Silver Oak University Certificate Renderer ----------
function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSilverOakCrest(ctx, cx, cy, r, customImg) {
  ctx.save();

  // If user placed ./images/sou-logo.png in their images folder, draw it inside the circular seal
  if (customImg && customImg.complete && customImg.naturalWidth > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#B8892D';
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.min(((r - 6) * 2) / customImg.naturalWidth, ((r - 6) * 2) / customImg.naturalHeight);
    const dw = customImg.naturalWidth * scale;
    const dh = customImg.naturalHeight * scale;
    ctx.drawImage(customImg, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
    ctx.restore();
    return;
  }

  // Built-in Silver Oak University Crest (Outer Seal + Academic Shield + Sunburst + Oak Tree + Open Book)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#14213D';
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#B8892D';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#E5C16C';
  ctx.stroke();

  // Inner academic shield
  const sw = r * 0.96;
  const sh = r * 1.08;
  const topY = cy - sh * 0.46;
  ctx.beginPath();
  ctx.moveTo(cx - sw / 2, topY);
  ctx.lineTo(cx + sw / 2, topY);
  ctx.lineTo(cx + sw / 2, topY + sh * 0.52);
  ctx.quadraticCurveTo(cx + sw / 2, topY + sh * 0.86, cx, topY + sh);
  ctx.quadraticCurveTo(cx - sw / 2, topY + sh * 0.86, cx - sw / 2, topY + sh * 0.52);
  ctx.closePath();
  ctx.fillStyle = '#FCFBF7';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#B8892D';
  ctx.stroke();

  // Rising sun rays behind the oak tree
  ctx.strokeStyle = '#D9A441';
  ctx.lineWidth = 1.5;
  for (let a = -150; a <= -30; a += 24) {
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * 10, cy - 2 + Math.sin(rad) * 10);
    ctx.lineTo(cx + Math.cos(rad) * 19, cy - 2 + Math.sin(rad) * 19);
    ctx.stroke();
  }

  // Oak tree canopy
  ctx.fillStyle = '#1B7F4B';
  ctx.beginPath();
  ctx.arc(cx - 8, cy - 3, 8.5, 0, Math.PI * 2);
  ctx.arc(cx + 8, cy - 3, 8.5, 0, Math.PI * 2);
  ctx.arc(cx, cy - 9, 10, 0, Math.PI * 2);
  ctx.fill();

  // Oak tree trunk & roots
  ctx.fillStyle = '#6B4226';
  ctx.fillRect(cx - 2.5, cy + 2, 5, 13);
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy + 15);
  ctx.lineTo(cx + 6, cy + 15);
  ctx.lineTo(cx + 2.5, cy + 12);
  ctx.lineTo(cx - 2.5, cy + 12);
  ctx.closePath();
  ctx.fill();

  // Open book at base of shield
  ctx.fillStyle = '#14213D';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + 17);
  ctx.quadraticCurveTo(cx - 6, cy + 15, cx, cy + 18);
  ctx.quadraticCurveTo(cx + 6, cy + 15, cx + 12, cy + 17);
  ctx.lineTo(cx + 12, cy + 21);
  ctx.quadraticCurveTo(cx + 6, cy + 19, cx, cy + 22);
  ctx.quadraticCurveTo(cx - 6, cy + 19, cx - 12, cy + 21);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawSilverOakCertificate(canvas, cert, customLogoImg = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;   // 1400
  const H = canvas.height;  // 990

  // 1. Cream parchment background
  ctx.fillStyle = '#FCFBF7';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 760);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  grad.addColorStop(1, 'rgba(236, 229, 212, 0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 2. Outer Royal Navy & Gold Borders
  ctx.strokeStyle = '#14213D';
  ctx.lineWidth = 14;
  ctx.strokeRect(34, 34, W - 68, H - 68);

  ctx.strokeStyle = '#B8892D';
  ctx.lineWidth = 4;
  ctx.strokeRect(56, 56, W - 112, H - 112);

  ctx.strokeStyle = '#14213D';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(66, 66, W - 132, H - 132);

  // Corner flourishes
  const corners = [
    [66, 66, 1, 1],
    [W - 66, 66, -1, 1],
    [66, H - 66, 1, -1],
    [W - 66, H - 66, -1, -1]
  ];
  ctx.fillStyle = '#B8892D';
  corners.forEach(([cx, cy, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 42 * sx, cy);
    ctx.lineTo(cx, cy + 42 * sy);
    ctx.closePath();
    ctx.fill();
  });

  // 3. Silver Oak University Logo Crest & Name
  ctx.textAlign = 'center';
  drawSilverOakCrest(ctx, W / 2, 140, 48, customLogoImg);

  ctx.fillStyle = '#14213D';
  ctx.font = '700 44px "Cinzel", "Source Serif 4", Georgia, serif';
  ctx.fillText('SILVER OAK UNIVERSITY', W / 2, 226);

  ctx.fillStyle = '#7C5808';
  ctx.font = '600 17px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('EDUCATION TO INNOVATION  •  AHMEDABAD, GUJARAT', W / 2, 256);

  ctx.strokeStyle = '#B8892D';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 240, 276);
  ctx.lineTo(W / 2 + 240, 276);
  ctx.stroke();

  // 4. Certificate Heading
  ctx.fillStyle = '#B8892D';
  ctx.font = '700 34px "Source Serif 4", Georgia, serif';
  ctx.fillText('CERTIFICATE OF PARTICIPATION', W / 2, 336);

  ctx.fillStyle = '#4A5568';
  ctx.font = 'italic 23px "Source Serif 4", Georgia, serif';
  ctx.fillText('This is proudly presented to', W / 2, 392);

  // 5. Student Name
  const studentName = (cert.studentName || 'Student Name').trim();
  ctx.fillStyle = '#14213D';
  ctx.font = '700 54px "Source Serif 4", Georgia, serif';
  ctx.fillText(studentName, W / 2, 466);

  const nameWidth = Math.min(820, Math.max(380, ctx.measureText(studentName).width + 80));
  ctx.strokeStyle = '#B8892D';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - nameWidth / 2, 484);
  ctx.lineTo(W / 2 + nameWidth / 2, 484);
  ctx.stroke();

  // 6. Body Description
  ctx.fillStyle = '#2D3748';
  ctx.font = '400 24px "Source Sans 3", Arial, sans-serif';
  const venuePart = cert.location ? ` held at ${cert.location}` : '';
  const bodyText = `for actively participating in "${cert.eventName}"${venuePart}, organized under Silver Oak University on ${formatLongDate(cert.eventDate)}.`;
  const lines = wrapCanvasText(ctx, bodyText, 980);
  lines.forEach((line, idx) => {
    ctx.fillText(line, W / 2, 544 + idx * 36);
  });

  // 7. Official Gold Seal
  const sealX = W / 2;
  const sealY = 772;
  ctx.save();
  ctx.beginPath();
  ctx.arc(sealX, sealY, 54, 0, Math.PI * 2);
  ctx.fillStyle = '#FFF7E2';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#B8892D';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(sealX, sealY, 45, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#14213D';
  ctx.stroke();

  ctx.fillStyle = '#14213D';
  ctx.font = '700 13px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('VERIFIED', sealX, sealY - 6);
  ctx.fillStyle = '#B8892D';
  ctx.font = '700 12px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('SILVER OAK', sealX, sealY + 11);
  ctx.fillText('UNIVERSITY', sealX, sealY + 25);
  ctx.restore();

  // 8. Signatures
  ctx.strokeStyle = '#14213D';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(200, 800);
  ctx.lineTo(470, 800);
  ctx.stroke();

  ctx.fillStyle = '#14213D';
  ctx.font = 'italic 22px "Source Serif 4", Georgia, serif';
  ctx.fillText('Event Coordinator', 335, 788);
  ctx.font = '600 17px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('Faculty Coordinator', 335, 826);
  ctx.fillStyle = '#5B6577';
  ctx.font = '400 15px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('Silver Oak University', 335, 848);

  ctx.beginPath();
  ctx.moveTo(W - 470, 800);
  ctx.lineTo(W - 200, 800);
  ctx.stroke();

  ctx.fillStyle = '#14213D';
  ctx.font = 'italic 22px "Source Serif 4", Georgia, serif';
  ctx.fillText('Authorized Signatory', W - 335, 788);
  ctx.font = '600 17px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('Dean, Student Welfare', W - 335, 826);
  ctx.fillStyle = '#5B6577';
  ctx.font = '400 15px "Source Sans 3", Arial, sans-serif';
  ctx.fillText('Silver Oak University', W - 335, 848);

  // 9. Footer Certificate ID & Email
  ctx.fillStyle = '#5B6577';
  ctx.font = '600 14px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`Certificate ID: ${cert.regId}`, 92, 912);

  ctx.textAlign = 'right';
  ctx.fillText(`Issued to: ${cert.userEmail}`, W - 92, 912);
}

function openCertificateModal(regId) {
  const reg = allRegistrationsById.get(regId);
  if (!reg) return;
  const ev = eventsById.get(reg.eventId) || {};

  const recipientName = currentStudentName || formatDisplayName(reg.studentName, reg.userEmail);

  activeCertData = {
    regId,
    studentName: recipientName,
    userEmail: reg.userEmail,
    eventName: reg.eventName,
    eventDate: reg.eventDate,
    location: ev.location || 'Silver Oak University Campus'
  };

  $('cert-recipient-label').textContent = recipientName;
  certModal.classList.remove('hidden');

  const canvas = $('cert-canvas');
  drawSilverOakCertificate(canvas, activeCertData, null);

  // Optional override: if ./images/sou-logo.png is placed in images/, draw the official image file cleanly
  const logoImg = new Image();
  logoImg.onload = () => {
    if (activeCertData && activeCertData.regId === regId) {
      drawSilverOakCertificate(canvas, activeCertData, logoImg);
    }
  };
  logoImg.src = './images/sou-logo.png';
}

$('cert-close-btn').addEventListener('click', () => {
  certModal.classList.add('hidden');
  activeCertData = null;
});

certModal.addEventListener('click', (e) => {
  if (e.target === certModal) {
    certModal.classList.add('hidden');
    activeCertData = null;
  }
});

$('cert-download-png').addEventListener('click', () => {
  if (!activeCertData) return;
  const canvas = $('cert-canvas');
  const link = document.createElement('a');
  const safeEvent = activeCertData.eventName.replace(/[^a-z0-9]+/gi, '_');
  link.download = `SOU_Certificate_${safeEvent}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('Silver Oak University certificate downloaded!', 'success');
});

$('cert-print-pdf').addEventListener('click', () => {
  if (!activeCertData) return;
  const dataUrl = $('cert-canvas').toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) {
    toast('Please allow pop-ups to print or save as PDF.', 'error');
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Silver Oak University Certificate — ${escapeHtml(activeCertData.eventName)}</title>
      <style>
        @page { size: landscape; margin: 0; }
        body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff; }
        img { width: 100%; max-width: 100vw; max-height: 100vh; object-fit: contain; }
      </style>
    </head>
    <body>
      <img src="${dataUrl}" onload="window.print(); window.close();">
    </body>
    </html>
  `);
  win.document.close();
});

// ---------- Payment Modal Logic ----------
function openPaymentModal(eventData) {
  pendingPaymentEvent = eventData;
  const upiUri = buildUpiUri(eventData.price, eventData.name);

  $('pay-modal-title').textContent = `Pay for ${eventData.name}`;
  $('pay-modal-amount').textContent = formatPrice(eventData.price);
  $('pay-upi-id').textContent = UPI_CONFIG.upiId;
  $('upi-deep-link').href = upiUri;

  const qrImg = $('pay-qr-img');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiUri)}`;
  qrImg.onerror = () => {
    if (UPI_CONFIG.qrImageUrl) qrImg.src = UPI_CONFIG.qrImageUrl;
  };

  $('utr-input').value = '';
  $('pay-error').textContent = '';
  paymentModal.classList.remove('hidden');
  $('utr-input').focus();
}

function closePaymentModal() {
  pendingPaymentEvent = null;
  paymentModal.classList.add('hidden');
}

$('pay-cancel-btn').addEventListener('click', closePaymentModal);

paymentModal.addEventListener('click', (e) => {
  if (e.target === paymentModal) closePaymentModal();
});

$('copy-upi-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(UPI_CONFIG.upiId);
    toast('UPI ID copied to clipboard.', 'success');
  } catch {
    toast('Could not copy UPI ID.', 'error');
  }
});

$('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser || !pendingPaymentEvent) return;

  const utr = $('utr-input').value.trim();
  const errorDiv = $('pay-error');
  const submitBtn = $('pay-submit-btn');
  errorDiv.textContent = '';

  if (utr.length < 8) {
    errorDiv.textContent = 'Please enter a valid UPI Reference / UTR ID (at least 8 characters).';
    return;
  }

  submitBtn.disabled = true;
  try {
    const studentName = currentStudentName || formatDisplayName(currentUser.displayName, currentUser.email);
    await addDoc(collection(db, "registrations"), {
      eventId: pendingPaymentEvent.id,
      eventName: pendingPaymentEvent.name,
      eventDate: pendingPaymentEvent.date,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      studentName,
      attended: false,
      amount: Number(pendingPaymentEvent.price),
      paymentStatus: 'pending',
      utr,
      submittedAt: new Date()
    });
    const evName = pendingPaymentEvent.name;
    closePaymentModal();
    toast(`Payment submitted for ${evName}. Your pass will unlock once verified.`, 'success');
  } catch (error) {
    console.error(error);
    errorDiv.textContent = 'Could not submit payment details. Please try again.';
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Actions ----------
async function registerForEvent(btn) {
  if (!currentUser) return;
  const { id: eventId, name: eventName, date: eventDate, price: rawPrice } = btn.dataset;
  const price = Number(rawPrice || 0);

  const existing = userRegistrationsMap.get(eventId);
  if (existing && existing.paymentStatus !== 'rejected') return;

  if (price > 0) {
    openPaymentModal({ id: eventId, name: eventName, date: eventDate, price });
    return;
  }

  btn.disabled = true;
  try {
    const studentName = currentStudentName || formatDisplayName(currentUser.displayName, currentUser.email);
    await addDoc(collection(db, "registrations"), {
      eventId,
      eventName,
      eventDate,
      userId: currentUser.uid,
      userEmail: currentUser.email,
      studentName,
      attended: false,
      amount: 0,
      paymentStatus: 'free',
      submittedAt: new Date()
    });
    toast(`Registered for ${eventName}. Your pass is ready below.`, 'success');
  } catch (error) {
    console.error(error);
    btn.disabled = false;
    toast('Could not complete registration. Please try again.', 'error');
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'register') registerForEvent(btn);
  if (btn.dataset.action === 'certificate') openCertificateModal(btn.dataset.regId);
});
