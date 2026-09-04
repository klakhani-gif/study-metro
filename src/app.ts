import { AppState, Exam, JourneyRecord, LINE_COLORS, MetroLine, ScheduledDeparture, Station, StationStatus, createEmptyState } from "./model.js";
import { boardDeparture, completeDeparture, departureError, departureGroup, departureStatus, localDepartureFields, nextDeparture, parseDepartureTime, rescheduleDeparture } from "./departures.js";
import { daysUntil, examCountdown, examDateLabel, examProgress, validateExam } from "./exams.js";
import { loadState, resetState, saveState, storageNotice, isStorageReadOnly } from "./storage.js";
import { JourneyTimer, formatRemaining } from "./timer.js";
import { nameError, topicsError, validDuration } from "./validation.js";
import { displayLineColor, renderMetroMap } from "./metro.js";
import { relayoutStations } from "./layout.js";
import { completeStation, emptyRevisionInfo, isCompletedStation, isMaintenanceDue } from "./revision.js";
import { canShareTicket, createJourneyTicket, renderTicketSvg, ticketFilename, ticketPng } from "./tickets.js";
import { createWeeklyRecap, recapDateKey, recapDuration, recapWeekLabel, renderRecapSvg, weekBounds } from "./recap.js";
import { getSupabaseClient } from "./supabase.js";
import { AuthController, oauthCallbackMessage } from "./auth.js";
import { accountControl, refreshAccountControls, showAccount } from "./auth-view.js";
import { createCloudStore } from "./cloud-store.js";
import { CloudSync } from "./cloud-sync.js";
import { ProfileController, ProfileStore, profileInputError, profileUsernameFromPath, usernameError, type PublicProfile } from "./profiles.js";
import { FriendStore, StatsSync, createLeaderboard, friendError, friendSearchError, localWeekStart, type FriendRelation, type ProfileSearchResult, type UserStats } from "./friends.js";
import { FriendPresenceManager, type FriendPresence } from "./presence.js";
import { appRoute, routeNeedsAccount, type AppRoute } from "./router.js";

const supabase = getSupabaseClient();
const accountAuth = new AuthController(supabase?.auth ?? null);
const oauthReturnError=oauthCallbackMessage(location.search,location.hash);if(oauthReturnError)accountAuth.reportExternalError(oauthReturnError);
const profiles = supabase ? new ProfileController(new ProfileStore(supabase)) : null;
const friendStore = supabase ? new FriendStore(supabase) : null;
const statsSync = friendStore ? new StatsSync(friendStore) : null;
const presence = supabase ? new FriendPresenceManager(supabase) : null;
let presenceRelationsLoading=false;
let appReady = false;
const publicRoute = profileUsernameFromPath(location.pathname);
const isPublicRoute = /^\/u\//.test(location.pathname);
const cloudSync = supabase ? new CloudSync(createCloudStore(supabase), {
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  apply: replaceNetwork,
  online: () => navigator.onLine,
  canReplace: () => !document.body.classList.contains("focus-mode") && !document.querySelector("#modal-root .modal-backdrop")
}) : null;
accountAuth.subscribe(() => {
  refreshAccountControls(accountAuth, cloudSync, profiles?.profile?.username);
  // SDK auth callbacks must remain synchronous; defer session-dependent database work until its lock is released.
  if (appReady && !publicRoute && !accountAuth.state.loading) queueMicrotask(reconcileAccount);
  if(appReady&&accountAuth.state.session&&["/login","/signup"].includes(location.pathname))queueMicrotask(()=>navigateTo("/network",true));
  const activeRoute=appRoute(location.pathname);if(appReady&&!accountAuth.state.session&&activeRoute&&routeNeedsAccount(activeRoute))queueMicrotask(()=>navigateTo("/",true));
  if(appReady&&accountAuth.state.session&&(activeRoute==="/friends"||activeRoute==="/profile"))queueMicrotask(()=>navigateTo(activeRoute,true));
});
let promptedAccount: string | null = null;
cloudSync?.subscribe(() => {
  refreshAccountControls(accountAuth, cloudSync, profiles?.profile?.username);
  if (cloudSync.choice === "import" && !cloudSync.working && promptedAccount !== cloudSync.userId) {
    queueMicrotask(() => {
      if (cloudSync.choice !== "import" || document.body.classList.contains("focus-mode")) return;
      if (showAccount(accountAuth, bindModalClose, cloudSync, openOwnProfile)) promptedAccount = cloudSync.userId;
    });
  }
  scheduleProfileSetup();
  scheduleOwnStats();
});
let promptedProfile: string | null = null;
let profilePromptObserver: MutationObserver | null = null;

function scheduleProfileSetup(): void {
  const syncReady = !cloudSync || (!cloudSync.working && cloudSync.choice !== "import");
  const eligible = !publicRoute && syncReady && profiles?.userId && !profiles.loading && !profiles.profile && !profiles.error && promptedProfile !== profiles.userId;
  if (!eligible) { profilePromptObserver?.disconnect(); profilePromptObserver = null; return; }
  queueMicrotask(() => {
    if (!profiles?.userId || profiles.loading || profiles.profile || profiles.error || cloudSync?.working || cloudSync?.choice === "import" || promptedProfile === profiles.userId) return;
    if (!document.querySelector(".modal-backdrop") && !document.body.classList.contains("focus-mode")) {
      profilePromptObserver?.disconnect(); profilePromptObserver = null;
      if (showProfileSetup()) promptedProfile = profiles.userId;
      return;
    }
    if (!profilePromptObserver) {
      profilePromptObserver = new MutationObserver(scheduleProfileSetup);
      profilePromptObserver.observe(document.body, { childList: true, subtree: true });
    }
  });
}

profiles?.subscribe(() => {
  refreshAccountControls(accountAuth, cloudSync, profiles.profile?.username);
  scheduleProfileSetup();
  scheduleOwnStats();
  if(profiles.profile)void refreshPresenceFriends();
  const route=appRoute(location.pathname);if(appReady&&profiles.profile&&(route==="/profile"||route==="/friends")&&!document.querySelector(".app-page-root"))queueMicrotask(()=>navigateTo(route,true));
});
presence?.subscribe(refreshPresenceUi);
document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("[data-account-control]")) navigateTo("/settings");
  const mode=event.target.closest<HTMLElement>("[data-auth-mode]")?.dataset.authMode;if(mode&&document.body.classList.contains("auth-page-open"))history.replaceState({},"",mode==="signup"?"/signup":"/login");
  if(event.target.closest("[data-auth-guest]")&&(document.body.classList.contains("auth-page-open")||document.body.classList.contains("section-page-open")))queueMicrotask(()=>navigateTo("/network"));
});

function openOwnProfile(): void {
  navigateTo("/profile");
}

function scheduleOwnStats(snapshot=state):void {if(!statsSync||!profiles?.profile||!cloudSync?.userId||cloudSync.working||cloudSync.choice||cloudSync.status!=="Synced")return;statsSync.schedule(snapshot);}
const presencePrivacyKey=(id:string)=>`study-metro:presence-activity:${id}`;
function sharesPresenceActivity():boolean{const id=accountAuth.state.session?.user.id;if(!id)return true;try{return localStorage.getItem(presencePrivacyKey(id))!=="off";}catch{return true;}}
function setPresencePrivacy(show:boolean):void{const id=accountAuth.state.session?.user.id;if(!id)return;try{localStorage.setItem(presencePrivacyKey(id),show?"on":"off");}catch{}updateOwnPresence();}
function updateOwnPresence():void{if(!presence||!accountAuth.state.session?.user.id)return;const phase=timer.state.phase,status=phase==="focusing"?"FOCUSING":phase==="paused"?"PAUSED":"ONLINE",line=status==="ONLINE"?undefined:lineName(state.activeJourney?.lineId??""),remaining=status==="ONLINE"?undefined:Math.ceil(timer.remainingMs()/60000);presence.setActivity({status,subjectLine:line,remainingMinutes:remaining},sharesPresenceActivity());}
async function refreshPresenceFriends():Promise<void>{if(!presence||!friendStore||!profiles?.profile||presenceRelationsLoading)return;presenceRelationsLoading=true;try{const relations=await friendStore.relations();await presence.setFriends(relations.filter(r=>r.relationship_status==="accepted").map(r=>r.peer_user_id));}catch{}finally{presenceRelationsLoading=false;}}

let state: AppState = createEmptyState();
let lastSaved = structuredClone(state);
const timer = new JourneyTimer();
let activeStation: Station | null = null;
let timerInterval: number | null = null;
let closeConfirmation: (() => void) | null = null;
let maintenanceTimeout: number | null = null;
let departureTimeout: number | null = null;

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) throw new Error("#app not found");
const app: HTMLDivElement = appEl;
let renderedSection = "";

const logoMarkup = (className="shell-logo"):string => `<img class="${className}" src="/study-metro-logo.png" alt="Study Metro">`;
const routeDiagram = ():string => `<div class="route-animation" aria-hidden="true"><svg viewBox="0 0 900 520" preserveAspectRatio="xMidYMid slice"><defs><pattern id="technical-grid" width="48" height="48" patternUnits="userSpaceOnUse"><path class="technical-grid" d="M48 0H0V48"/></pattern></defs><rect width="100%" height="100%" fill="url(#technical-grid)"/><path class="route-grid-line route-a" pathLength="1" d="M-40 390H170Q220 390 220 340V210Q220 160 270 160H530Q580 160 580 110V-30"/><path class="route-grid-line route-b" pathLength="1" d="M90 560V430Q90 380 140 380H420Q470 380 470 330V260Q470 210 520 210H940"/><path class="route-grid-line route-c" pathLength="1" d="M-30 90H170Q220 90 220 140V300Q220 350 270 350H710Q760 350 760 400V560"/>${[[90,430],[220,300],[220,160],[390,160],[580,110],[140,380],[470,330],[620,210],[220,90],[470,350],[760,400]].map((p,i)=>`<circle class="route-station station-${i%4}" cx="${p[0]}" cy="${p[1]}" r="7"/>`).join("")}<g class="route-train"><rect x="-15" y="-10" width="30" height="20" rx="2"/><path d="M-8-4h6v7h-6m10-7h6v7H2"/></g></svg></div>`;

function shellPath():AppRoute {const route=appRoute(location.pathname);return route&&route.startsWith("/")&&!["/login","/signup","/"].includes(route)?route as AppRoute:"/network";}
function clearRoutedPage():void {
  document.querySelectorAll<HTMLElement>(".app-page-root").forEach(root=>{const close=root.querySelector<HTMLButtonElement>(".modal-close");if(close)close.click();else root.remove();});
  document.body.classList.remove("section-page-open","auth-page-open","landing-open");
  document.body.removeAttribute("data-app-route"); renderedSection="";
}
function releasePageInert():void {app.inert=false;document.querySelectorAll<HTMLElement>(".topbar, .app-page-root").forEach(el=>el.inert=false);}
function promotePage(root:HTMLElement|null,path:string):void {if(!root)return;root.classList.add("app-page-root");root.querySelector(".modal-backdrop")?.classList.add("section-backdrop");const section=root.querySelector<HTMLElement>(".modal-card");if(section){section.removeAttribute("aria-modal");section.setAttribute("role","main");}root.onkeydown=null;document.body.classList.add("section-page-open");document.body.dataset.appRoute=path;releasePageInert();document.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach(link=>link.classList.toggle("is-active",link.getAttribute("href")===path));}
function decorateSettings(root:HTMLElement|null):void{const section=root?.querySelector<HTMLElement>(".account-dialog");if(!section||section.querySelector(".settings-heading"))return;section.insertAdjacentHTML("afterbegin",`<div class="settings-heading"><p class="eyebrow">SYSTEM CONTROL</p><h1>Settings</h1></div>${accountAuth.state.session?`<section class="settings-row"><div><strong>ACTIVITY</strong><span>Share live journey status with accepted friends.</span></div><label class="presence-privacy"><input type="checkbox" data-settings-presence ${sharesPresenceActivity()?"checked":""}><span>Show activity to friends</span></label></section>`:""}`);section.querySelector<HTMLInputElement>("[data-settings-presence]")?.addEventListener("change",event=>setPresencePrivacy((event.currentTarget as HTMLInputElement).checked));}
function bindRouteLinks():void {document.querySelectorAll<HTMLAnchorElement>("[data-route]").forEach(link=>link.addEventListener("click",event=>{event.preventDefault();navigateTo(link.getAttribute("href")||"/network");}));}
function playNetworkEntrance():void{document.body.classList.remove("network-enter");requestAnimationFrame(()=>{document.body.classList.add("network-enter");window.setTimeout(()=>document.body.classList.remove("network-enter"),1500);});}
function navigateTo(path:string,replace=false):void {if(document.body.classList.contains("focus-mode"))return;const target=appRoute(path)??"/network";if(replace)history.replaceState({},"",target);else if(location.pathname!==target)history.pushState({},"",target);clearRoutedPage();if(target==="/"){renderLanding();return;}if(target==="/login"||target==="/signup"){renderAuthRoute(target==="/signup");return;}if(target==="/network")playNetworkEntrance();render();void renderRoutedSection();}

function renderLanding():void {clearRoutedPage();document.body.classList.add("landing-open");app.innerHTML=`<main class="landing-shell">${routeDiagram()}<section class="landing-content">${logoMarkup("landing-logo")}<p class="landing-kicker">STUDY METRO</p><h1>Turn your syllabus into a journey.</h1><div class="landing-actions"><button class="primary-button" data-landing-login>Log in <span>→</span></button><button class="secondary-button" data-landing-signup>Create account</button><button class="text-button" data-landing-guest>Continue as guest</button></div></section><p class="landing-status">NETWORK ACCESS / PUBLIC BETA</p></main>`;document.querySelector("[data-landing-login]")?.addEventListener("click",()=>navigateTo("/login"));document.querySelector("[data-landing-signup]")?.addEventListener("click",()=>navigateTo("/signup"));document.querySelector("[data-landing-guest]")?.addEventListener("click",()=>navigateTo("/network"));}
function renderAuthRoute(signup:boolean):void {clearRoutedPage();app.innerHTML=`<main class="auth-route-underlay"></main>`;if(!showAccount(accountAuth,bindModalClose,cloudSync,openOwnProfile))return;const root=document.querySelector<HTMLElement>("#account-modal-root");if(!root)return;root.querySelector(".modal-backdrop")?.insertAdjacentHTML("afterbegin",`<section class="auth-route-visual">${routeDiagram()}${logoMarkup("auth-route-logo")}<button class="text-button auth-route-back" data-auth-back>← Entrance</button><p class="eyebrow">${signup?"NEW RIDER REGISTRATION":"NETWORK ACCESS GATE"}</p><h1>${signup?"Create your route identity.":"Resume your study journey."}</h1></section>`);if(signup)root.querySelector<HTMLButtonElement>("[data-auth-mode='signup']")?.click();document.body.classList.add("auth-page-open");document.body.dataset.appRoute=signup?"/signup":"/login";root.classList.add("app-page-root");root.querySelector(".modal-backdrop")?.classList.add("auth-route-backdrop");root.querySelector("[data-auth-back]")?.addEventListener("click",()=>navigateTo("/"));releasePageInert();}

