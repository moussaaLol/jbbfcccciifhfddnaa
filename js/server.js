/** =========================
 * TODO — PARAMÈTRES À RENSEIGNER
 * ========================= */
const DISCORD = {
  CLIENT_ID: '1407764995671986249',
  GUILD_ID: '1406489247543984240',
  SCOPES: ['identify', 'guilds.members.read'],
  REDIRECT_URI:'https://nazapi.dreamweave.lol/',
  PREMIUM_ROLE_ID: '1406489247573086400',
  VIP_ROLE_ID: '1406489247564824669',
  MOD_ROLE_ID: '1406489247598252069'
};

// ✅ Stripe Elements config (no redirect to Stripe page)
const STRIPE = {
  PUBLIC_KEY: 'pk_test_51Rys3a1EC7Cm7d9GpJkkTiJHhlAdD4aaRmKYvaAQownN4JmUK6R18VMB8K6RJ94iC5F6hxMarSCvv5lLc55zjlIF00wrJIQC07',              // <-- remplace par ta clé publique Stripe
  CREATE_PAYMENT_INTENT_URL: '/create-payment-intent' // <-- endpoint backend qui renvoie {clientSecret}
};

const FIREBASE_CFG = {
  apiKey: "AIzaSyBtVmI_0_9qC6Cj5lmYgbwVJlW8lH11Ouw",
  authDomain: "nazapi-fc74e.firebaseapp.com",
  projectId: "nazapi-fc74e",
  storageBucket: "nazapi-fc74e.firebasestorage.app",
  appId: "1:1011679210688:web:eeccc40063f83b91e3d125",
};

const LICENSES_PATH = '/artifacts/' + ('default-app-id') + '/public/data/licenses';
const VOUCHES_PATH = 'vouches';
const THIRTY_DAYS_MS = 2592000000;

/** =========================
 * UTILITAIRES
 * ========================= */
const $ = sel => document.querySelector(sel);
const sleep = (ms)=> new Promise(r => setTimeout(r, ms));
const toHexUpper = (buf) => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();

function generateLicenseKey() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return toHexUpper(arr.buffer);
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

// Firebase
firebase.initializeApp(FIREBASE_CFG);
const db = firebase.firestore();
const auth = firebase.auth();
const functions = firebase.functions();

/** =========================
 * VOUCH SYSTEM
 * ========================= */
