// Google sign-in and cross-device sync on Firebase. Without a config the app stays local-only.
import config from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const KINDS = ["categories", "entries"];
const DEBOUNCE_MS = 500;
const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes

const H = window.Hourbook;
const $ = id => document.getElementById(id);

// Field order differs between local objects and Firestore snapshots, so compare with sorted keys.
function stable(v){
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const body = ({id, ...rest}) => rest;
const key = (kind, id) => `${kind}/${id}`;
const sortCats = cats => cats.sort((a, b) => (a.created || 0) - (b.created || 0));

function setSync(state, label, title){
  const el = $("sync");
  el.hidden = !label;
  el.dataset.state = state;
  $("sync-label").textContent = label || "";
  el.title = title || label || "";
}

async function main(){
  if (!config?.apiKey) return;
  let fb;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    fb = {...appMod, ...authMod, ...fsMod};
  } catch (e){
    $("account").hidden = false;
    $("signin-btn").hidden = true;
    setSync("error", "Sync unavailable", "Couldn't load the sign-in service. Check your connection and reload.");
    return;
  }

  const app = fb.initializeApp(config);
  const auth = fb.getAuth(app);
  const db = fb.initializeFirestore(app, {
    localCache: fb.persistentLocalCache({tabManager: fb.persistentMultipleTabManager()}),
  });

  // What the server last held for each doc, as stable JSON. A local item that differs is unsynced.
  let synced = new Map();
  let user = null, unsubs = [], timer = null, inflight = Promise.resolve();

  const col = kind => fb.collection(db, "users", user.uid, kind);
  const idleLabel = () => navigator.onLine
    ? ["synced", "Synced", `Signed in as ${user.email || user.displayName || "you"}`]
    : ["offline", "Offline · saved on this device", "Changes sync when you're back online"];

  function flush(){
    clearTimeout(timer); timer = null;
    if (!user) return inflight;
    const ops = [], seen = new Set();
    for (const kind of KINDS){
      for (const item of H.state[kind]){
        const k = key(kind, item.id), json = stable(body(item));
        seen.add(k);
        if (synced.get(k) !== json){ ops.push([kind, item.id, JSON.parse(JSON.stringify(body(item)))]); synced.set(k, json); }
      }
    }
    for (const k of [...synced.keys()]){
      if (seen.has(k)) continue;
      const [kind, id] = k.split("/");
      ops.push([kind, id, null]); synced.delete(k);
    }
    if (!ops.length) return inflight;

    const uid = user.uid;
    const commits = [];
    for (let i = 0; i < ops.length; i += BATCH_LIMIT){
      const batch = fb.writeBatch(db);
      for (const [kind, id, data] of ops.slice(i, i + BATCH_LIMIT)){
        const ref = fb.doc(db, "users", uid, kind, id);
        data ? batch.set(ref, data) : batch.delete(ref);
      }
      commits.push(batch.commit());
    }
    setSync(...(navigator.onLine ? ["saving", "Saving…"] : idleLabel()));
    // Commits resolve only once the server confirms; offline they wait in the local cache.
    inflight = Promise.all(commits).then(
      () => { if (user?.uid === uid && !timer) setSync(...idleLabel()); },
      err => { console.error(err); setSync("error", "Couldn't save", `Your latest changes didn't reach the server (${err.code || err.message}). Reload to retry.`); },
    );
    return inflight;
  }

  function applyRemote(kind, snap){
    let changed = false;
    for (const ch of snap.docChanges()){
      if (ch.doc.metadata.hasPendingWrites) continue; // echo of this device's own write
      const k = key(kind, ch.doc.id), arr = H.state[kind];
      const i = arr.findIndex(x => x.id === ch.doc.id);
      // An item edited here but not yet pushed keeps the local version; the next push wins.
      if ((i >= 0 ? stable(body(arr[i])) : undefined) !== synced.get(k)) continue;
      if (ch.type === "removed"){
        if (i >= 0) arr.splice(i, 1);
        synced.delete(k);
      } else {
        const data = ch.doc.data();
        if (i >= 0){
          for (const f of Object.keys(arr[i])) if (f !== "id" && !(f in data)) delete arr[i][f];
          Object.assign(arr[i], data);
        } else arr.push({id: ch.doc.id, ...data});
        synced.set(k, stable(data));
      }
      changed = true;
    }
    if (changed){ sortCats(H.state.categories); H.refresh(); }
  }

  async function startSession(u){
    user = u;
    $("signin-btn").hidden = true;
    $("signout-btn").hidden = false;
    $("signout-btn").title = `Signed in as ${u.email || u.displayName || "you"}`;
    setSync("saving", "Syncing…");

    const snaps = await Promise.all(KINDS.map(kind => fb.getDocs(col(kind))));
    if (user !== u) return; // signed out while loading
    synced = new Map();
    const merged = {};
    const local = H.loadLocal();
    KINDS.forEach((kind, n) => {
      const cloud = snaps[n].docs.map(d => { synced.set(key(kind, d.id), stable(d.data())); return {id: d.id, ...d.data()}; });
      const have = new Set(cloud.map(x => x.id));
      // Anything logged on this device before signing in joins the account.
      merged[kind] = [...cloud, ...(local[kind] || []).filter(x => !have.has(x.id))];
    });
    sortCats(merged.categories);
    H.attach({push: () => { clearTimeout(timer); timer = setTimeout(flush, DEBOUNCE_MS); }}, merged);

    const uploaded = flush();
    uploaded.then(() => { if (user === u) H.clearLocal(); });
    unsubs = KINDS.map(kind => fb.onSnapshot(col(kind), {includeMetadataChanges: false}, snap => applyRemote(kind, snap),
      err => { console.error(err); setSync("error", "Sync stopped", `Lost access to your synced data (${err.code}). Reload to retry.`); }));
    if (!timer) setSync(...idleLabel());
  }

  function endSession(){
    unsubs.forEach(u => u()); unsubs = [];
    clearTimeout(timer); timer = null;
    user = null; synced = new Map();
    $("signin-btn").hidden = false;
    $("signout-btn").hidden = true;
    setSync("idle", "");
    H.detach();
  }

  $("account").hidden = false;
  $("signin-btn").addEventListener("click", async () => {
    const provider = new fb.GoogleAuthProvider();
    try {
      await fb.signInWithPopup(auth, provider);
    } catch (err){
      if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-environment") return fb.signInWithRedirect(auth, provider);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
      const hint = err.code === "auth/unauthorized-domain"
        ? `Add ${location.hostname} under Authentication → Settings → Authorized domains in Firebase.`
        : `Sign-in failed (${err.code || err.message}).`;
      setSync("error", "Couldn't sign in", hint);
    }
  });
  $("signout-btn").addEventListener("click", async () => {
    setSync("saving", "Signing out…");
    flush();
    // Wait briefly for unsent changes, but don't trap someone offline on this screen.
    await Promise.race([inflight, new Promise(r => setTimeout(r, 3000))]);
    await fb.signOut(auth);
    // Remove the cached copy of this account's data from the device.
    try { await fb.terminate(db); await fb.clearIndexedDbPersistence(db); } catch (e){}
    location.reload();
  });
  window.addEventListener("online", () => { if (user && !timer) setSync(...idleLabel()); });
  window.addEventListener("offline", () => { if (user) setSync(...idleLabel()); });
  window.addEventListener("beforeunload", () => { if (timer) flush(); });

  fb.onAuthStateChanged(auth, u => {
    if (u && u.uid === user?.uid) return;
    if (user) endSession();
    if (u) startSession(u).catch(err => {
      console.error(err);
      const code = err.code || err.message;
      setSync("error", `Couldn't load your data (${code})`, code === "permission-denied"
        ? "The database rules are blocking access. Publish firestore.rules in the Firebase console, then reload."
        : `${code}. Reload to retry.`);
    });
  });
}

main();