async function renderRoutedSection():Promise<void>{const path=shellPath();if(path==="/network"||renderedSection===path)return;renderedSection=path;document.body.dataset.appRoute=path;if(routeNeedsAccount(path)&&!accountAuth.state.session){showAccount(accountAuth,bindModalClose,cloudSync,openOwnProfile);const root=document.querySelector<HTMLElement>("#account-modal-root");if(path==="/settings")decorateSettings(root);promotePage(root,path);return;}if(path==="/departures")showTimetable();else if(path==="/friends")await showFriends();else if(path==="/recap")showWeeklyRecap();else if(path==="/profile"){if(profiles?.profile)showProfile();else showProfileSetup();}else if(path==="/settings")showAccount(accountAuth,bindModalClose,cloudSync,openOwnProfile);const root=path==="/profile"?document.querySelector<HTMLElement>("#profile-modal-root"):path==="/settings"?document.querySelector<HTMLElement>("#account-modal-root"):modalRoot();if(path==="/settings")decorateSettings(root);promotePage(root,path);}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanName(value: FormDataEntryValue | null, fallback = "Untitled"): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.slice(0, 64) || fallback;
}

function parseTopics(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\n|;/)
    .map((topic) => topic.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function stationById(id: string | null): Station | null {
  if (!id) return null;
  return state.stations.find((station) => station.id === id) ?? null;
}

function lineById(id: string | null): MetroLine | null {
  if (!id) return null;
  return state.lines.find((line) => line.id === id) ?? null;
}

function lineName(lineId: string): string {
  return lineById(lineId)?.name ?? "LINE";
}

function totalFocusedSeconds(): number {
  return state.history.reduce((sum, journey) => sum + journey.focusedSeconds, 0);
}

function totalCompletedStations(): number {
  return state.stations.filter((station) => station.status === "completed" || station.status === "mastered").length;
}

function formatHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function persist(): void {
  try { writeState(state); }
  catch {
    state = structuredClone(lastSaved);
    if (state.activeJourney) timer.restore(state.activeJourney.timer); else timer.reset();
    activeStation = stationById(state.activeJourney?.stationId ?? null);
    if (timerInterval !== null) window.clearInterval(timerInterval);
    timerInterval = null;
    showStorageError();
    throw new SaveFailure();
  }
}

class SaveFailure extends Error {}
function writeState(next: AppState): void {
  if (cloudSync?.userId) cloudSync.save(next); else saveState(next);
  lastSaved = structuredClone(next);
  scheduleOwnStats(next);
}

function replaceNetwork(next: AppState): void {
  closeConfirmation?.(); closeConfirmation = null;
  document.querySelectorAll<HTMLButtonElement>(".modal-backdrop .modal-close").forEach(button => button.click());
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null; timer.reset(); activeStation = null;
  state = structuredClone(next); lastSaved = structuredClone(next);
  document.body.classList.remove("focus-mode");
  try { bootstrap(); } catch (error) { if (!(error instanceof SaveFailure)) throw error; }
  scheduleOwnStats();
}

function reconcileAccount(): void {
  if (!appReady || !cloudSync || accountAuth.state.loading) return;
  const id = accountAuth.state.session?.user.id ?? null;
  if (profiles && id !== profiles.userId) { promptedProfile = null; if (id) { statsSync?.enter(id); void presence?.enter(id).then(()=>{updateOwnPresence();void refreshPresenceFriends();}).catch(()=>{}); void profiles.enter(id); } else { profiles.leave(); statsSync?.leave(); void presence?.leave(); } }
  else if(id) void presence?.refreshAuth().catch(()=>{});
  if (id === cloudSync.userId) return; // Token refreshes never restart sync or reload the network.
  promptedAccount = null;
  if (id) {
    const guest = loadState();
    void cloudSync.enter(id, isStorageReadOnly() ? createEmptyState() : guest);
  } else {
    cloudSync.leave();
    const guest = loadState();
    if (isStorageReadOnly()) { location.reload(); return; }
    replaceNetwork(guest);
  }
}

function showProfileSetup(): boolean {
  if (!profiles?.userId || profiles.loading || profiles.profile || document.querySelector("#profile-modal-root") || document.querySelector(".modal-backdrop") || document.body.classList.contains("focus-mode")) return false;
  if (profiles.error) { const modal=document.createElement("div");modal.id="profile-modal-root";modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-error-title"><button class="modal-close" data-action="close-modal" aria-label="Close profile status">×</button><p class="eyebrow">IDENTITY SERVICE / DELAYED</p><h2 id="profile-error-title">Profile unavailable</h2><p class="modal-copy">${escapeHtml(profiles.error)}</p><button class="secondary-button" data-profile-retry>Retry profile</button></section></div>`;document.body.append(modal);bindModalClose(modal);modal.querySelector("[data-profile-retry]")?.addEventListener("click",async()=>{const button=modal.querySelector<HTMLButtonElement>("[data-profile-retry]")!;button.disabled=true;await profiles.retry();if(profiles.profile){modal.querySelector<HTMLButtonElement>(".modal-close")?.click();showProfile();}else{button.disabled=false;modal.querySelector<HTMLElement>(".modal-copy")!.textContent=profiles.error;}});return true; }
  const modal=document.createElement("div");modal.id="profile-modal-root";modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-setup-title"><button class="modal-close" data-action="close-modal" aria-label="Close profile setup">×</button><p class="eyebrow">IDENTITY SERVICE / FIRST RUN</p><h2 id="profile-setup-title">Choose your route identity</h2><p class="modal-copy">Your username is permanent for this beta. Profiles begin private.</p><form class="setup-form compact-form" id="profile-setup-form" novalidate><label><span>Username</span><input name="username" autocomplete="username" minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" autocapitalize="none" spellcheck="false" required aria-describedby="username-rules"></label><small id="username-rules" class="fine-print">3–20 lowercase letters, numbers, or underscores.</small><label><span>Display name · optional</span><input name="displayName" maxlength="40" autocomplete="name"></label><p class="validation-message" role="alert"></p><button class="secondary-button" type="submit">Create profile</button></form></section></div>`;document.body.append(modal);bindModalClose(modal);
  const form=modal.querySelector<HTMLFormElement>("form")!;form.addEventListener("submit",async event=>{event.preventDefault();if(profiles.busy)return;const data=new FormData(form),username=String(data.get("username")??""),display=String(data.get("displayName")??"");const invalid=usernameError(username)||profileInputError(display,"");if(formError(form,invalid))return;form.querySelectorAll<HTMLInputElement|HTMLButtonElement>("input,button").forEach(x=>x.disabled=true);const ok=await profiles.create(username,display);if(ok){modal.querySelector<HTMLButtonElement>(".modal-close")?.click();showProfile();}else{formError(form,profiles.error);form.querySelectorAll<HTMLInputElement|HTMLButtonElement>("input,button").forEach(x=>x.disabled=false);form.querySelector<HTMLInputElement>("[name='username']")?.focus();}});return true;
}

function joinedDate(value:string):string {const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat(undefined,{day:"numeric",month:"long",year:"numeric"}).format(date):"Unknown";}
function nearestExamLabel():string {const exam=state.exams.map(item=>({item,days:daysUntil(item.examDate)})).filter(x=>x.days>=0).sort((a,b)=>a.days-b.days)[0];return exam?`${exam.item.name} · ${exam.days} ${exam.days===1?"day":"days"}`:"No terminal scheduled";}
function profileFacts():string {return `<dl class="profile-facts"><div><dt>Focus time</dt><dd>${formatHours(totalFocusedSeconds())}</dd></div><div><dt>Journeys</dt><dd>${state.history.length}</dd></div><div><dt>Completed stations</dt><dd>${state.stations.filter(isCompletedStation).length}</dd></div><div><dt>Subject lines</dt><dd>${state.lines.length}</dd></div><div><dt>Nearest exam</dt><dd>${escapeHtml(nearestExamLabel())}</dd></div><div><dt>Joined</dt><dd>${joinedDate(profiles!.profile!.created_at)}</dd></div></dl>`;}
function showProfile():void {const p=profiles?.profile;if(!p)return;const modal=document.createElement("div");modal.id="profile-modal-root";modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title"><button class="modal-close" data-action="close-modal" aria-label="Close profile">×</button><p class="eyebrow">PASSENGER RECORD / ${p.is_public?"PUBLIC":"PRIVATE"}</p><h2 id="profile-title">${escapeHtml(p.display_name||`@${p.username}`)}</h2><p class="profile-username">@${escapeHtml(p.username)}</p>${p.bio?`<p class="profile-bio">${escapeHtml(p.bio)}</p>`:""}${profileFacts()}<div class="profile-actions"><button class="secondary-button" data-profile-edit>Edit profile</button>${p.is_public?`<a class="text-button" href="/u/${encodeURIComponent(p.username)}">View public page</a>`:""}</div></section></div>`;document.body.append(modal);bindModalClose(modal);modal.querySelector("[data-profile-edit]")?.addEventListener("click",()=>{modal.querySelector<HTMLButtonElement>(".modal-close")?.click();showProfileEdit();});}
function showProfileEdit():void {const p=profiles?.profile;if(!p)return;const modal=document.createElement("div");modal.id="profile-modal-root";modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title"><button class="modal-close" data-action="close-modal" aria-label="Close profile editor">×</button><p class="eyebrow">IDENTITY SERVICE / EDIT</p><h2 id="profile-edit-title">Edit profile</h2><form class="setup-form compact-form" novalidate><label><span>Username</span><input value="${escapeHtml(p.username)}" disabled></label><label><span>Display name · optional</span><input name="displayName" maxlength="40" value="${escapeHtml(p.display_name??"")}"></label><label><span>Bio · optional</span><textarea name="bio" maxlength="240" rows="4">${escapeHtml(p.bio)}</textarea></label><label class="profile-visibility"><input type="checkbox" name="isPublic" ${p.is_public?"checked":""}><span>Public profile</span></label><p class="auth-local-note">Public pages show only identity and aggregate study statistics. Email, notes, timetable details and exams remain private.</p><p class="validation-message" role="alert"></p><button class="secondary-button" type="submit">Save profile</button></form></section></div>`;document.body.append(modal);bindModalClose(modal);const form=modal.querySelector<HTMLFormElement>("form")!;form.addEventListener("submit",async event=>{event.preventDefault();if(profiles.busy)return;const data=new FormData(form),display=String(data.get("displayName")??""),bio=String(data.get("bio")??"");if(formError(form,profileInputError(display,bio)))return;form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>("input,textarea,button").forEach(x=>x.disabled=true);const ok=await profiles.update(display,bio,data.get("isPublic")==="on");if(ok){modal.querySelector<HTMLButtonElement>(".modal-close")?.click();showProfile();}else{formError(form,profiles.error);form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement>("input,textarea,button").forEach(x=>x.disabled=false);}});}

async function renderPublicProfile(username:string):Promise<void>{document.body.classList.remove("focus-mode");app.innerHTML=`<main class="public-profile-shell"><p class="eyebrow" role="status">Checking passenger record…</p></main>`;if(!supabase){renderPublicProfileError("Public profiles are unavailable on this build.");return;}try{const profile=await new ProfileStore(supabase).public(username);if(!profile){renderPublicProfileError("This passenger record does not exist.");return;}if(!profile.is_public){app.innerHTML=`<main class="public-profile-shell"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></a><section class="public-profile-board"><p class="eyebrow">PASSENGER RECORD / PRIVATE</p><h1>@${escapeHtml(username)}</h1><p>This profile is private.</p><a class="secondary-button" href="/">Return to network</a></section></main>`;return;}const lines=(profile.subject_lines??[]).map(name=>`<li>${escapeHtml(name)}</li>`).join("");app.innerHTML=`<main class="public-profile-shell"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></a><section class="public-profile-board"><p class="eyebrow">PUBLIC PASSENGER RECORD</p><h1>${escapeHtml(profile.display_name||`@${username}`)}</h1><p class="profile-username">@${escapeHtml(username)}</p><dl class="profile-facts"><div><dt>Focus time</dt><dd>${formatHours(profile.focus_seconds??0)}</dd></div><div><dt>Journeys</dt><dd>${profile.journeys??0}</dd></div><div><dt>Completed stations</dt><dd>${profile.completed_stations??0}</dd></div><div><dt>Subject lines</dt><dd>${profile.subject_lines?.length??0}</dd></div><div><dt>Joined</dt><dd>${profile.joined_at?joinedDate(profile.joined_at):"Unknown"}</dd></div></dl>${lines?`<div class="profile-lines"><p class="eyebrow">LINES IN SERVICE</p><ul>${lines}</ul></div>`:""}<a class="secondary-button" href="/">Return to network</a></section></main>`;}catch{renderPublicProfileError("Public profile service is temporarily unavailable.");}}
function renderPublicProfileError(message:string):void{app.innerHTML=`<main class="public-profile-shell"><a class="brand" href="/">STUDY METRO</a><section class="public-profile-board"><p class="eyebrow">PASSENGER RECORD / UNAVAILABLE</p><h1>Station unavailable</h1><p>${escapeHtml(message)}</p><a class="secondary-button" href="/">Return to network</a></section></main>`;}
function showStorageError(): void {
  if (document.querySelector(".storage-error")) return;
  const message = document.createElement("div");
  message.className = "storage-error";
  message.setAttribute("role", "alert");
  message.innerHTML = `Changes could not be saved. Browser storage may be full, unavailable, or from a newer version. Reload to recover the last saved state. <button type="button">Reload</button>`;
  message.querySelector("button")!.addEventListener("click", () => location.reload());
  document.body.append(message);
}
window.addEventListener("error", (event) => { if (event.error instanceof SaveFailure) event.preventDefault(); });

function formError(form: Element, error: string | null): boolean {
  let message = form.querySelector<HTMLElement>(".validation-message");
  if (!message) { message = document.createElement("p"); message.className = "validation-message"; message.setAttribute("role", "alert"); form.append(message); }
  message.textContent = error ?? "";
  return !!error;
}

function relayoutAndPersist(): void {
  state = relayoutStations(state);
  persist();
}

function ensureSelection(): void {
  if (state.selectedStationId && stationById(state.selectedStationId)) return;
  state.selectedStationId = state.lines.flatMap((line) => line.stationIds)[0] ?? null;
}

function createLine(name: string, color: string, topics: string[]): { line: MetroLine; stations: Station[] } {
  const lineId = uid("line");
  const stations = (topics.length ? topics : ["First topic"]).map((topic) => ({
    ...emptyRevisionInfo(),
    id: uid("station"),
    lineId,
    name: topic,
    x: 0,
    y: 0,
    status: "not_started" as StationStatus,
    estimatedMinutes: 50
  }));
  const line: MetroLine = {
    id: lineId,
    name: name.slice(0, 40),
    color,
    stationIds: stations.map((station) => station.id)
  };
  return { line, stations };
}

function renderOnboarding(): void {
  document.body.classList.remove("focus-mode");
  app.innerHTML = `
    <main class="onboarding-shell">
      <header class="onboarding-brand">
        <a class="brand" href="#" aria-label="Study Metro home">
          <span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span>
          <span>STUDY METRO</span>
        </a>
        <div class="onboarding-account"><span class="build-label">PUBLIC BETA</span>${accountControl()}</div>
      </header>

      <section class="onboarding-grid">
        <div class="onboarding-copy">
          <p class="eyebrow">BUILD YOUR FIRST LINE</p>
          <h1>Turn your syllabus into a network.</h1>
          <p>Subjects become lines. Topics become stations. Every focused journey moves your real academic map forward.</p>
          <div class="onboarding-diagram" aria-hidden="true">
            <span class="diagram-line"></span>
            <i></i><i></i><i></i><i></i><i></i>
            <b>YOUR FIRST SUBJECT</b>
          </div>
        </div>

        <form class="setup-form" id="setup-form">
          <label>
            <span>What are you studying?</span>
            <input name="studyArea" maxlength="64" placeholder="e.g. Medicine" required autocomplete="off" />
          </label>
          <label>
            <span>Semester / exam period</span>
            <input name="periodName" maxlength="64" placeholder="e.g. Semester 4" required autocomplete="off" />
          </label>
          <div class="setup-rule"></div>
          <label>
            <span>First subject line</span>
            <input name="lineName" maxlength="40" placeholder="e.g. Anatomy" required autocomplete="off" />
          </label>
          <label>
            <span>Topics · one per line</span>
            <textarea name="topics" rows="7" placeholder="Thorax&#10;Abdomen&#10;Pelvis&#10;Perineum&#10;Head & Neck" required></textarea>
          </label>
          <label class="color-field">
            <span>Line colour</span>
            <input type="color" name="lineColor" value="${LINE_COLORS[0]}" />
          </label>
          <button class="primary-button" type="submit"><span>Generate my network</span><span>→</span></button>
          <small class="fine-print">${cloudSync?.userId ? "Your account network is saved locally and synced when connected. Wait for Synced before switching devices." : "Your network is saved in this browser on this device. Clearing browser data removes it."}</small>
        </form>
      </section>
    </main>
  `;

  refreshAccountControls(accountAuth, cloudSync, profiles?.profile?.username);
  document.querySelector<HTMLFormElement>("#setup-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const topics = parseTopics(data.get("topics"));
    const form = event.currentTarget as HTMLFormElement;
    if (formError(form, nameError(String(data.get("studyArea"))) ?? nameError(String(data.get("periodName"))) ?? nameError(String(data.get("lineName")), [], 40) ?? topicsError(topics))) return;
    const { line, stations } = createLine(cleanName(data.get("lineName"), "My Subject"), String(data.get("lineColor") ?? LINE_COLORS[0]), topics);
    state = relayoutStations({
      ...state,
      profile: {
        studyArea: cleanName(data.get("studyArea"), "My Studies"),
        periodName: cleanName(data.get("periodName"), "Current Term"),
        createdAt: Date.now()
      },
      lines: [line],
      stations,
      selectedStationId: stations[0]?.id ?? null,
      activeJourney: null
    });
    persist();
    render();
  });

}

function examDaysMessage(days: number): string {
  if (days === 0) return "Exam today";
  return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "until" : "since"} exam`;
}

function renderExamBoard(exam: Exam): string {
  const line = lineById(exam.lineId);
  const stats = examProgress(state, exam);
  const code = String(state.lines.findIndex((item) => item.id === exam.lineId) + 1).padStart(2, "0");
  return `<aside class="journey-panel exam-board" aria-label="Exam terminal details" data-exam-id="${escapeHtml(exam.id)}" style="--route-color:${displayLineColor(line?.color ?? "#eeeae2")}">
    <div class="departure-heading"><p class="eyebrow">EXAM TERMINAL</p><span>${code} / E</span></div>
    <div class="station-information">
      <div class="route-badge"><span class="route-code">${code}</span><span>${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span></div>
      <h2>${escapeHtml(exam.name)}</h2>
      <p class="exam-date">${examDateLabel(exam.examDate)}</p>
      <p class="exam-days" data-exam-days-message>${examDaysMessage(stats.daysRemaining)}</p>
      <dl class="station-facts exam-facts">
        <div><dt>Total study stations</dt><dd>${stats.total}</dd></div>
        <div><dt>Completed</dt><dd>${stats.completed}</dd></div>
        <div><dt>Remaining</dt><dd>${stats.remaining}</dd></div>
        <div><dt>Estimated remaining</dt><dd>${stats.estimatedMinutes}<span> min</span></dd></div>
      </dl>
      ${exam.targetCompletionDate ? `<p class="exam-target">Target completion<br><strong>${examDateLabel(exam.targetCompletionDate)}</strong></p>` : ""}
      <p class="exam-status" data-exam-status>${stats.status}</p>
      <p class="exam-note">Pace check: one unfinished station per calendar day, before ${exam.targetCompletionDate ? "your target date" : "the exam date"}.</p>
    </div>
    <div class="exam-board-actions"><button class="secondary-button" data-action="edit-exam" data-line-id="${escapeHtml(exam.lineId)}">Edit exam <span aria-hidden="true">↗</span></button><button class="text-button danger" data-action="remove-selected-exam">Remove exam</button><p class="exam-note">Select a study station on the map to begin a journey.</p></div>
  </aside>`;
}

function render(): void {
  if (!state.profile || !state.lines.length) {
    renderOnboarding();
    return;
  }

  ensureSelection();
  const selected = stationById(state.selectedStationId);
  const selectedExam = state.exams.find((exam) => exam.id === state.selectedExamId) ?? null;
  if (!selected) {
    app.innerHTML = `<main class="modal-card"><p class="eyebrow">STUDY METRO</p><h1>Your network needs a station.</h1><p>Add a topic to an existing line to begin. Your saved lines and history are still here.</p><button class="secondary-button" id="repair-network">Edit network</button></main><div id="modal-root"></div>`;
    document.querySelector("#repair-network")?.addEventListener("click", () => showNetworkEditor(state.lines[0]?.id ?? null));
    return;
  }

  const selectedDuration = state.preferredDuration;
  const revision = isCompletedStation(selected);
  const maintenanceDue = isMaintenanceDue(selected);
  const quickDurations = revision ? [25, 50] : [25, 50, 90];
  const isQuickDuration = quickDurations.includes(selectedDuration);
  const periodLabel = state.profile.periodName.toUpperCase();
  const selectedLine = lineById(selected.lineId);
  const selectedLineCode = String(state.lines.findIndex((line) => line.id === selected.lineId) + 1).padStart(2, "0");
  const selectedStationCode = String((selectedLine?.stationIds.indexOf(selected.id) ?? 0) + 1).padStart(2, "0");

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/network" data-route aria-label="Study Metro network">
        <span class="header-logo-frame" aria-hidden="true"><img src="/study-metro-logo.png" alt=""></span>
        <span>STUDY METRO</span>
      </a>
      <div class="header-controls"><nav class="nav-tabs" aria-label="Primary">
        <a class="nav-tab ${shellPath()==="/network"?"is-active":""}" href="/network" data-route>Network</a>
        <a class="nav-tab ${shellPath()==="/departures"?"is-active":""}" href="/departures" data-route>Departures</a>
        <a class="nav-tab ${shellPath()==="/friends"?"is-active":""}" href="/friends" data-route>Friends</a>
        <a class="nav-tab ${shellPath()==="/recap"?"is-active":""}" href="/recap" data-route>Recap</a>
        <a class="nav-tab ${shellPath()==="/profile"?"is-active":""}" href="/profile" data-route>Profile</a>
      </nav>${accountControl()}</div>
    </header>

    <main class="shell">
      <section class="network-panel">
        <div class="network-heading">
          <div>
            <p class="eyebrow">${escapeHtml(state.profile.studyArea.toUpperCase())} · ${escapeHtml(periodLabel)}</p>
            <h1>Your study network.</h1>
            <p class="network-maintenance" id="network-maintenance" aria-live="polite" hidden></p>
            <p class="network-presence" id="network-presence" aria-live="polite" hidden></p>
          </div>
          <div class="network-heading-actions">
            <button class="text-button network-add-exam" data-action="add-exam">+ Add exam</button>
            <button class="text-button" data-action="history">Journey log</button>
            <button class="text-button" data-action="edit-network">Edit network</button>
            <div class="network-stats" aria-label="Study statistics">
              <div><strong>${state.history.length}</strong><span>journeys</span></div>
              <div><strong>${totalCompletedStations()}</strong><span>stations</span></div>
              <div><strong>${formatHours(totalFocusedSeconds())}</strong><span>focused</span></div>
            </div>
          </div>
        </div>

        <div class="network-departures" aria-label="Next departure">
          <div id="next-departure"></div>
          <button class="text-button" data-action="schedule-journey">Schedule journey <span aria-hidden="true">+</span></button>
        </div>
        <div id="map-root" class="map-wrap" tabindex="0" role="region" aria-label="Study network map. Scroll to explore all stations."></div>

        <div class="legend" aria-label="Station legend">
          <span><i class="legend-dot completed"></i>Completed</span>
          <span><i class="legend-dot active"></i>In progress</span>
          <span><i class="legend-dot empty"></i>Not started</span>
          <span><i class="legend-dot terminal"></i>Terminal</span>
          <span><i class="legend-dot maintenance"></i>Maintenance due</span>
        </div>
      </section>

      ${selectedExam ? renderExamBoard(selectedExam) : `<aside class="journey-panel ${revision ? "maintenance-board" : ""}" aria-label="Station departure board" style="--route-color:${displayLineColor(selectedLine?.color ?? "#eeeae2")}">
        <div class="departure-heading"><p class="eyebrow">DEPARTURE BOARD</p><span>${selectedLineCode} / ${selectedStationCode}</span></div>
        <div class="station-information">
          <div class="route-badge"><span class="route-code">${selectedLineCode}</span><span>${escapeHtml(lineName(selected.lineId).toUpperCase())}</span></div>
          <p class="board-label">SELECTED STATION</p>
          <h2>${escapeHtml(selected.name)}</h2>
          <dl class="station-facts"><div><dt>Estimated study time</dt><dd>${selected.estimatedMinutes}<span> min</span></dd></div></dl>
          ${revision ? `<dl class="maintenance-facts"><div><dt>Last studied</dt><dd>${maintenanceDate(selected.lastReviewedAt)}</dd></div><div><dt>Review count</dt><dd>${selected.reviewCount}</dd></div><div><dt>Next maintenance</dt><dd>${maintenanceDate(selected.nextReviewAt)}</dd></div></dl>` : ""}
        </div>
        <div class="departure-settings">
        <p class="board-label">FOCUS DURATION <span>MINUTES</span></p>
        <div class="duration-picker ${revision ? "revision-duration-picker" : ""}" role="group" aria-label="Focus duration">
          ${quickDurations.map((duration) => `<button class="duration-button ${selectedDuration === duration ? "is-selected" : ""}" data-duration="${duration}" aria-label="${duration} minutes, ${duration === 25 ? "Local" : duration === 50 ? "Express" : "Limited"}"><strong>${duration}</strong><span>${duration === 25 ? "Local" : duration === 50 ? "Express" : "Limited"}</span></button>`).join("")}
        </div>
        <label class="custom-duration">
          <span>Custom</span>
          <input id="custom-duration" type="number" inputmode="numeric" min="5" max="240" value="${isQuickDuration ? "" : selectedDuration}" placeholder="min" />
        </label>
        <p class="duration-label">${selectedDuration} minutes · ${durationMode(selectedDuration)}</p>
        </div>
        <div class="departure-service">
        <div class="service-status">
          <span class="status-light ${maintenanceDue ? "maintenance-indicator" : ""}" id="station-service-indicator"></span>
          <div>
            <strong id="station-service-label">${maintenanceDue ? "MAINTENANCE DUE" : "Normal service"}</strong>
            <small id="station-service-description">${maintenanceDue ? "A revision journey is recommended" : "Ready for departure"}</small>
          </div>
        </div>
        <button class="primary-button" data-action="start" data-duration-selected="${selectedDuration}">
          <span>${revision ? "Start revision" : "Start journey"}</span><span aria-hidden="true">→</span>
        </button>
        </div>
      </aside>`}
    </main>


    <footer class="footer">
      <span>Study Metro · Beta</span>
      <div class="footer-actions">
        <button class="text-button" data-action="weekly-recap">Weekly recap</button>
        <button class="text-button" data-action="reset">Start over</button>
      </div>
    </footer>

    <div id="modal-root"></div>
  `;

  const mapRoot = document.querySelector<HTMLElement>("#map-root");
  if (mapRoot) {
    renderMetroMap(mapRoot, state, (stationId) => {
      const { scrollLeft, scrollTop } = mapRoot;
      const restoreFocus = mapRoot.contains(document.activeElement);
      state.selectedExamId = null;
      state.selectedStationId = stationId;
      persist();
      render();
      const nextMap = document.querySelector<HTMLElement>("#map-root");
      if (nextMap) {
        nextMap.scrollTo(scrollLeft, scrollTop);
        if (restoreFocus) {
          nextMap.querySelector<SVGElement>(".metro-station.is-selected")?.focus({ preventScroll: true });
        }
      }
    }, (examId) => {
      const { scrollLeft, scrollTop } = mapRoot;
      state.selectedExamId = examId;
      persist();
      render();
      const nextMap = document.querySelector<HTMLElement>("#map-root");
      nextMap?.scrollTo(scrollLeft, scrollTop);
      nextMap?.querySelector<SVGElement>(".exam-terminal.is-selected")?.focus({ preventScroll: true });
    }, (lineId) => showExamModal(lineId));
  }

  bindInteractions();
  bindRouteLinks();
  refreshAccountControls(accountAuth, cloudSync, profiles?.profile?.username);
  refreshMaintenance();
  refreshDepartures();
  refreshPresenceUi();
  document.querySelector<HTMLElement>("[data-action='edit-exam']")?.addEventListener("click", (event) => {
    showExamModal((event.currentTarget as HTMLElement).dataset.lineId ?? null);
  });
  document.querySelector("[data-action='add-exam']")?.addEventListener("click", () => showExamModal());
  document.querySelector("[data-action='remove-selected-exam']")?.addEventListener("click", () => {
    if (selectedExam) confirmAction("Remove this exam? Your subject, stations and journey history will stay.", () => {
      const next = { ...state, exams: state.exams.filter((exam) => exam.id !== selectedExam.id), selectedExamId: null };
      try { writeState(next); state = next; render(); } catch { showStorageError(); }
    });
  });
  if(shellPath()!=="/network")queueMicrotask(()=>void renderRoutedSection());
}

function showExamModal(lineId: string | null = null): void {
  const modal = modalRoot();
  if (!modal) return;
  const existing = state.exams.find((exam) => exam.lineId === lineId);
  const eligible = state.lines.filter((line) => !state.exams.some((exam) => exam.lineId === line.id));
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card exam-dialog" role="dialog" aria-modal="true" aria-label="${existing ? "Edit exam" : "Add exam"}">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
    <p class="eyebrow">EXAM TERMINAL</p><h2>${existing ? "Edit exam" : "Add exam"}</h2>
    ${!existing && !eligible.length ? `<p class="modal-copy">Every subject line already has an exam. Select a terminal on the map to edit or remove it.</p>` : `
    <form id="quick-exam-form" class="setup-form compact-form">
      <label><span>Subject line</span><select name="lineId" ${existing ? "disabled" : ""}>${(existing ? state.lines.filter((line) => line.id === existing.lineId) : eligible).map((line) => `<option value="${escapeHtml(line.id)}" ${line.id === lineId ? "selected" : ""}>${escapeHtml(line.name)}</option>`).join("")}</select></label>
      <label><span>Exam name</span><input name="examName" required maxlength="64" value="${escapeHtml(existing?.name ?? "")}" placeholder="e.g. Anatomy Final" /></label>
      <label><span>Exam date</span><input name="examDate" type="date" required min="1000-01-01" max="9999-12-31" value="${existing?.examDate ?? ""}" /></label>
      <label><span>Target completion <small>optional</small></span><input name="targetDate" type="date" min="1000-01-01" max="9999-12-31" value="${existing?.targetCompletionDate ?? ""}" /></label>
      <p class="exam-form-message" role="status"></p><button class="secondary-button" type="submit">Save exam</button>
    </form>`}</section></div>`;
  bindModalClose(modal);
  const form = modal.querySelector<HTMLFormElement>("#quick-exam-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("examName") ?? "").trim().replace(/\s+/g, " ");
    const examDate = String(data.get("examDate") ?? "");
    const targetCompletionDate = String(data.get("targetDate") ?? "") || null;
    const subjectId = existing?.lineId ?? String(data.get("lineId"));
    const error = validateExam(name, examDate, targetCompletionDate);
    const message = form.querySelector<HTMLElement>(".exam-form-message")!;
    if (error) { message.textContent = error; return; }
    if (!existing && state.exams.some((exam) => exam.lineId === subjectId)) { message.textContent = "This line already has an exam."; return; }
    const exam: Exam = { id: existing?.id ?? uid("exam"), lineId: subjectId, name, examDate, targetCompletionDate };
    const next = { ...state, exams: [...state.exams.filter((item) => item.lineId !== subjectId), exam], selectedExamId: exam.id };
    try { writeState(next); } catch { message.textContent = "Could not save. Browser storage is unavailable or full. Please try again."; return; }
    state = next; render();
    document.querySelector<SVGElement>(".exam-terminal.is-selected")?.focus();
  });
}

function confirmAction(message: string, action: () => void): void {
  closeConfirmation?.();
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true" aria-label="Confirm action"><h2>Are you sure?</h2><p class="modal-copy">${escapeHtml(message)}</p><div class="editor-inline-actions"><button class="secondary-button" data-confirm>Confirm</button><button class="text-button modal-close-cancel" data-action="close-modal">Cancel</button></div></section></div>`;
  const close = bindModalClose(container);
  closeConfirmation = close;
  container.querySelector<HTMLElement>("[data-action='close-modal'] button[data-action='close-modal']")?.focus();
  container.querySelector("[data-confirm]")?.addEventListener("click", () => { close(); action(); });
}

function durationMode(duration: number): string {
  if (duration <= 30) return "Local service";
  if (duration >= 75) return "Deep work";
  return "Express service";
}

function bindInteractions(): void {
  const durationButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-duration]")];
  const startButton = document.querySelector<HTMLButtonElement>("[data-action='start']");
  const customDuration = document.querySelector<HTMLInputElement>("#custom-duration");

  const setDuration = (duration: number): void => {
    if (!Number.isFinite(duration)) return;
    const safeDuration = Math.max(5, Math.min(240, Math.round(duration)));
    state.preferredDuration = safeDuration;
    persist();
    durationButtons.forEach((button) => button.classList.toggle("is-selected", Number(button.dataset.duration) === safeDuration));
    if (startButton) startButton.dataset.durationSelected = String(safeDuration);
    const label = document.querySelector<HTMLElement>(".duration-label");
    if (label) label.textContent = `${safeDuration} minutes · ${durationMode(safeDuration)}`;
  };

  durationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (customDuration) customDuration.value = "";
      setDuration(Number(button.dataset.duration ?? 50));
    });
  });

  customDuration?.addEventListener("change", () => {
    if (!customDuration.value) return;
    if (!validDuration(Number(customDuration.value))) { customDuration.setCustomValidity("Enter a whole number from 5 to 240 minutes."); customDuration.reportValidity(); return; }
    customDuration.setCustomValidity(""); setDuration(Number(customDuration.value));
  });
  customDuration?.addEventListener("input", () => customDuration.setCustomValidity(""));

  startButton?.addEventListener("click", () => {
    if (customDuration && !customDuration.checkValidity()) { customDuration.reportValidity(); return; }
    const station = stationById(state.selectedStationId);
    if (!station) return;
    const duration = customDuration?.value ? Number(customDuration.value) : Number(startButton.dataset.durationSelected ?? state.preferredDuration);
    if (!validDuration(duration)) return;
    state.preferredDuration = duration;
    startJourney(station, duration);
  });

  document.querySelector<HTMLElement>("[data-action='history']")?.addEventListener("click", showHistory);
  document.querySelector<HTMLElement>("[data-action='friends']")?.addEventListener("click", () => navigateTo("/friends"));
  document.querySelector("[data-action='weekly-recap']")?.addEventListener("click", () => navigateTo("/recap"));
  document.querySelector("[data-action='timetable']")?.addEventListener("click", () => navigateTo("/departures"));
  document.querySelector("[data-action='schedule-journey']")?.addEventListener("click", () => showDepartureForm());
  document.querySelectorAll<HTMLElement>("[data-action='edit-network']").forEach((element) => element.addEventListener("click", () => showNetworkEditor(selectedLineIdForEditor())));
  document.querySelector<HTMLElement>("[data-action='reset']")?.addEventListener("click", () => {
    confirmAction(cloudSync?.userId ? "Start over for this account? This replaces its network locally and in the cloud after sync. Your guest network is kept." : "Start over? This removes the Study Metro data stored in this browser.", () => {
    if (cloudSync?.userId) { state = createEmptyState(); persist(); }
    else { try { resetState(); } catch { showStorageError(); return; } state = loadState(); }
    lastSaved = structuredClone(state);
    timer.reset();
    activeStation = null;
    render();
    });
  });
}