async function loadVouches() {
  try {
    const snapshot = await db.collection(VOUCHES_PATH).orderBy('createdAt', 'desc').limit(50).get();
    const vouchesContainer = $('#vouchList');
    // Clear the container first
    vouchesContainer.innerHTML = '';
    // If no vouches, display the message and stop
    if (snapshot.empty) {
      vouchesContainer.innerHTML = '<div class="no-vouches">Aucun vouch pour le moment.</div>';
      return;
    }
    // Otherwise, append the vouches
    snapshot.forEach(doc => { vouchesContainer.appendChild(createVouchElement(doc.id, doc.data())); });
  } catch (error) {
    console.error('Error loading vouches:', error);
    $('#vouchList').innerHTML = '<div class="no-vouches">Erreur lors du chargement des témoignages.</div>';
  }
}
function createVouchElement(id, vouch) {
  const div = document.createElement('div');
  div.className = 'vouch-item';
  div.innerHTML = `
    <div class="vouch-header">
      <div class="vouch-user">
        <div class="vouch-avatar"></div>
        <div>
          <div class="vouch-name">${vouch.userName || 'Utilisateur'}</div>
          <div class="vouch-date">${formatDate(vouch.createdAt)}</div>
        </div>
      </div>
    </div>
    <div class="vouch-content">${vouch.text}</div>
  `;
  if (hasModPermissions()) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'vouch-delete';
    deleteBtn.innerHTML = '×';
    deleteBtn.onclick = () => deleteVouch(id);
    div.appendChild(deleteBtn);
  }
  return div;
}
async function submitVouch() {
  const text = $('#vouchText').value.trim();
  if (!text) return alert('Veuillez écrire un témoignage.');
  if (!discordUser) return alert('Vous devez être connecté pour poster un témoignage.');
  try {
    $('#submitVouch').disabled = true; $('#submitVouch').textContent = 'Publication...';
    const vouchData = { text, userId: discordUser.id, userName: `${discordUser.username}#${discordUser.discriminator || '0'}`, createdAt: firebase.firestore.FieldValue.serverTimestamp(), userRoles: discordMember?.roles || [] };
    await db.collection(VOUCHES_PATH).add(vouchData);
    $('#vouchText').value = ''; $('#vouchCharCount').textContent = '0/500'; $('#vouchCharCount').className = 'char-count';
    await loadVouches(); $('#submitVouch').disabled = false; $('#submitVouch').textContent = 'Publier le témoignage';
  } catch (error) {
    console.error('Error submitting vouch:', error); alert('Erreur lors de la publication du témoignage.'); $('#submitVouch').disabled = false; $('#submitVouch').textContent = 'Publier le témoignage';
  }
}
async function deleteVouch(vouchId) { if (!confirm('Êtes-vous sûr de vouloir supprimer ce témoignage?')) return; try { await db.collection(VOUCHES_PATH).doc(vouchId).delete(); await loadVouches(); } catch (e) { console.error(e); alert('Erreur lors de la suppression du témoignage.'); } }
function hasModPermissions() { return discordMember && discordMember.roles && discordMember.roles.includes(DISCORD.MOD_ROLE_ID); }
function hasPremiumAccess() { return discordMember && discordMember.roles && (discordMember.roles.includes(DISCORD.PREMIUM_ROLE_ID) || discordMember.roles.includes(DISCORD.VIP_ROLE_ID)); }
function setupVouchCharacterCounter() { const textarea = $('#vouchText'); const counter = $('#vouchCharCount'); textarea.addEventListener('input', () => { const length = textarea.value.length; counter.textContent = `${length}/500`; counter.className = 'char-count' + (length > 490 ? ' error' : length > 450 ? ' warning' : ''); }); }

/** =========================
 * STRIPE PAYMENT (Elements in popup)
 * ========================= */
let stripe, elements, paymentElement;
async function openStripePopupAndInitElements() {
  // show popup
  $('#paymentPopup').style.display = 'flex';
  $('#paymentMessage').textContent = '';

  // create PaymentIntent on your backend
  const res = await fetch('/api/create-payment-intent', { method: 'POST' });
  if (!res.ok) { $('#paymentMessage').textContent = 'Erreur lors de la création du paiement.'; return null; }
  const data = await res.json();
  if (!data.clientSecret) { $('#paymentMessage').textContent = 'Client secret manquant.'; return null; }

  // init Elements with the clientSecret
  stripe = Stripe(STRIPE.PUBLIC_KEY);
  elements = stripe.elements({ clientSecret: data.clientSecret });
  paymentElement = elements.create('payment');
  paymentElement.mount('#payment-element');
  return true;
}
async function confirmStripePayment() {
  $('#paymentMessage').textContent = 'Traitement du paiement...';
  $('#confirmPaymentBtn').disabled = true;
  const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
  $('#confirmPaymentBtn').disabled = false;

  if (error) { 
    $('#paymentMessage').textContent = '❌ ' + error.message; 
  } else if (paymentIntent && paymentIntent.status === 'succeeded') {
    window.location.href = '/premium/purchase/success/confirm?payment_completed=' + encodeURIComponent(paymentIntent.id);
  } else {
    $('#paymentMessage').textContent = 'Paiement non complété.';
  }
}

/** =========================
 * LOADING SCREEN
 * ========================= */
function showLoadingScreen(message = 'Chargement...') { const loadingScreen = $('#loadingScreen'); const loadingText = loadingScreen.querySelector('.loading-text'); if (message) { loadingText.innerHTML = message + '<span class="loading-dots"></span>'; } loadingScreen.style.display = 'flex'; setTimeout(() => { loadingScreen.style.opacity = '1'; }, 10); }
function hideLoadingScreen() { const loadingScreen = $('#loadingScreen'); loadingScreen.style.opacity = '0'; setTimeout(() => { loadingScreen.style.display = 'none'; }, 500); }