function selectedLineIdForEditor(): string | null {
  return state.exams.find((exam) => exam.id === state.selectedExamId)?.lineId ?? stationById(state.selectedStationId)?.lineId ?? state.lines[0]?.id ?? null;
}

function syncActiveJourney(): void {
  if (!state.activeJourney) return;
  state.activeJourney = { ...state.activeJourney, timer: timer.export() };
  persist();
}

function startJourney(station: Station, durationMinutes: number, departureId?: string): void {
  if (state.activeJourney || !validDuration(durationMinutes)) return;
  const departure = departureId ? state.departures.find(item => item.id === departureId) : null;
  if (departureId && (!departure || departure.status !== "scheduled" || departure.linkedJourneyId || departure.stationId !== station.id || departure.lineId !== station.lineId || departure.durationMinutes !== durationMinutes)) return;
  const journeyId = departure ? uid("journey") : undefined;
  activeStation = station;
  timer.start(durationMinutes);
  state.activeJourney = {
    kind: isCompletedStation(station) ? "revision" : "study",
    stationId: station.id,
    lineId: station.lineId,
    durationMinutes,
    previousStationStatus: station.status,
    timer: timer.export()
  };
  if (departure && journeyId) {
    state.activeJourney.departureId = departure.id;
    state.activeJourney.journeyId = journeyId;
    state.departures = state.departures.map(item => item.id === departure.id ? boardDeparture(item, journeyId) : item);
  }
  if (state.activeJourney.kind === "study") state.stations = state.stations.map((item) => item.id === station.id ? { ...item, status: "studying" } : item);
  persist();
  document.body.classList.add("focus-mode");
  renderFocus();
  startTimerLoop();
}

function startTimerLoop(): void {
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = window.setInterval(() => {
    timer.tick();
    renderFocusTick();
    if (timer.state.phase === "complete") finishJourney();
  }, 250);
}

function focusRouteMarkup(origin: string, destination: string, pct: number, arrived = false): string {
  return `
    <div class="focus-route ${arrived ? "has-arrived" : ""}">
      <div class="focus-track" id="focus-route-progress" role="progressbar" aria-label="Journey progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(pct)}">
        <span class="focus-origin" aria-hidden="true"></span>
        <span class="focus-progress" id="focus-progress" style="width:${pct}%" aria-hidden="true"></span>
        <span class="focus-destination" aria-hidden="true"></span>
        <span class="focus-train" id="focus-train" style="left:${pct}%" aria-hidden="true"><svg viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="26" height="15" rx="2"/><path d="M8 8h6v5H8zM18 8h6v5h-6zM8 19v2m16-2v2"/></svg></span>
      </div>
      <div class="focus-stations">
        <div><span>DEPARTURE</span><strong>${escapeHtml(origin)}</strong></div>
        <span class="focus-route-arrow" aria-hidden="true">→</span>
        <div><span>DESTINATION</span><strong>${escapeHtml(destination)}</strong></div>
      </div>
    </div>
  `;
}

function renderFocus(): void {
  if (!activeStation || !state.activeJourney) return;
  const line = lineById(activeStation.lineId);
  const previousStationId = line?.stationIds[line.stationIds.indexOf(activeStation.id) - 1];
  const departure = stationById(previousStationId ?? null)?.name ?? "Line entrance";
  const paused = timer.state.phase === "paused";
  const pct = timer.progress() * 100;
  app.innerHTML = `
    <main class="focus-shell ${paused ? "is-paused" : ""}" style="--focus-line:${displayLineColor(line?.color ?? "#eeeae2")}">
      <header class="focus-topline">
        <div class="brand focus-brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></div>
        <span class="focus-line-name">${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span>
        <button class="focus-exit" data-action="end" aria-label="Exit journey and return to network" title="End this journey and return to the network"><span aria-hidden="true">←</span> Exit</button>
      </header>

      <section class="focus-stage">
        <p class="focus-service" role="status"><span aria-hidden="true"></span>${paused ? "PAUSED" : state.activeJourney.kind === "revision" ? "MAINTENANCE SERVICE" : "IN TRANSIT"}</p>
        <h1>${escapeHtml(activeStation.name)}</h1>
        <div class="focus-time" id="focus-time" role="timer" aria-label="${paused ? "Paused, time remaining" : "Time remaining"}">${formatRemaining(timer.remainingMs())}</div>
        <p class="focus-time-caption">REMAINING</p>
        ${focusRouteMarkup(departure, activeStation.name, pct)}
        <div class="focus-journey-meta"><span>${state.activeJourney.durationMinutes} MIN ${state.activeJourney.kind === "revision" ? "REVISION" : "JOURNEY"}</span><span id="focus-percentage">${Math.floor(pct)}% complete</span></div>
      </section>

      <footer class="focus-controls">
        <button class="secondary-button" data-action="pause">${timer.state.phase === "paused" ? "Resume" : "Pause"}</button>
        <button class="text-button danger" data-action="end">End journey</button>
      </footer>
    </main>
  `;

  document.querySelector<HTMLElement>("[data-action='pause']")?.addEventListener("click", () => {
    togglePause();
    document.querySelector<HTMLElement>("[data-action='pause']")?.focus({ preventScroll: true });
  });
  document.querySelectorAll<HTMLElement>(".focus-shell [data-action='end']").forEach((button) => button.addEventListener("click", cancelJourney));
  renderFocusTick();
}

function renderFocusTick(): void {
  const time = document.querySelector<HTMLElement>("#focus-time");
  const progress = document.querySelector<HTMLElement>("#focus-progress");
  const train = document.querySelector<HTMLElement>("#focus-train");
  if (time) time.textContent = formatRemaining(timer.remainingMs());
  const pct = timer.progress() * 100;
  if (progress) progress.style.width = `${pct}%`;
  if (train) train.style.left = `${pct}%`;
  const percentage = document.querySelector<HTMLElement>("#focus-percentage");
  if (percentage) percentage.textContent = `${Math.floor(pct)}% complete`;
  document.querySelector<HTMLElement>("#focus-route-progress")?.setAttribute("aria-valuenow", String(Math.floor(pct)));
  updateOwnPresence();
}

function togglePause(): void {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  if (timer.state.phase === "paused") {
    timer.resume();
  } else {
    timer.pause();
  }
  syncActiveJourney();
  renderFocus();
}

function finishJourney(): void {
  if (!activeStation || !state.activeJourney) return;
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null;

  const journey = state.activeJourney;
  const now = Date.now();
  const completedAt = Math.min(now, timer.state.targetEndAt ?? now);
  const startedAt = timer.state.startedAt ?? now - journey.durationMinutes * 60_000;
  const record: JourneyRecord = {
    kind: journey.kind,
    id: journey.journeyId ?? uid("journey"),
    stationId: activeStation.id,
    lineId: activeStation.lineId,
    startedAt,
    completedAt,
    focusedSeconds: journey.durationMinutes * 60
  };

  state.history.unshift(record);
  state.departures = state.departures.map(departure => completeDeparture(departure, record));
  state.stations = state.stations.map((station) => station.id === activeStation?.id ? completeStation(station, journey.kind, completedAt) : station);
  state.activeJourney = null;
  persist();
  updateOwnPresence();
  closeConfirmation?.(); closeConfirmation = null;
  renderArrival(activeStation, journey.durationMinutes, journey.kind, record.id);
}

function renderArrival(station: Station, durationMinutes: number, kind: "study" | "revision", journeyId: string): void {
  const line = lineById(station.lineId);
  const previousStationId = line?.stationIds[line.stationIds.indexOf(station.id) - 1];
  const departure = stationById(previousStationId ?? null)?.name ?? "Line entrance";
  app.innerHTML = `
    <main class="focus-shell arrival-shell" style="--focus-line:${displayLineColor(line?.color ?? "#eeeae2")}">
      <header class="focus-topline">
        <div class="brand focus-brand"><span class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></span><span>STUDY METRO</span></div>
        <span class="focus-line-name">${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span>
      </header>
      <section class="focus-stage arrival-board">
        <p class="focus-service" role="status"><span aria-hidden="true"></span>ARRIVED</p>
        <h1 tabindex="-1" id="arrival-title">${escapeHtml(station.name)}</h1>
        <p class="arrival-summary">${durationMinutes} min ${kind === "revision" ? "revision completed" : "completed"}</p>
        ${focusRouteMarkup(departure, station.name, 100, true)}
        <div class="focus-journey-meta"><span>JOURNEY ${String(state.history.length).padStart(4, "0")}</span><span>100% complete</span></div>
      </section>
      <footer class="focus-controls arrival-controls">
        <button class="secondary-button" data-action="view-arrival-ticket">View ticket</button>
        <button class="primary-button" data-action="return">Return to network <span>→</span></button>
      </footer>
    </main>
  `;
  document.querySelector<HTMLElement>("#arrival-title")?.focus({ preventScroll: true });
  document.querySelector("[data-action='view-arrival-ticket']")?.addEventListener("click", () => showTicket(journeyId));
  document.querySelector<HTMLElement>("[data-action='return']")?.addEventListener("click", () => {
    document.body.classList.remove("focus-mode");
    activeStation = null;
    timer.reset();
    render();
  });
}