/** =========================
 * DISCORD ROLE ASSIGNMENT
 * ========================= */
async function assignDiscordRole(userId) {
  try {
    const statusElement = $('#roleAssignmentStatus');
    statusElement.classList.remove('hide', 'success', 'error');
    statusElement.classList.add('updating');
    statusElement.textContent = 'Attribution du rôle Discord en cours...';
    const assignRoleFunction = functions.httpsCallable('assignDiscordRole');
    const result = await assignRoleFunction({ userId, roleId: DISCORD.PREMIUM_ROLE_ID });
    if (result.data.success) {
      statusElement.classList.remove('updating'); statusElement.classList.add('success'); statusElement.textContent = '✅ Rôle Discord attribué avec succès!';
      if (discordAuth?.token) { await updateFromDiscord(discordAuth.token); }
      return true;
    } else { throw new Error(result.data.error || "Erreur inconnue lors de l'attribution du rôle"); }
  } catch (error) {
    console.error('Error assigning Discord role:', error);
    const statusElement = $('#roleAssignmentStatus');
    statusElement.classList.remove('updating'); statusElement.classList.add('error'); statusElement.textContent = '❌ Erreur lors de l\'attribution du rôle Discord. Contactez-nous.';
    return false;
  }
}

/** =========================
 * DISCORD OAUTH IMPLICIT GRANT
 * ========================= */