function cancelJourney(): void {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  confirmAction("End this journey? It will not be added to your journey log.", () => {
  timer.tick();
  if (timer.state.phase === "complete") { finishJourney(); return; }
  const activeJourney = state.activeJourney;
  timer.cancel();
  if (timerInterval !== null) window.clearInterval(timerInterval);
  timerInterval = null;

  if (activeJourney) {
    state.stations = state.stations.map((station) => station.id === activeJourney.stationId ? { ...station, status: activeJourney.previousStationStatus } : station);
    state.departures = state.departures.map(departure => departure.id === activeJourney.departureId ? { ...departure, status: "cancelled" } : departure);
  }
  state.activeJourney = null;
  persist();
  document.body.classList.remove("focus-mode");
  activeStation = null;
  timer.reset();
  updateOwnPresence();
  render();
  });
}

function modalRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("#modal-root");
}

const modalCleanups = new WeakMap<HTMLElement, () => void>();
function bindModalClose(modal: HTMLElement): () => void {
  modalCleanups.get(modal)?.();
  const opener = document.activeElement;
  const siblings = [...(modal.parentElement?.children ?? [])].filter((element): element is HTMLElement => element !== modal && element instanceof HTMLElement);
  const inertBefore = siblings.map((element) => element.inert);
  siblings.forEach((element) => { element.inert = true; });
  const cleanup = (): void => { siblings.forEach((element, index) => { element.inert = inertBefore[index]; }); modalCleanups.delete(modal); };
  modalCleanups.set(modal, cleanup);
  const close = (): void => {
    cleanup();
    modal.innerHTML = "";
    modal.onkeydown = null;
    if ((opener instanceof HTMLElement || opener instanceof SVGElement) && opener.isConnected) opener.focus({ preventScroll: true });
    if (modal.id !== "modal-root") modal.remove();
  };
  modal.querySelectorAll<HTMLElement>("[data-action='close-modal']").forEach((element) => {
    element.addEventListener("click", close);
  });
  modal.querySelector<HTMLElement>(".modal-card")?.addEventListener("click", (event) => event.stopPropagation());
  modal.onkeydown = (event): void => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  modal.querySelector<HTMLElement>(".modal-close")?.focus({ preventScroll: true });
  if(document.body.classList.contains("section-page-open"))queueMicrotask(releasePageInert);
  return close;
}

function departureTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(timestamp);
}

function departureDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(timestamp);
}

function startScheduledDeparture(id: string): void {
  const departure = state.departures.find(item => item.id === id);
  const station = stationById(departure?.stationId ?? null);
  if (!departure || !station || state.activeJourney || departure.status !== "scheduled" || departure.linkedJourneyId) return;
  const modal = modalRoot();
  modal?.querySelector<HTMLButtonElement>(".modal-close")?.click();
  startJourney(station, departure.durationMinutes, departure.id);
}

function departureRow(departure: ScheduledDeparture): string {
  const line = lineById(departure.lineId);
  const status = departureStatus(departure);
  const editable = departure.status === "scheduled" && !departure.linkedJourneyId;
  return `<li class="timetable-row" style="--route-color:${displayLineColor(line?.color ?? "#eeeae2")}">
    <div class="timetable-time"><time datetime="${new Date(departure.scheduledAt).toISOString()}">${departureTime(departure.scheduledAt)}</time><span>${departureDate(departure.scheduledAt)}</span></div>
    <div class="timetable-destination"><span>${escapeHtml(line?.name.toUpperCase() ?? "LINE")}</span><strong>${escapeHtml(stationById(departure.stationId)?.name ?? "Station unavailable")}</strong><small>${departure.durationMinutes} min · <span data-departure-status="${departure.id}">${status}</span></small>${departure.note ? `<p>${escapeHtml(departure.note)}</p>` : ""}</div>
    ${editable ? `<div class="timetable-actions"><button class="text-button" data-departure-start="${departure.id}">${status === "Missed" ? "Start now" : "Start journey"}</button><button class="text-button" data-departure-edit="${departure.id}">${status === "Missed" ? "Reschedule" : "Edit"}</button><button class="text-button" data-departure-cancel="${departure.id}">Cancel</button></div>` : ""}
  </li>`;
}

function timetableContents(): string {
  const pending = state.departures.filter(item => item.status === "scheduled").sort((a, b) => a.scheduledAt - b.scheduledAt);
  const groups = ["EARLIER", "TODAY", "TOMORROW", "UPCOMING"] as const;
  const rows = groups.map(group => {
    const departures = pending.filter(item => departureGroup(item.scheduledAt) === group);
    return departures.length ? `<section class="timetable-group" aria-label="${group}"><h3>${group}</h3><ul>${departures.map(departureRow).join("")}</ul></section>` : "";
  }).join("");
  const ended = state.departures.filter(item => item.status !== "scheduled").sort((a, b) => b.scheduledAt - a.scheduledAt);
  return `${rows || `<p class="modal-copy">No upcoming departures. Schedule a journey for a station on your network.</p>`}${ended.length ? `<details class="timetable-ended"><summary>Completed & cancelled · ${ended.length}</summary><ul>${ended.map(departureRow).join("")}</ul></details>` : ""}`;
}

function bindDepartureRows(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-departure-start]").forEach(button => button.addEventListener("click", () => startScheduledDeparture(button.dataset.departureStart!)));
  root.querySelectorAll<HTMLButtonElement>("[data-departure-edit]").forEach(button => button.addEventListener("click", () => showDepartureForm(button.dataset.departureEdit)));
  root.querySelectorAll<HTMLButtonElement>("[data-departure-cancel]").forEach(button => button.addEventListener("click", () => {
    confirmAction("Cancel this departure? Your station and study progress will stay.", () => {
      state.departures = state.departures.map(item => item.id === button.dataset.departureCancel && item.status === "scheduled" && !item.linkedJourneyId ? { ...item, status: "cancelled" } : item);
      persist();
      refreshDepartures();
      document.querySelector<HTMLElement>(".timetable-dialog .modal-close")?.focus();
    });
  }));
}

function showTimetable(): void {
  const modal = modalRoot();
  if (!modal) return;
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card timetable-dialog" role="dialog" aria-modal="true" aria-label="Timetable">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
    <p class="eyebrow">TIMETABLE</p><h2>Departures</h2>
    <div class="timetable-heading"><p>Times are local to this device. Journeys start when you board.</p><button class="text-button" data-action="new-departure">Schedule journey +</button></div>
    <div id="timetable-rows"></div></section></div>`;
  bindModalClose(modal);
  modal.querySelector("[data-action='new-departure']")?.addEventListener("click", () => showDepartureForm());
  refreshDepartures();
}

function showDepartureForm(id?: string): void {
  const modal = modalRoot();
  if (!modal) return;
  const existing = state.departures.find(item => item.id === id);
  if (id && (!existing || existing.status !== "scheduled" || existing.linkedJourneyId)) return;
  const chosenLine = existing?.lineId ?? stationById(state.selectedStationId)?.lineId ?? state.lines[0]?.id;
  const chosenStation = existing?.stationId ?? state.selectedStationId;
  const fields = localDepartureFields(existing?.scheduledAt ?? Math.ceil((Date.now() + 30 * 60_000) / 60_000) * 60_000);
  const duration = existing?.durationMinutes ?? state.preferredDuration;
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card schedule-dialog" role="dialog" aria-modal="true" aria-label="${existing ? "Edit departure" : "Schedule journey"}">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">TIMETABLE</p><h2>${existing ? "Edit departure" : "Schedule journey"}</h2>
    <form id="departure-form" class="setup-form compact-form">
      <label><span>Subject line</span><select name="lineId" required>${state.lines.filter(line => line.stationIds.length).map(line => `<option value="${line.id}" ${line.id === chosenLine ? "selected" : ""}>${escapeHtml(line.name)}</option>`).join("")}</select></label>
      <label><span>Station / topic</span><select name="stationId" required></select></label>
      <div class="schedule-fields"><label><span>Date</span><input name="date" type="date" required min="1000-01-01" max="9999-12-31" value="${fields.date}" /></label><label><span>Start time</span><input name="time" type="time" required value="${fields.time}" /></label></div>
      <div class="schedule-fields"><label><span>Focus duration</span><select name="duration">${[25, 50, 90].map(minutes => `<option value="${minutes}" ${duration === minutes ? "selected" : ""}>${minutes} min</option>`).join("")}<option value="custom" ${![25, 50, 90].includes(duration) ? "selected" : ""}>Custom</option></select></label><label id="schedule-custom-label"><span>Custom minutes</span><input name="customDuration" type="number" inputmode="numeric" min="5" max="240" step="1" value="${![25, 50, 90].includes(duration) ? duration : ""}" /></label></div>
      <label><span>Note <small>optional · 280 characters</small></span><textarea name="note" rows="2" maxlength="280">${escapeHtml(existing?.note ?? "")}</textarea></label>
      <p class="exam-note">Local time on this device. Completed stations use maintenance service when you start.</p>
      <button class="secondary-button" type="submit">${existing ? "Save changes" : "Save departure"}</button><button class="text-button" type="button" data-action="back-timetable">Back to timetable</button>
    </form></section></div>`;
  const close = bindModalClose(modal);
  const form = modal.querySelector<HTMLFormElement>("#departure-form")!;
  const lineSelect = form.elements.namedItem("lineId") as HTMLSelectElement;
  const stationSelect = form.elements.namedItem("stationId") as HTMLSelectElement;
  const updateStations = (): void => {
    stationSelect.innerHTML = (lineById(lineSelect.value)?.stationIds ?? []).map(stationById).filter((station): station is Station => !!station).map(station => `<option value="${station.id}" ${station.id === chosenStation ? "selected" : ""}>${escapeHtml(station.name)}</option>`).join("");
  };
  lineSelect.addEventListener("change", updateStations); updateStations();
  const durationSelect = form.elements.namedItem("duration") as HTMLSelectElement;
  const custom = form.elements.namedItem("customDuration") as HTMLInputElement;
  const updateDuration = (): void => {
    custom.disabled = durationSelect.value !== "custom";
    custom.required = !custom.disabled;
    form.querySelector<HTMLElement>("#schedule-custom-label")!.hidden = custom.disabled;
  };
  durationSelect.addEventListener("change", updateDuration); updateDuration();
  form.querySelector("[data-action='back-timetable']")?.addEventListener("click", showTimetable);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(form);
    const details = { lineId: lineSelect.value, stationId: stationSelect.value, scheduledAt: parseDepartureTime(String(data.get("date")), String(data.get("time"))) ?? NaN, durationMinutes: durationSelect.value === "custom" ? Number(custom.value) : Number(durationSelect.value), note: String(data.get("note") ?? "").trim() };
    const now = Date.now();
    if (formError(form, departureError(details, state.stations, now))) return;
    const current = existing ? state.departures.find(item => item.id === existing.id) : null;
    if (existing && (!current || current.status !== "scheduled" || current.linkedJourneyId)) { formError(form, "This departure is no longer available to edit."); return; }
    const departure: ScheduledDeparture = current ? rescheduleDeparture(current, details, state.stations, now) : { ...details, id: uid("departure"), createdAt: now, status: "scheduled", linkedJourneyId: null };
    const next = { ...state, departures: current ? state.departures.map(item => item.id === current.id ? departure : item) : [...state.departures, departure] };
    try { writeState(next); state = next; } catch { showStorageError(); return; }
    close(); showTimetable();
  });
}

// Readouts use wall-clock deadlines; the focus timer remains the sole journey engine.
function refreshDepartures(): void {
  if (departureTimeout !== null) window.clearTimeout(departureTimeout);
  if (document.body.classList.contains("focus-mode")) return;
  const next = nextDeparture(state.departures);
  const strip = document.querySelector<HTMLElement>("#next-departure");
  if (strip) {
    const markup = next ? `<div class="next-departure-copy"><span class="board-label">NEXT DEPARTURE · ${departureStatus(next)}</span><strong>${departureTime(next.scheduledAt)} · ${escapeHtml(lineName(next.lineId))}</strong><small>${departureGroup(next.scheduledAt) === "TODAY" ? "Today" : departureDate(next.scheduledAt)} · ${escapeHtml(stationById(next.stationId)?.name ?? "Station")} · ${next.durationMinutes} min</small></div><button class="text-button" data-departure-start="${next.id}">Start journey <span aria-hidden="true">→</span></button>` : `<span class="next-departure-empty">No upcoming departures${state.departures.some(item => departureStatus(item) === "Missed") ? " · Missed journeys in Timetable" : ""}</span>`;
    if (strip.dataset.markup !== markup) {
      const hadFocus = strip.contains(document.activeElement);
      strip.innerHTML = markup; strip.dataset.markup = markup; bindDepartureRows(strip);
      if (hadFocus) (strip.querySelector<HTMLElement>("button") ?? document.querySelector<HTMLElement>("[data-action='timetable']"))?.focus({ preventScroll: true });
    }
  }
  const rows = document.querySelector<HTMLElement>("#timetable-rows");
  if (rows) {
    const markup = timetableContents();
    if (rows.dataset.markup !== markup) {
      const focused = rows.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      const attributes = ["data-departure-start", "data-departure-edit", "data-departure-cancel"];
      const focusAttribute = attributes.find(attribute => focused?.hasAttribute(attribute));
      const focusId = focusAttribute ? focused?.getAttribute(focusAttribute) : null;
      const expanded = rows.querySelector<HTMLDetailsElement>("details")?.open;
      const scroll = rows.closest<HTMLElement>(".modal-card")!;
      const top = scroll.scrollTop;
      rows.innerHTML = markup; rows.dataset.markup = markup; bindDepartureRows(rows);
      const details = rows.querySelector<HTMLDetailsElement>("details");
      if (details && expanded) details.open = true;
      if (focusAttribute && focusId) rows.querySelector<HTMLElement>(`[${focusAttribute}="${focusId}"]`)?.focus({ preventScroll: true });
      else if (focused?.tagName === "SUMMARY") rows.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
      scroll.scrollTop = top;
    }
  }
  const now = Date.now();
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const boundaries = state.departures.filter(item => item.status === "scheduled" && !item.linkedJourneyId).flatMap(item => [item.scheduledAt - 900_000, item.scheduledAt, item.scheduledAt + 1_800_001]);
  const nextUpdate = Math.min(+midnight, ...boundaries.filter(time => time > now));
  departureTimeout = window.setTimeout(refreshDepartures, Math.max(1, Math.min(nextUpdate - now, 60_000)));
}

function showWeeklyRecap(anchor = Date.now(), focusAction?: string): void {
  const modal = modalRoot();
  if (!modal) return;
  const recap = createWeeklyRecap(state, anchor);
  const svg = renderRecapSvg(recap);
  const row = (title: string, value: string, detail = ""): string => `<div><dt>${title}</dt><dd>${escapeHtml(value)}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</dd></div>`;
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card recap-dialog" role="dialog" aria-modal="true" aria-label="Weekly recap">
    <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
    <p class="eyebrow">WEEKLY OPERATIONS REPORT</p><h2>Your week on Study Metro</h2>
    <div class="recap-week"><button class="text-button" data-recap-previous aria-label="Previous week">←</button><div><strong>${escapeHtml(recapWeekLabel(recap.start, recap.end))}</strong><span>${recap.currentWeek ? "This week · In progress" : "Monday – Sunday · Local time"}</span></div><button class="text-button" data-recap-next aria-label="Next week" ${recap.currentWeek ? "disabled" : ""}>→</button></div>
    ${recap.journeys === 0 ? `<div class="recap-empty"><h3>NO SERVICES RECORDED THIS WEEK</h3><p>Start a journey to begin your weekly report.</p></div>` : ""}
    <div class="recap-totals"><div><strong>${recapDuration(recap.focusedSeconds)}</strong><span>focused</span></div><div><strong>${recap.journeys}</strong><span>journeys</span></div><div><strong>${recap.stationsCompleted}</strong><span>stations completed</span></div></div>
    <dl class="recap-facts">
      ${row("Stations studied", String(recap.stationsStudied), "Distinct stations visited, including revisions")}
      ${row("Revision", `${recap.revisionSessions} maintenance ${recap.revisionSessions === 1 ? "service" : "services"} completed`)}
      ${recap.busiestLine ? `<div class="recap-busiest" style="--route-color:${displayLineColor(recap.busiestLine.color)}"><dt>Busiest line</dt><dd>${escapeHtml(recap.busiestLine.name)}<small>${recapDuration(recap.busiestLine.seconds)}</small></dd></div>` : row("Busiest line", "No services recorded")}
      ${row("Longest journey", recap.longestJourney?.station ?? "No services recorded", recap.longestJourney ? recapDuration(recap.longestJourney.seconds) : "")}
      ${row("Most productive day", recap.mostProductiveDay?.name ?? "No services recorded", recap.mostProductiveDay ? recapDuration(recap.mostProductiveDay.seconds) : "")}
      ${row("Scheduled services", `${recap.scheduled.completed} completed · ${recap.scheduled.missed} missed`, `${recap.scheduled.completionRate === null ? "No completed or missed departures" : `${recap.scheduled.completionRate}% completion rate (completed + missed only)`} · ${recap.scheduled.pending} pending · ${recap.scheduled.cancelled} cancelled`)}
    </dl>
    <p class="recap-note">Journeys count on their completion day. New station completions use the recorded first-completion date. Scheduled services belong to their scheduled week.</p>
    <h3 class="recap-section-label">NETWORK NOW</h3><dl class="recap-facts">
      ${row("Maintenance due", `${recap.maintenanceDue} ${recap.maintenanceDue === 1 ? "station" : "stations"}`)}
      ${row("Next terminal", recap.nearestExam?.name ?? "No upcoming exams", recap.nearestExam ? recap.nearestExam.daysRemaining === 0 ? "Exam today" : `${recap.nearestExam.daysRemaining} days remaining` : "")}
    </dl><p class="recap-note">As of ${escapeHtml(new Date(recap.asOf).toLocaleString())}. Current maintenance and exams apply regardless of the report week.</p>
    <details class="recap-image"><summary>Share image preview</summary><div class="ticket-preview">${svg}</div></details>
    <div class="recap-actions"><button class="secondary-button" data-recap-download disabled>Download recap image</button><button class="secondary-button" data-recap-share hidden>Share recap</button><button class="text-button" data-recap-retry hidden>Retry image export</button></div>
    <p class="recap-message" role="status" aria-live="polite">Preparing recap image…</p>
  </section></div>`;
  bindModalClose(modal);
  // Week navigation replaces the modal contents, so retain an explicit network return target.
  const restoreNetworkFocus = (): void => { if (!modal.querySelector(".recap-dialog")) document.querySelector<HTMLElement>("[data-action='weekly-recap']")?.focus({ preventScroll: true }); };
  modal.querySelectorAll("[data-action='close-modal']").forEach(button => button.addEventListener("click", restoreNetworkFocus));
  const onModalKeydown = modal.onkeydown;
  modal.onkeydown = event => { onModalKeydown?.call(modal, event); if (event.key === "Escape") restoreNetworkFocus(); };
  const moveWeek = (offset: number): void => {
    const date = new Date(recap.start); date.setDate(date.getDate() + offset * 7);
    showWeeklyRecap(Math.min(+date, weekBounds().start), offset < 0 ? "[data-recap-previous]" : "[data-recap-next]");
  };
  modal.querySelector("[data-recap-previous]")?.addEventListener("click", () => moveWeek(-1));
  modal.querySelector("[data-recap-next]")?.addEventListener("click", () => moveWeek(1));
  if (focusAction) {
    const target = modal.querySelector<HTMLButtonElement>(focusAction);
    (target?.disabled ? modal.querySelector<HTMLElement>("[data-recap-previous]") : target)?.focus();
  }
  const dialog = modal.querySelector<HTMLElement>(".recap-dialog")!;
  const download = modal.querySelector<HTMLButtonElement>("[data-recap-download]")!;
  const share = modal.querySelector<HTMLButtonElement>("[data-recap-share]")!;
  const retry = modal.querySelector<HTMLButtonElement>("[data-recap-retry]")!;
  const message = modal.querySelector<HTMLElement>(".recap-message")!;
  let file: File | null = null;
  const prepare = async (): Promise<void> => {
    retry.hidden = true; download.disabled = true; share.hidden = true;
    message.textContent = "Preparing recap image…";
    try {
      const blob = await ticketPng(svg);
      if (!dialog.isConnected) return;
      file = new File([blob], `study-metro-week-${recapDateKey(recap.start)}.png`, { type: "image/png" });
      download.disabled = false; share.hidden = !canShareTicket(file);
      message.textContent = "1080 × 1350 PNG · Study totals only; no private notes.";
    } catch {
      if (!dialog.isConnected) return;
      retry.hidden = false;
      message.textContent = "The recap image could not be prepared. Try again; your study data is unchanged.";
    }
  };
  download.addEventListener("click", () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a"); link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = "Recap PNG download requested.";
  });
  share.addEventListener("click", async () => {
    if (!file || !canShareTicket(file)) return;
    share.disabled = true;
    try { await navigator.share({ files: [file], title: "My week on Study Metro" }); message.textContent = "Recap shared."; }
    catch (error) { message.textContent = error instanceof Error && error.name === "AbortError" ? "Sharing cancelled. Your recap is still available." : "Sharing is unavailable right now. Download the recap instead."; }
    finally { share.disabled = false; }
  });
  retry.addEventListener("click", () => void prepare());
  void prepare();
}

function showTicket(journeyId: string): void {
  if (document.querySelector("#ticket-modal-root")) return;
  const ticket = createJourneyTicket(state, journeyId);
  if (!ticket) return;
  const svg = renderTicketSvg(ticket);
  const modal = document.createElement("div");
  modal.id = "ticket-modal-root";
  modal.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card ticket-dialog" role="dialog" aria-modal="true" aria-label="Journey ticket">
    <button class="modal-close" data-action="close-modal" aria-label="Close ticket">×</button>
    <p class="eyebrow">JOURNEY TICKET</p><h2>Your arrival, recorded.</h2>
    <div class="ticket-preview">${svg}</div>
    <div class="ticket-actions"><button class="secondary-button" data-ticket-download disabled>Download PNG</button><button class="secondary-button" data-ticket-share hidden>Share PNG</button><button class="text-button" data-ticket-retry hidden>Retry PNG export</button></div>
    <p class="ticket-message" role="status" aria-live="polite">Preparing PNG…</p>
  </section></div>`;
  document.body.append(modal);
  bindModalClose(modal);
  const download = modal.querySelector<HTMLButtonElement>("[data-ticket-download]")!;
  const share = modal.querySelector<HTMLButtonElement>("[data-ticket-share]")!;
  const retry = modal.querySelector<HTMLButtonElement>("[data-ticket-retry]")!;
  const message = modal.querySelector<HTMLElement>(".ticket-message")!;
  let file: File | null = null;
  const prepare = async (): Promise<void> => {
    retry.hidden = true; download.disabled = true; share.hidden = true;
    message.textContent = "Preparing PNG…";
    try {
      const blob = await ticketPng(svg);
      if (!modal.isConnected) return;
      file = new File([blob], ticketFilename(ticket), { type: "image/png" });
      download.disabled = false;
      share.hidden = !canShareTicket(file);
      message.textContent = "1080 × 1350 PNG · Only study journey details are included.";
    } catch {
      if (!modal.isConnected) return;
      message.textContent = "The PNG could not be prepared. Try again; your journey is safely saved.";
      retry.hidden = false;
    }
  };
  download.addEventListener("click", () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url; link.download = file.name;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    message.textContent = "PNG download requested.";
  });
  share.addEventListener("click", async () => {
    if (!file || !canShareTicket(file)) return;
    share.disabled = true;
    try {
      // The PNG is prepared before this click to preserve native share user activation.
      await navigator.share({ files: [file], title: "Study Metro journey ticket" });
      message.textContent = "Ticket shared.";
    } catch (error) {
      message.textContent = error instanceof Error && error.name === "AbortError" ? "Sharing cancelled. Your ticket is still available." : "Sharing is unavailable right now. Download the PNG instead.";
    } finally { share.disabled = false; }
  });
  retry.addEventListener("click", () => void prepare());
  void prepare();
}