function loginDiscord() {
  const params = new URLSearchParams({ client_id: DISCORD.CLIENT_ID, response_type: 'token', redirect_uri: DISCORD.REDIRECT_URI, scope: DISCORD.SCOPES.join(' ') });
  window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
}
function parseImplicitToken() { if (window.location.hash.startsWith('#')) { const h = new URLSearchParams(window.location.hash.slice(1)); if (h.get('access_token')) { const token = h.get('access_token'); const tokenType = h.get('token_type') || 'Bearer'; const expires = Number(h.get('expires_in') || 0); history.replaceState({}, document.title, window.location.pathname + window.location.search); return { token, tokenType, expires }; } } return null; }
async function fetchDiscordJSON(token, path) { const r = await fetch(`https://discord.com/api${path}`, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error('Discord API error: ' + r.status); return r.json(); }

/** =========================
 * UI & FLUX
 * ========================= */
const userBadge = $('#userBadge');
const loginBtn = $('#loginBtn');
const logoutBtn = $('#logoutBtn');
const rolesChips = $('#rolesChips');
const accountState = $('#accountState');
const purchaseBlock = $('#purchaseBlock');
const activationBlock = $('#activationBlock');
const searchGate = $('#searchGate');
const searchUI = $('#searchUI');
const results = $('#results');
const progress = $('#progress');
const stickyKey = $('#stickyKey');
const stickyKeyValue = $('#stickyKeyValue');

let discordAuth = null;
let discordUser = null;
let discordMember = null;

function saveSession() { sessionStorage.setItem('nazapi_discord_auth', JSON.stringify(discordAuth || null)); sessionStorage.setItem('nazapi_discord_user', JSON.stringify(discordUser || null)); sessionStorage.setItem('nazapi_discord_member', JSON.stringify(discordMember || null)); }
function loadSession() { try{ discordAuth  = JSON.parse(sessionStorage.getItem('nazapi_discord_auth')||'null'); discordUser  = JSON.parse(sessionStorage.getItem('nazapi_discord_user')||'null'); discordMember= JSON.parse(sessionStorage.getItem('nazapi_discord_member')||'null'); }catch{} }

function setLoggedOutUI() {
  userBadge.textContent = 'Non connecté';
  rolesChips.innerHTML = '';
  accountState.innerHTML = `<div class="muted">Connecte-toi avec Discord pour vérifier tes rôles sur le serveur.</div>`;
  purchaseBlock.classList.add('hide');
  activationBlock.classList.add('hide');
  searchGate.classList.remove('hide');
  searchUI.classList.add('hide');
  logoutBtn.classList.add('hide');
  loginBtn.classList.remove('hide');
  $('#vouchSection').classList.add('hide');
  $('#vouchForm').classList.add('hide');
}
function showRolesChips(member){ rolesChips.innerHTML = ''; if (!member || !Array.isArray(member.roles)) return; member.roles.forEach(id=>{ const span = document.createElement('span'); span.className='role-chip'; span.textContent = (id===DISCORD.PREMIUM_ROLE_ID?'Premium':(id===DISCORD.VIP_ROLE_ID?'VIP':(id===DISCORD.MOD_ROLE_ID?'Mod':'Rôle '+id))); rolesChips.appendChild(span); }); }
function setLoggedInUI(hasPremium) {
  userBadge.textContent = discordUser ? `${discordUser.username}#${discordUser.discriminator || '0'}` : 'Connecté';
  showRolesChips({roles: discordMember?.roles || []});
  logoutBtn.classList.remove('hide');
  loginBtn.classList.add('hide');
  $('#vouchSection').classList.remove('hide');
  if (hasPremium) {
    $('#vouchForm').classList.remove('hide');
    accountState.innerHTML = `<div class="ok-text">Accès Premium/VIP validé ✔</div><div class="muted" style="font-size:13px">Tu peux utiliser la recherche.</div>`;
    purchaseBlock.classList.add('hide');
    activationBlock.classList.remove('hide');
    searchGate.classList.add('hide');
    searchUI.classList.remove('hide');
  } else {
    $('#vouchForm').classList.add('hide');
    accountState.innerHTML = `<div class="danger-text">Accès Premium requis</div><div class="muted" style="font-size:13px">Achète Premium (16,99 €) ou active une clé existante.</div>`;
    purchaseBlock.classList.remove('hide');
    activationBlock.classList.remove('hide');
    searchGate.classList.remove('hide');
    searchUI.classList.add('hide');
  }
  loadVouches();
}
async function updateFromDiscord(token) {
  try{
    showLoadingScreen('Connexion à Discord...');
    discordUser = await fetchDiscordJSON(token, '/users/@me');
    let memberObj = await fetchDiscordJSON(token, `/users/@me/guilds/${DISCORD.GUILD_ID}/member`);
    discordMember = { roles: (memberObj.roles||[]) };
    saveSession();
    const hasPremium = hasPremiumAccess();
    setLoggedInUI(hasPremium); hideLoadingScreen();
  }catch(e){ console.error('Erreur Discord :', e); setLoggedOutUI(); hideLoadingScreen(); }
}
function logout(){ discordAuth = discordUser = discordMember = null; saveSession(); setLoggedOutUI(); }

// 🟦 BUY BUTTON -> open Stripe Elements popup
async function handleBuy() {
  try {
    showLoadingScreen('Initialisation du paiement...');
    const ok = await openStripePopupAndInitElements();
    hideLoadingScreen();
    if (!ok) return;
  } catch (e) { hideLoadingScreen(); alert('Erreur Stripe: ' + (e?.message||e)); }
}

async function createLicenseForUser(name='NazAPI Premium - 30 jours', expiresIn=THIRTY_DAYS_MS, source='manual') {
  const keyData = { key: generateLicenseKey(), name, expiresAt: Date.now() + expiresIn, status: 'unused', createdAt: Date.now(), activatedBy: null, source, unusedExpiresAt: source === 'manual' ? Date.now() + 3600000 : null };
  await db.collection(LICENSES_PATH).add(keyData);
  return keyData;
}
async function activateExistingKeyForUser(key) {
  if (!discordUser) throw new Error('Non connecté');
  const snap = await db.collection(LICENSES_PATH).where('key','==',key).get();
  if (snap.empty) throw new Error('Clé invalide');
  const docRef = snap.docs[0].ref; const data = snap.docs[0].data();
  if (data.status !== 'unused') throw new Error('Clé déjà activée ou expirée');
  if (data.unusedExpiresAt && data.unusedExpiresAt <= Date.now()) { await docRef.update({ status: 'expired' }); throw new Error('Clé expirée (non utilisée à temps)'); }
  const q2 = await db.collection(LICENSES_PATH).where('activatedBy','==', discordUser.id).where('status','==','active').get();
  if (!q2.empty) throw new Error('Vous avez déjà une licence active');
  await docRef.update({ status:'active', activatedBy: discordUser.id, activatedAt: Date.now() });
  await assignDiscordRole(discordUser.id);
  return { ...data, status:'active', activatedBy: discordUser.id };
}

/** =========================
 * CLOUD FUNCTION SEARCH
 * ========================= */
async function runSearch(term){
  if (!term || term.trim().length < 2) { progress.textContent = 'Terme trop court.'; return; }
  results.innerHTML = ''; progress.textContent = 'Recherche en cours...';
  try { const searchFunction = functions.httpsCallable('searchFiles'); const response = await searchFunction({ query: term }); const found = response.data.results; if (!found || found.length === 0) { progress.textContent = `Aucun résultat trouvé pour "${term}".`; return; } progress.textContent = `Résultats : ${found.length} trouvé(s).`; for (const r of found) { const el = document.createElement('div'); el.className='card'; el.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700">📄 ${r.nom}</div>
            <div class="muted" style="font-size:12px">${r.chemin}</div>
          </div>
          <a href="${r.downloadUrl}" download="${r.nom}" class="btn">Télécharger</a>
        </div>
        <div class="divider"></div>
        <pre class="code" style="white-space:pre-wrap;margin:0">${r.ligne}</pre>`; results.appendChild(el); } } catch (error) { console.error('Erreur recherche :', error); progress.textContent = `Erreur : ${error.message}`; }
}

/** =========================
 * EVENTS
 * ========================= */
$('#year').textContent = new Date().getFullYear();
loginBtn.addEventListener('click', loginDiscord);
logoutBtn.addEventListener('click', logout);
$('#buyBtn').addEventListener('click', handleBuy);
$('#haveKeyBtn').addEventListener('click', ()=> activationBlock.scrollIntoView({behavior:'smooth',block:'center'}));
$('#activateKeyBtn').addEventListener('click', async ()=>{ const input = $('#keyInput'); const key = (input.value||'').trim().toUpperCase(); $('#activationMsg').classList.remove('ok-text','danger-text'); $('#activationMsg').textContent=''; $('#roleAssignmentStatus').classList.add('hide'); try{ if (!key || key.length !== 32) throw new Error('Clé invalide (32 caractères requis).'); showLoadingScreen('Activation de votre clé...'); await activateExistingKeyForUser(key); $('#activationMsg').classList.add('ok-text'); $('#activationMsg').textContent = '✅ Clé activée avec succès!'; hideLoadingScreen(); }catch(e){ $('#activationMsg').classList.add('danger-text'); $('#activationMsg').textContent = '❌ ' + e.message; hideLoadingScreen(); }});
$('#doSearch').addEventListener('click', ()=> runSearch($('#q').value));
$('#closeSticky').addEventListener('click', ()=> stickyKey.classList.add('hide'));
$('#submitVouch').addEventListener('click', submitVouch);
setupVouchCharacterCounter();

// Stripe popup buttons
$('#closePaymentBtn').addEventListener('click', ()=> { $('#paymentPopup').style.display = 'none'; });
$('#confirmPaymentBtn').addEventListener('click', confirmStripePayment);

(async function init(){
  showLoadingScreen();
  setLoggedOutUI();
  try { await auth.signInAnonymously(); } catch {}
  const parsedToken = parseImplicitToken();
  if (parsedToken) { discordAuth = parsedToken; } else { loadSession(); }
  if (discordAuth?.token) { await updateFromDiscord(discordAuth.token); } else { hideLoadingScreen(); }
})();