type FriendsTab="friends"|"requests"|"find"|"ranking";
async function showFriends():Promise<void>{
  const modal=modalRoot();if(!modal)return;
  if(!accountAuth.state.session?.user.id||!friendStore){modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card friends-dialog" role="dialog" aria-modal="true" aria-label="Friends"><button class="modal-close" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">CONNECTED SERVICES</p><h2>Friends</h2><div class="friends-empty"><h3>ACCOUNT REQUIRED</h3><p>Log in to find other Study Metro riders.</p></div><button class="secondary-button" data-friends-account>Open account</button></section></div>`;const close=bindModalClose(modal);modal.querySelector("[data-friends-account]")?.addEventListener("click",()=>{close();showAccount(accountAuth,bindModalClose,cloudSync,openOwnProfile);});return;}
  if(!profiles?.profile){showProfileSetup();return;}
  let tab:FriendsTab="friends",relations:FriendRelation[]=[],stats:UserStats[]=[],results:ProfileSearchResult[]=[],loading=true,busy=false,error="",query="";
  modal.innerHTML=`<div class="modal-backdrop" data-action="close-modal"><section class="modal-card friends-dialog" role="dialog" aria-modal="true" aria-labelledby="friends-title"><button class="modal-close" data-action="close-modal" aria-label="Close friends">×</button><p class="eyebrow">CONNECTED SERVICES</p><div class="friends-title-row"><h2 id="friends-title">Friends</h2><label class="presence-privacy"><input type="checkbox" data-presence-privacy ${sharesPresenceActivity()?"checked":""}><span>Show activity to friends</span></label></div><nav class="friends-tabs" aria-label="Friends sections"><button data-friends-tab="friends">Friends</button><button data-friends-tab="requests">Requests</button><button data-friends-tab="find">Find people</button><button data-friends-tab="ranking">Weekly ranking</button></nav><p class="friends-message" role="status" aria-live="polite"></p><div class="friends-content"></div></section></div>`;
  bindModalClose(modal);
  const content=modal.querySelector<HTMLElement>(".friends-content")!,message=modal.querySelector<HTMLElement>(".friends-message")!;
  const minutes=(value:number)=>value>=60?`${Math.floor(value/60)}h ${String(value%60).padStart(2,"0")}m`:`${value} min`;
  const rowStats=(id:string)=>{const r=stats.find(x=>x.user_id===id),current=r?.week_start===localWeekStart();return{focus:current?r!.focus_minutes_this_week:0,journeys:current?r!.journeys_this_week:0};};
  const empty=(title:string,copy:string)=>`<div class="friends-empty"><h3>${title}</h3><p>${copy}</p></div>`;
  const actionLabel=(result:ProfileSearchResult)=>result.relationship_direction==="accepted"?"Friends":result.relationship_direction==="incoming"?"Request received":result.relationship_direction==="outgoing"?"Pending":"Add friend";
  const render=()=>{
    modal.querySelectorAll<HTMLButtonElement>("[data-friends-tab]").forEach(button=>{const selected=button.dataset.friendsTab===tab;button.classList.toggle("is-active",selected);button.setAttribute("aria-current",selected?"page":"false");button.disabled=busy;});
    message.textContent=loading?"Updating service board…":error||statsSync?.error||"";
    message.classList.toggle("is-error",!!(error||statsSync?.error));content.setAttribute("aria-busy",String(loading||busy));if(loading){content.innerHTML="";return;}
    const accepted=relations.filter(r=>r.relationship_status==="accepted"),incoming=relations.filter(r=>r.relationship_direction==="incoming"),outgoing=relations.filter(r=>r.relationship_direction==="outgoing");
    if(tab==="friends")content.innerHTML=accepted.length?`<ul class="friends-board">${accepted.map(friend=>{const s=rowStats(friend.peer_user_id);return`<li><span class="friend-route-mark" aria-hidden="true"></span><div><a href="/u/${encodeURIComponent(friend.username)}"><strong>${escapeHtml(friend.display_name||friend.username)}</strong><small>@${escapeHtml(friend.username)}</small></a><div class="friend-presence" data-presence-user="${friend.peer_user_id}">${presenceMarkup(presence?.get(friend.peer_user_id))}</div></div><div class="friend-metrics"><strong>${minutes(s.focus)}</strong><small>${s.journeys} ${s.journeys===1?"journey":"journeys"} this week</small></div><button class="text-button" data-friend-action="remove" data-peer="${friend.peer_user_id}">Remove</button></li>`;}).join("")}</ul>`:empty("NO FRIENDS YET","Find another Study Metro rider by username.");
    if(tab==="requests")content.innerHTML=!incoming.length&&!outgoing.length?empty("NO REQUESTS","No incoming services."):`${incoming.length?`<h3 class="friends-section">INCOMING</h3><ul class="friends-board">${incoming.map(r=>`<li><span class="friend-route-mark"></span><div><strong>${escapeHtml(r.display_name||r.username)}</strong><small>@${escapeHtml(r.username)}</small></div><div class="friend-row-actions"><button class="text-button" data-friend-action="accept" data-peer="${r.peer_user_id}">Accept</button><button class="text-button" data-friend-action="decline" data-peer="${r.peer_user_id}">Decline</button></div></li>`).join("")}</ul>`:""}${outgoing.length?`<h3 class="friends-section">OUTGOING</h3><ul class="friends-board">${outgoing.map(r=>`<li><span class="friend-route-mark"></span><div><strong>${escapeHtml(r.display_name||r.username)}</strong><small>@${escapeHtml(r.username)} · Pending</small></div><button class="text-button" data-friend-action="cancel" data-peer="${r.peer_user_id}">Cancel</button></li>`).join("")}</ul>`:""}`;
    if(tab==="find")content.innerHTML=`<form class="friend-search"><label><span>USERNAME</span><input name="username" value="${escapeHtml(query)}" minlength="3" maxlength="20" pattern="[a-z0-9_]{3,20}" autocapitalize="none" spellcheck="false" required placeholder="study_rider"></label><button class="secondary-button" ${busy?"disabled":""}>Search</button></form>${query&&!results.length?empty("NO RIDERS FOUND","Check the username and try again."):results.length?`<ul class="friends-board search-results">${results.map(r=>`<li><span class="friend-route-mark"></span><div><strong>${escapeHtml(r.display_name||r.username)}</strong><small>@${escapeHtml(r.username)}${r.is_public?" · Public profile":""}</small></div><button class="text-button" data-search-username="${escapeHtml(r.username)}" ${r.relationship_direction!=="none"?"disabled":""}>${actionLabel(r)}</button></li>`).join("")}</ul>`:""}`;
    if(tab==="ranking"){const ownId=accountAuth.state.session!.user.id,identities=[{userId:ownId,username:profiles.profile!.username,displayName:profiles.profile!.display_name,current:true},...accepted.map(r=>({userId:r.peer_user_id,username:r.username,displayName:r.display_name,current:false}))],rank=createLeaderboard(stats,identities,localWeekStart());content.innerHTML=rank.length?`<div class="ranking-heading"><span>RANK</span><span>RIDER</span><span>FOCUS THIS WEEK</span></div><ol class="ranking-board">${rank.map(r=>`<li class="${r.current?"is-current":""}"><strong>${String(r.rank).padStart(2,"0")}</strong><div><span>${escapeHtml(r.displayName||r.username)}</span><small>@${escapeHtml(r.username)}${r.current?" · You":""}</small></div><div><strong>${minutes(r.focusMinutes)}</strong><small>${r.journeys} ${r.journeys===1?"journey":"journeys"}</small></div></li>`).join("")}</ol><p class="friends-trust">Statistics are client-derived and are not independently verified.</p>`:empty("NO RANKING SERVICES","Add a friend to begin a weekly ranking.");}
    bindBody();
  };
  const reload=async()=>{loading=true;error="";render();try{[relations,stats]=await Promise.all([friendStore.relations(),friendStore.stats()]);await presence?.setFriends(relations.filter(r=>r.relationship_status==="accepted").map(r=>r.peer_user_id));}catch(e){error=friendError(e);}finally{loading=false;render();}};
  const mutate=async(action:string,peer:string)=>{if(busy)return;busy=true;error="";render();try{if(action==="accept")await friendStore.accept(peer);else if(action==="decline")await friendStore.decline(peer);else if(action==="cancel")await friendStore.cancel(peer);else if(action==="remove")await friendStore.remove(peer);await reload();}catch(e){error=friendError(e);}finally{busy=false;render();}};
  const bindBody=()=>{content.querySelector<HTMLFormElement>(".friend-search")?.addEventListener("submit",async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget as HTMLFormElement;query=String(new FormData(form).get("username")??"").trim().toLowerCase();const invalid=friendSearchError(query,profiles.profile!.username);if(invalid){error=invalid;render();return;}busy=true;error="";render();try{results=await friendStore.search(query);}catch(e){error=friendError(e);}finally{busy=false;render();}});content.querySelectorAll<HTMLButtonElement>("[data-friend-action]").forEach(b=>b.addEventListener("click",()=>void mutate(b.dataset.friendAction!,b.dataset.peer!)));content.querySelectorAll<HTMLButtonElement>("[data-search-username]").forEach(b=>b.addEventListener("click",async()=>{if(busy)return;busy=true;error="";render();try{await friendStore.send(b.dataset.searchUsername!);results=await friendStore.search(query);relations=await friendStore.relations();}catch(e){error=friendError(e);}finally{busy=false;render();}}));};
  modal.querySelector<HTMLInputElement>("[data-presence-privacy]")?.addEventListener("change",event=>setPresencePrivacy((event.currentTarget as HTMLInputElement).checked));
  modal.querySelectorAll<HTMLButtonElement>("[data-friends-tab]").forEach(button=>button.addEventListener("click",()=>{tab=button.dataset.friendsTab as FriendsTab;error="";render();}));
  await reload();
}

function presenceMarkup(value:FriendPresence|undefined):string{const p=value??{status:"OFFLINE",subjectLine:null,remainingMinutes:null,updatedAt:null};const detail=p.status==="FOCUSING"&&p.subjectLine?`<small>${escapeHtml(p.subjectLine)}${p.remainingMinutes!==null?` · ${p.remainingMinutes}m`:""}</small>`:"";return`<span class="presence-dot ${p.status==="OFFLINE"?"is-offline":""}" aria-hidden="true"></span><strong>${p.status}</strong>${detail}`;}
function refreshPresenceUi():void{document.querySelectorAll<HTMLElement>("[data-presence-user]").forEach(el=>{el.innerHTML=presenceMarkup(presence?.get(el.dataset.presenceUser!));});const count=presence?.focusingCount??0,summary=document.querySelector<HTMLElement>("#network-presence");if(summary){summary.hidden=count===0;summary.textContent=count?`${count} ${count===1?"friend is":"friends are"} studying now`:"";}}

function showHistory(): void {
  const modal = modalRoot();
  if (!modal) return;
  const rows = state.history.length
    ? state.history.slice(0, 30).map((journey) => {
        const station = stationById(journey.stationId);
        const date = new Date(journey.completedAt);
        return `<li><div><strong>${escapeHtml(station?.name ?? "Deleted station")}</strong><span>${escapeHtml(lineName(journey.lineId))}</span></div><div><strong>${journey.kind === "revision" ? "Revision" : "Study"} · ${Math.round(journey.focusedSeconds / 60)} min</strong><span>${date.toLocaleDateString()}</span><button class="text-button history-ticket" data-ticket-journey="${escapeHtml(journey.id)}" aria-label="View ticket for ${escapeHtml(station?.name ?? "completed station")}, ${date.toLocaleDateString()}">View ticket</button></div></li>`;
      }).join("")
    : `<li class="empty-log">No completed journeys yet. Your first arrival will appear here.</li>`;

  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card history-card" role="dialog" aria-modal="true" aria-label="Journey log">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <p class="eyebrow">JOURNEY LOG</p>
        <h2>Your recent travel</h2>
        <ul class="history-list">${rows}</ul>
      </section>
    </div>
  `;
  bindModalClose(modal);
  modal.querySelectorAll<HTMLButtonElement>("[data-ticket-journey]").forEach(button => button.addEventListener("click", () => showTicket(button.dataset.ticketJourney!)));
}

function showNetworkEditor(requestedLineId: string | null): void {
  const modal = modalRoot();
  if (!modal) return;
  const line = lineById(requestedLineId) ?? state.lines[0] ?? null;
  if (!line) return;
  const lineStations = line.stationIds.map((id) => stationById(id)).filter((station): station is Station => Boolean(station));
  const exam = state.exams.find((item) => item.lineId === line.id);

  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card editor-card" role="dialog" aria-modal="true" aria-label="Edit network">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <div class="editor-head">
          <div>
            <p class="eyebrow">NETWORK CONTROL</p>
            <h2>Edit your lines</h2>
          </div>
          <button class="secondary-button compact-button" data-action="add-line">+ New line</button>
        </div>

        <div class="editor-layout">
          <aside class="editor-lines" aria-label="Subject lines">
            ${state.lines.map((item, index) => `
              <div class="editor-line-item ${item.id === line.id ? "is-active" : ""}">
                <button class="line-select" data-action="select-line" data-line-id="${item.id}">
                  <i style="background:${displayLineColor(item.color)}"></i>
                  <span>${escapeHtml(item.name)}</span>
                  <small>${item.stationIds.length}</small>
                </button>
                <div class="line-order-actions">
                  <button data-action="move-line" data-line-id="${item.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move line up">↑</button>
                  <button data-action="move-line" data-line-id="${item.id}" data-direction="1" ${index === state.lines.length - 1 ? "disabled" : ""} aria-label="Move line down">↓</button>
                </div>
              </div>
            `).join("")}
          </aside>

          <div class="editor-detail">
            <form class="line-settings" id="line-settings">
              <input type="hidden" name="lineId" value="${line.id}" />
              <label><span>Line name</span><input name="lineName" maxlength="40" value="${escapeHtml(line.name)}" required /></label>
              <label class="color-field"><span>Colour</span><input type="color" name="lineColor" value="${line.color}" /></label>
              <div class="editor-inline-actions">
                <button class="secondary-button compact-button" type="submit">Save line</button>
                <button class="text-button danger" type="button" data-action="delete-line" data-line-id="${line.id}">Delete line</button>
              </div>
            </form>

            <details class="exam-editor" ${exam ? "open" : ""}>
              <summary>Exam terminal <span>${exam ? "Edit exam" : "Add exam"}</span></summary>
              <form id="exam-form" class="exam-form">
                <label class="exam-name-field"><span>Exam name</span><input name="examName" maxlength="64" required placeholder="e.g. Anatomy Final" value="${escapeHtml(exam?.name ?? "")}" /></label>
                <label><span>Exam date</span><input name="examDate" type="date" min="1000-01-01" max="9999-12-31" required value="${exam?.examDate ?? ""}" /></label>
                <label><span>Target completion <small>optional</small></span><input name="targetDate" type="date" min="1000-01-01" max="9999-12-31" value="${exam?.targetCompletionDate ?? ""}" /></label>
                <p class="exam-note">One terminal per line. Study stations and journeys stay separate.</p>
                <p class="exam-form-message" role="status" aria-live="polite"></p>
                <div class="exam-form-actions"><button class="secondary-button compact-button" type="submit">${exam ? "Save exam" : "Add exam"}</button>${exam ? `<button class="text-button danger" type="button" data-action="remove-exam">Remove exam</button>` : ""}</div>
                <div class="exam-remove-confirm" hidden><p>Remove this exam? Your subject, study stations and journey history will stay.</p><button class="secondary-button compact-button" type="button" data-action="confirm-remove-exam">Remove exam only</button><button class="text-button" type="button" data-action="keep-exam">Keep exam</button></div>
              </form>
            </details>

            <div class="station-editor-head">
              <div><strong>Stations</strong><span>Order controls map position.</span></div>
            </div>

            <ol class="station-editor-list">
              ${lineStations.map((station, index) => `
                <li>
                  <span class="drag-index">${String(index + 1).padStart(2, "0")}</span>
                  <input data-station-name="${station.id}" maxlength="64" value="${escapeHtml(station.name)}" aria-label="Station name" />
                  <input class="minute-input" data-station-minutes="${station.id}" type="number" min="5" max="240" value="${station.estimatedMinutes}" aria-label="Estimated minutes" />
                  <button data-action="move-station" data-station-id="${station.id}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(station.name)} up">↑</button>
                  <button data-action="move-station" data-station-id="${station.id}" data-direction="1" ${index === lineStations.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(station.name)} down">↓</button>
                  <button class="station-delete" data-action="delete-station" data-station-id="${station.id}" aria-label="Delete ${escapeHtml(station.name)}">×</button>
                </li>
              `).join("")}
            </ol>

            <form class="add-station-form" id="add-station-form">
              <input name="stationName" maxlength="64" placeholder="New station name" aria-label="New station name" required autocomplete="off" />
              <input name="minutes" class="minute-input" type="number" min="5" max="240" value="50" aria-label="Estimated minutes" />
              <button class="secondary-button compact-button" type="submit">Add station</button>
            </form>
          </div>
        </div>
      </section>
    </div>
  `;

  bindModalClose(modal);

  modal.querySelectorAll<HTMLElement>("[data-action='select-line']").forEach((element) => {
    element.addEventListener("click", () => showNetworkEditor(element.dataset.lineId ?? null));
  });

  modal.querySelector<HTMLElement>("[data-action='add-line']")?.addEventListener("click", showAddLineModal);

  const examForm = modal.querySelector<HTMLFormElement>("#exam-form");
  const commitExam = (exams: Exam[], selectedExamId: string | null, message: string): void => {
    const nextState = { ...state, exams, selectedExamId };
    try { writeState(nextState); }
    catch {
      const status = examForm?.querySelector<HTMLElement>(".exam-form-message");
      if (status) { status.textContent = "Could not save the exam. Browser storage may be full or unavailable. Your changes have not been applied; try again."; status.classList.add("is-error"); }
      return;
    }
    state = nextState;
    render();
    document.querySelector<SVGElement>(".exam-terminal.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    showNetworkEditor(line.id);
    const details = modalRoot()?.querySelector<HTMLDetailsElement>(".exam-editor");
    if (details) details.open = true;
    const status = modalRoot()?.querySelector<HTMLElement>(".exam-form-message");
    if (status) status.textContent = message;
    modalRoot()?.querySelector<HTMLButtonElement>("#exam-form button[type='submit']")?.focus({ preventScroll: true });
  };
  examForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(examForm);
    const name = String(data.get("examName") ?? "").trim().replace(/\s+/g, " ");
    const examDate = String(data.get("examDate") ?? "");
    const targetCompletionDate = String(data.get("targetDate") ?? "") || null;
    const error = validateExam(name, examDate, targetCompletionDate);
    const status = examForm.querySelector<HTMLElement>(".exam-form-message");
    if (error) { if (status) { status.textContent = error; status.classList.add("is-error"); } return; }
    const nextExam: Exam = { id: exam?.id ?? uid("exam"), lineId: line.id, name, examDate, targetCompletionDate };
    commitExam([...state.exams.filter((item) => item.lineId !== line.id), nextExam], nextExam.id, "Exam saved.");
  });
  const removal = examForm?.querySelector<HTMLElement>(".exam-remove-confirm");
  examForm?.querySelector<HTMLElement>("[data-action='remove-exam']")?.addEventListener("click", () => {
    if (removal) { removal.hidden = false; removal.querySelector<HTMLButtonElement>("button")?.focus(); }
  });
  examForm?.querySelector<HTMLElement>("[data-action='keep-exam']")?.addEventListener("click", () => {
    if (removal) removal.hidden = true;
    examForm.querySelector<HTMLButtonElement>("[data-action='remove-exam']")?.focus();
  });
  examForm?.querySelector<HTMLElement>("[data-action='confirm-remove-exam']")?.addEventListener("click", () => {
    if (exam) commitExam(state.exams.filter((item) => item.id !== exam.id), state.selectedExamId === exam.id ? null : state.selectedExamId, "Exam removed. Study stations are unchanged.");
  });

  modal.querySelector<HTMLFormElement>("#line-settings")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const lineId = String(data.get("lineId") ?? "");
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("lineName")), state.lines.filter((item) => item.id !== lineId).map((item) => item.name), 40))) return;
    state.lines = state.lines.map((item) => item.id === lineId ? {
      ...item,
      name: cleanName(data.get("lineName"), item.name),
      color: String(data.get("lineColor") ?? item.color)
    } : item);
    relayoutAndPersist();
    render();
    showNetworkEditor(lineId);
  });

  modal.querySelectorAll<HTMLInputElement>("[data-station-name]").forEach((input) => {
    input.addEventListener("change", () => {
      const stationId = input.dataset.stationName;
      if (!stationId) return;
      const name = input.value.trim().replace(/\s+/g, " ").slice(0, 64);
      const error = nameError(name, state.stations.filter((station) => station.lineId === line.id && station.id !== stationId).map((station) => station.name));
      if (error) { input.setCustomValidity(error); input.reportValidity(); return; }
      state.stations = state.stations.map((station) => station.id === stationId ? { ...station, name } : station);
      persist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLInputElement>("[data-station-minutes]").forEach((input) => {
    input.addEventListener("change", () => {
      const stationId = input.dataset.stationMinutes;
      if (!stationId) return;
      if (!validDuration(Number(input.value))) { input.setCustomValidity("Enter a whole number from 5 to 240."); input.reportValidity(); return; }
      const estimatedMinutes = Number(input.value);
      state.stations = state.stations.map((station) => station.id === stationId ? { ...station, estimatedMinutes } : station);
      persist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='move-station']").forEach((button) => {
    button.addEventListener("click", () => {
      const stationId = button.dataset.stationId;
      const direction = Number(button.dataset.direction ?? 0);
      if (!stationId || !direction) return;
      const current = line.stationIds.indexOf(stationId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= line.stationIds.length) return;
      const nextIds = [...line.stationIds];
      [nextIds[current], nextIds[target]] = [nextIds[target], nextIds[current]];
      state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: nextIds } : item);
      relayoutAndPersist();
      render();
      showNetworkEditor(line.id);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='move-line']").forEach((button) => {
    button.addEventListener("click", () => {
      const lineId = button.dataset.lineId;
      const direction = Number(button.dataset.direction ?? 0);
      if (!lineId || !direction) return;
      const current = state.lines.findIndex((item) => item.id === lineId);
      const target = current + direction;
      if (current < 0 || target < 0 || target >= state.lines.length) return;
      const nextLines = [...state.lines];
      [nextLines[current], nextLines[target]] = [nextLines[target], nextLines[current]];
      state.lines = nextLines;
      relayoutAndPersist();
      render();
      showNetworkEditor(lineId);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>("[data-action='delete-station']").forEach((button) => {
    button.addEventListener("click", () => {
      const stationId = button.dataset.stationId;
      if (!stationId) return;
      const station = stationById(stationId);
      if (!station) return;
      if (line.stationIds.length === 1) {
        formError(modal.querySelector(".editor-detail")!, "A line needs at least one station. Add another station before deleting this one.");
        return;
      }
      confirmAction(`Delete station “${station.name}”? Its local journey history and timetable departures will also be removed.`, () => {
      state.stations = state.stations.filter((item) => item.id !== stationId);
      state.departures = state.departures.filter(item => item.stationId !== stationId);
      state.history = state.history.filter((journey) => journey.stationId !== stationId);
      state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: item.stationIds.filter((id) => id !== stationId) } : item);
      if (state.selectedStationId === stationId) state.selectedStationId = line.stationIds.find((id) => id !== stationId) ?? state.lines.flatMap((item) => item.stationIds)[0] ?? null;
      relayoutAndPersist();
      render();
      showNetworkEditor(line.id);
      });
    });
  });

  modal.querySelector<HTMLButtonElement>("[data-action='delete-line']")?.addEventListener("click", () => {
    if (state.lines.length === 1) {
      formError(modal.querySelector(".editor-detail")!, "Keep at least one line. Add another line first, or use Start over for a new network.");
      return;
    }
    confirmAction(`Delete the ${line.name} line, its exam, timetable departures and local journey history?`, () => {
    const stationIds = new Set(line.stationIds);
    state.lines = state.lines.filter((item) => item.id !== line.id);
    state.exams = state.exams.filter((item) => item.lineId !== line.id);
    state.departures = state.departures.filter(item => item.lineId !== line.id);
    if (!state.exams.some((item) => item.id === state.selectedExamId)) state.selectedExamId = null;
    state.stations = state.stations.filter((station) => !stationIds.has(station.id));
    state.history = state.history.filter((journey) => !stationIds.has(journey.stationId));
    ensureSelection();
    relayoutAndPersist();
    render();
    showNetworkEditor(state.lines[0]?.id ?? null);
    });
  });

  modal.querySelector<HTMLFormElement>("#add-station-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const name = cleanName(data.get("stationName"), "New Station");
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("stationName")), lineStations.map((item) => item.name)))) return;
    const station: Station = {
      ...emptyRevisionInfo(),
      id: uid("station"),
      lineId: line.id,
      name,
      x: 0,
      y: 0,
      status: "not_started",
      estimatedMinutes: Math.max(5, Math.min(240, Number(data.get("minutes")) || 50))
    };
    state.stations.push(station);
    state.lines = state.lines.map((item) => item.id === line.id ? { ...item, stationIds: [...item.stationIds, station.id] } : item);
    state.selectedStationId = station.id;
    state.selectedExamId = null;
    relayoutAndPersist();
    render();
    showNetworkEditor(line.id);
  });
}

function showAddLineModal(): void {
  const modal = modalRoot();
  if (!modal) return;
  const defaultColor = LINE_COLORS[state.lines.length % LINE_COLORS.length];
  modal.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card add-line-card" role="dialog" aria-modal="true" aria-label="Add subject line">
        <button class="modal-close" data-action="close-modal" aria-label="Close">×</button>
        <p class="eyebrow">NETWORK EXPANSION</p>
        <h2>Add a subject line</h2>
        <form class="setup-form compact-form" id="add-line-form">
          <label><span>Subject</span><input name="lineName" maxlength="40" placeholder="e.g. Biochemistry" required /></label>
          <label><span>Topics · one per line</span><textarea name="topics" rows="8" placeholder="Enzymes&#10;Fed / fast cycle&#10;Hormones&#10;Kidney biochemistry" required></textarea></label>
          <label class="color-field"><span>Line colour</span><input type="color" name="lineColor" value="${defaultColor}" /></label>
          <button class="primary-button" type="submit"><span>Add line</span><span>→</span></button>
        </form>
      </section>
    </div>
  `;
  bindModalClose(modal);

  modal.querySelector<HTMLFormElement>("#add-line-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const topics = parseTopics(data.get("topics"));
    if (formError(event.currentTarget as HTMLFormElement, nameError(String(data.get("lineName")), state.lines.map((line) => line.name), 40) ?? topicsError(topics))) return;
    const { line, stations } = createLine(cleanName(data.get("lineName"), "New Line"), String(data.get("lineColor") ?? defaultColor), topics);
    state.lines.push(line);
    state.stations.push(...stations);
    state.selectedStationId = stations[0]?.id ?? state.selectedStationId;
    state.selectedExamId = null;
    relayoutAndPersist();
    render();
    showNetworkEditor(line.id);
  });
}

function recoverActiveJourney(): boolean {
  const saved = state.activeJourney;
  if (!saved) return false;
  const station = stationById(saved.stationId);
  if (!station) {
    state.activeJourney = null;
    persist();
    return false;
  }

  activeStation = station;
  timer.restore(saved.timer);
  timer.tick();
  document.body.classList.add("focus-mode");

  if (timer.state.phase === "complete") {
    finishJourney();
    return true;
  }

  if (timer.state.phase === "cancelled" || timer.state.phase === "idle") {
    state.activeJourney = null;
    persist();
    return false;
  }

  renderFocus();
  startTimerLoop();
  return true;
}

function bootstrap(): void {
  if (recoverActiveJourney()) return;
  render();
}

function maintenanceDate(value: number | null): string {
  return value === null ? "Not recorded" : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(value);
}

// Update only maintenance readouts; don't replace an open editor or disturb map focus.
function refreshMaintenance(): void {
  const now = Date.now();
  const count = state.stations.filter((station) => isMaintenanceDue(station, now)).length;
  const summary = document.querySelector<HTMLElement>("#network-maintenance");
  if (summary) { summary.hidden = count === 0; summary.textContent = count ? `${count} ${count === 1 ? "station needs" : "stations need"} maintenance` : ""; }
  document.querySelectorAll<SVGElement>("#map-root [data-station-id]").forEach((element) => {
    const station = stationById(element.dataset.stationId ?? null);
    if (!station) return;
    const due = isMaintenanceDue(station, now);
    element.classList.toggle("is-maintenance-due", due);
    element.setAttribute("aria-label", `${station.name}, ${lineName(station.lineId)}, ${due ? "Maintenance due" : station.status.replaceAll("_", " ")}${element.dataset.terminal === "true" ? ", terminal" : ""}`);
  });
  const selected = stationById(state.selectedStationId);
  if (selected) {
    const due = isMaintenanceDue(selected, now);
    const label = document.querySelector("#station-service-label");
    const description = document.querySelector("#station-service-description");
    if (label) label.textContent = due ? "MAINTENANCE DUE" : "Normal service";
    if (description) description.textContent = due ? "A revision journey is recommended" : "Ready for departure";
    document.querySelector("#station-service-indicator")?.classList.toggle("maintenance-indicator", due);
  }
  if (maintenanceTimeout !== null) window.clearTimeout(maintenanceTimeout);
  const next = Math.min(...state.stations.filter(isCompletedStation).map((station) => station.nextReviewAt).filter((date): date is number => date !== null && date > now));
  maintenanceTimeout = window.setTimeout(refreshMaintenance, Math.max(1, Math.min(next - now, 86_400_000)));
}

// Calendar readouts refresh independently of the focus timer, without rerendering forms.
function refreshExamDates(): void {
  document.querySelectorAll<HTMLElement | SVGElement>("[data-exam-id]").forEach((element) => {
    const exam = state.exams.find((item) => item.id === element.dataset.examId);
    if (!exam) return;
    const stats = examProgress(state, exam);
    const countdown = element.querySelector(".exam-countdown");
    if (countdown) {
      countdown.textContent = examCountdown(stats.daysRemaining);
      element.setAttribute("aria-label", `${exam.name}, ${lineName(exam.lineId)}, exam terminal, ${examCountdown(stats.daysRemaining)}, ${stats.status}`);
    }
    const days = element.querySelector("[data-exam-days-message]");
    if (days) days.textContent = examDaysMessage(stats.daysRemaining);
    const status = element.querySelector("[data-exam-status]");
    if (status) status.textContent = stats.status;
  });
}

function scheduleExamDateRefresh(): void {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  window.setTimeout(() => { refreshExamDates(); scheduleExamDateRefresh(); }, nextDay - Date.now() + 100);
}

document.addEventListener("input", (event) => { if (event.target instanceof HTMLInputElement) event.target.setCustomValidity(""); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshExamDates();
    refreshMaintenance();
    refreshDepartures();
    if (state.activeJourney) { timer.tick(); renderFocusTick(); if (timer.state.phase === "complete") finishJourney(); }
    updateOwnPresence();
    void presence?.refreshAuth().catch(()=>{});
  }
});
window.addEventListener("storage",event=>{const id=accountAuth.state.session?.user.id;if(id&&event.key===presencePrivacyKey(id))updateOwnPresence();});
window.addEventListener("pagehide",()=>{void presence?.leave();});
window.addEventListener("pageshow",()=>{const id=accountAuth.state.session?.user.id;if(id)void presence?.enter(id).then(()=>{updateOwnPresence();void refreshPresenceFriends();}).catch(()=>{});});
window.addEventListener("focus", refreshExamDates);
window.addEventListener("focus", refreshMaintenance);
window.addEventListener("focus", refreshDepartures);
// One writable tab per origin prevents stale tabs overwriting a live journey or network.
async function openApp(): Promise<void> {
  if (isPublicRoute) { if (publicRoute) await renderPublicProfile(publicRoute); else renderPublicProfileError("This profile address is invalid."); return; }
  const blocked = (): void => {
    app.innerHTML = `<main class="onboarding-shell"><section class="modal-card"><h1>Open in another tab</h1><p class="modal-copy">Keep one Study Metro tab open to protect your network and active journey. Close the other tab, then reload here.</p><button class="secondary-button" id="reload-app">Reload</button></section></main>`;
    document.querySelector("#reload-app")?.addEventListener("click", () => location.reload());
  };
  if (!navigator.locks) {
    app.innerHTML = `<main class="modal-card"><h1>Secure browser required</h1><p>Open Study Metro over HTTPS in a current browser to safely save your network.</p></main>`;
    return;
  }
  await navigator.locks.request("study-metro-writer", { ifAvailable: true }, async (lock) => {
    if (!lock) { blocked(); return; }
    app.innerHTML = `<main class="onboarding-shell"><p class="eyebrow" role="status">Loading local network…</p></main>`;
    await authReady;
    state = loadState(); lastSaved = structuredClone(state);
    appReady = true;
    const requested=appRoute(location.pathname);
    if(!accountAuth.state.session&&requested==="/"){
      renderLanding();
    }else if(!accountAuth.state.session&&(requested==="/login"||requested==="/signup")){
      renderAuthRoute(requested==="/signup");
    }else if (accountAuth.state.session?.user.id && cloudSync) {
      if(requested==="/"||requested==="/login"||requested==="/signup")history.replaceState({},"","/network");
      reconcileAccount();
    } else if (isStorageReadOnly()) {
      app.innerHTML = `<main class="modal-card"><h1>Newer version required</h1><p>${escapeHtml(storageNotice)}</p></main>`;
    } else {
      if(requested==="/network")playNetworkEntrance();
      try { bootstrap(); } catch (error) { if (!(error instanceof SaveFailure)) throw error; }
    }
    if (storageNotice) {
      const notice = document.createElement("p"); notice.className = "storage-error"; notice.setAttribute("role", "alert"); notice.textContent = storageNotice; document.body.append(notice);
    }
    await new Promise<void>(() => {});
  });
}
const authReady = accountAuth.initialize();
void openApp();
window.addEventListener("popstate",()=>{if(!appReady||isPublicRoute||document.body.classList.contains("focus-mode"))return;const route=appRoute(location.pathname);if(!accountAuth.state.session&&(route==="/"||route==="/login"||route==="/signup")){route==="/"?renderLanding():renderAuthRoute(route==="/signup");return;}navigateTo(route??"/network",true);});
window.addEventListener("online", () => { if (appReady) void cloudSync?.check(); void presence?.refreshAuth().then(updateOwnPresence).catch(()=>{}); });
window.addEventListener("offline", () => { if (appReady) void cloudSync?.check(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && appReady) void cloudSync?.flush(); });
function scheduleStatsCalendarCheck():void{const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);window.setTimeout(()=>{scheduleOwnStats();scheduleStatsCalendarCheck();},+next-Date.now()+100);}
scheduleStatsCalendarCheck();
scheduleExamDateRefresh();
