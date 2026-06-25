const state = {
  mode: "ai",
  topic: "",
  stance: "for",
  difficulty: "adult",
  rounds: 3,
  debateId: "",
  round: 1,
  history: [],
  timer: null,
  seconds: 180,
  busy: false,
  voiceEnabled: true,
  voiceAvailable: false,
  recorder: null,
  recordingStream: null,
  audioChunks: [],
  currentAudio: null,
  audioContext: null,
  authMode: "signin",
  user: null,
  matchId: "",
  matchPoll: null,
  queueStartedAt: 0,
  queueTimer: null,
  humanResultShown: false
};

const $ = (selector) => document.querySelector(selector);
const loginScreen = $("#loginScreen");
const setupScreen = $("#setupScreen");
const matchmakingScreen = $("#matchmakingScreen");
const profileScreen = $("#profileScreen");
const rankingScreen = $("#rankingScreen");
const arenaScreen = $("#arenaScreen");
const resultsScreen = $("#resultsScreen");
const setupForm = $("#setupForm");
const argumentForm = $("#argumentForm");
const argumentInput = $("#argument");
const transcript = $("#transcript");
const t = (key) => window.I18N?.t(key) || key;

checkHealth();
restoreSession();

$("#languageSelect").addEventListener("change", (event) => {
  window.I18N.applyLanguage(event.target.value);
});
window.addEventListener("dialectic:language", () => {
  setAuthMode(state.authMode);
  updateLocalizedArenaText();
  if (!profileScreen.classList.contains("hidden")) renderDebateHistory();
  if (!rankingScreen.classList.contains("hidden")) renderRanking();
});

$("#signInTab").addEventListener("click", () => setAuthMode("signin"));
$("#createTab").addEventListener("click", () => setAuthMode("create"));
$("#authForm").addEventListener("submit", handleAuth);
$("#profileButton").addEventListener("click", () => {
  $("#profileMenu").classList.toggle("hidden");
});
$("#viewProfileButton").addEventListener("click", openProfile);
$("#rankingButton").addEventListener("click", openRanking);
$("#rankingBackButton").addEventListener("click", () => showScreen(setupScreen));
$("#profileBackButton").addEventListener("click", () => showScreen(setupScreen));
$("#profileNewDebateButton").addEventListener("click", resetArena);
$("#logoutButton").addEventListener("click", logout);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".header-right")) $("#profileMenu").classList.add("hidden");
});

setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  ensureAudioContext();
  state.topic = $("#topic").value.trim();
  const setupData = new FormData(setupForm);
  state.mode = setupData.get("opponentMode") || "ai";
  state.stance = setupData.get("stance");
  state.difficulty = setupData.get("difficulty") || "adult";
  state.rounds = Number(setupData.get("rounds")) || 3;
  state.debateId = crypto.randomUUID();
  state.round = 1;
  state.history = [];

  if (state.mode === "human") {
    await startMatchmaking();
    return;
  }

  configureAiArena();
  $("#motionTitle").textContent = state.topic;
  $("#userStanceLabel").textContent = state.stance === "for" ? t("forSide") : t("againstSide");
  $("#aiStanceLabel").textContent = state.stance === "for" ? t("againstSide") : t("forSide");
  $("#roundNumber").textContent = "1";
  $("#roundTotal").textContent = state.rounds;
  showScreen(arenaScreen);
  await showCeremony("round", 1);
  startTimer();
  setTimeout(() => argumentInput.focus(), 100);
});

setupForm.addEventListener("change", (event) => {
  if (event.target.name === "opponentMode") {
    $("#difficultyFieldset").classList.toggle("hidden", event.target.value === "human");
  }
});

$("#cancelMatchmaking").addEventListener("click", cancelMatchmaking);

argumentForm.addEventListener("submit", submitArgument);

argumentInput.addEventListener("input", () => {
  $("#charCount").textContent = `${argumentInput.value.length} / 2000`;
});

argumentInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    argumentForm.requestSubmit();
  }
});

$("#leaveButton").addEventListener("click", resetArena);
$("#newDebateButton").addEventListener("click", resetArena);
$("#micButton").addEventListener("click", toggleRecording);
$("#voiceToggle").addEventListener("click", toggleVoice);

async function submitArgument(event) {
  event.preventDefault();
  if (state.busy) return;
  if (state.mode === "human") return submitHumanArgument();

  const argument = argumentInput.value.trim();
  if (argument.length < 10) return showToast(t("openingHint"));

  state.busy = true;
  setBusy(true);
  addSpeech("user", argument, `${t("round")} ${state.round}`);
  state.history.push({ speaker: "user", text: argument });
  argumentInput.value = "";
  $("#charCount").textContent = "0 / 2000";

  try {
    const response = await fetch("/api/debate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: state.topic,
        stance: state.stance,
        argument,
        history: state.history.slice(0, -1),
        language: window.I18N.locale,
        difficulty: state.difficulty,
        round: state.round,
        rounds: state.rounds
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The exchange failed.");

    addSpeech("ai", data.aiReply, t("adversary"));
    state.history.push({ speaker: "ai", text: data.aiReply });
    renderScore(data.evaluation);
    await speakAI(data.aiReply);

    if (state.round >= state.rounds) {
      await finishDebate();
    } else {
      state.round += 1;
      $("#roundNumber").textContent = state.round;
      await showCeremony("round", state.round);
      resetTimer();
      argumentInput.focus();
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

async function finishDebate() {
  clearInterval(state.timer);
  showToast(t("listening"));

  const response = await fetch("/api/final", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: state.topic,
      stance: state.stance,
      argument: "",
      history: state.history,
      language: window.I18N.locale,
      difficulty: state.difficulty,
      round: state.round,
      rounds: state.rounds,
      debateId: state.debateId
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The final ruling failed.");

  state.user = data.user;
  renderProfile();
  renderResults(data.evaluation, data.eloChange);
  showScreen(resultsScreen);
  await showCeremony("verdict");
}

function addSpeech(speaker, text, label) {
  $(".arena-prompt")?.remove();
  const article = document.createElement("article");
  article.className = `speech ${speaker}`;

  const head = document.createElement("div");
  head.className = "speech-head";
  head.textContent = speaker === "user" ? `${label} · ${t("challenger")}` : label;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  article.append(head, paragraph);
  transcript.appendChild(article);
  transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
}

function renderScore(score) {
  $("#overallScore").textContent = score.overall;
  for (const key of ["logic", "evidence", "clarity", "relevance"]) {
    const row = document.querySelector(`[data-key="${key}"]`);
    row.querySelector("strong").textContent = score[key];
    row.querySelector("b").style.width = `${score[key]}%`;
  }

  const verdict =
    score.verdict === "user_leads"
      ? t("leadsYou")
      : score.verdict === "ai_leads"
        ? t("leadsAI")
        : t("level");
  $("#judgeNotes").innerHTML = `
    <span>${escapeHtml(t("judgeNotes"))} · ${escapeHtml(verdict)}</span>
    <p>${escapeHtml(score.improvement)}</p>
  `;
}

function renderResults(score, eloChange) {
  const headline =
    score.verdict === "user_leads"
      ? t("carried")
      : score.verdict === "ai_leads"
        ? t("challenged")
        : t("measuredDraw");
  $("#resultHeadline").textContent = headline;
  $("#resultVerdict").textContent =
    `${score.strongest_point} ${t("nextStep")}: ${score.improvement}`;
  $("#finalScore").textContent = score.overall;
  $("#resultElo").textContent = state.user.elo;
  const changeLabel = $("#eloChange");
  changeLabel.textContent =
    eloChange > 0 ? `+${eloChange} ELO` : eloChange < 0 ? `${eloChange} ELO` : t("noChange");
  changeLabel.className =
    eloChange > 0 ? "positive" : eloChange < 0 ? "negative" : "";
  $("#finalBreakdown").innerHTML = ["logic", "evidence", "clarity", "relevance"]
    .map(
      (key) =>
        `<div><strong>${score[key]}</strong><span>${escapeHtml(t(key))}</span></div>`
    )
    .join("");
}

function setBusy(busy) {
  argumentInput.disabled = busy;
  $("#submitArgument").disabled = busy;
  $("#micButton").disabled = busy;
  $("#submitArgument").querySelector("[data-i18n]").textContent =
    busy ? `${t("listening")}…` : t("submitArgument");
}

function startTimer() {
  clearInterval(state.timer);
  state.seconds = 180;
  updateTimer();
  state.timer = setInterval(() => {
    state.seconds = Math.max(0, state.seconds - 1);
    updateTimer();
    if (state.seconds === 0) {
      clearInterval(state.timer);
      showToast("Time is up—but the floor is still yours.");
    }
  }, 1000);
}

function resetTimer() {
  startTimer();
}

function updateTimer() {
  const minutes = String(Math.floor(state.seconds / 60)).padStart(2, "0");
  const seconds = String(state.seconds % 60).padStart(2, "0");
  $("#timer").textContent = `${minutes}:${seconds}`;
}

function resetArena() {
  clearInterval(state.timer);
  clearInterval(state.matchPoll);
  clearInterval(state.queueTimer);
  stopAudio();
  stopRecording(true);
  state.busy = false;
  state.mode = "ai";
  state.topic = "";
  state.stance = "for";
  state.difficulty = "adult";
  state.rounds = 3;
  state.debateId = "";
  state.history = [];
  state.round = 1;
  state.matchId = "";
  state.humanResultShown = false;
  transcript.innerHTML = `
    <div class="arena-prompt">
      <span data-i18n="openingStatement">${escapeHtml(t("openingStatement"))}</span>
      <p data-i18n="openingHint">${escapeHtml(t("openingHint"))}</p>
    </div>
  `;
  argumentInput.value = "";
  $("#topic").value = "";
  $("#motionTitle").textContent = "";
  $("#charCount").textContent = "0 / 2000";
  $("#roundNumber").textContent = "1";
  $("#roundTotal").textContent = "3";
  setupForm.reset();
  $("#difficultyFieldset").classList.remove("hidden");
  configureAiArena();
  $("#finalScore").textContent = "0";
  $("#finalBreakdown").innerHTML = "";
  $("#resultVerdict").textContent = "";
  $("#resultElo").textContent = state.user?.elo || "1200";
  $("#eloChange").textContent = t("noChange");
  $("#eloChange").className = "";
  resetScores();
  showScreen(setupScreen);
}

function resetScores() {
  $("#overallScore").textContent = "—";
  document.querySelectorAll(".score-bars > div").forEach((row) => {
    row.querySelector("strong").textContent = "—";
    row.querySelector("b").style.width = "0";
  });
  $("#judgeNotes").innerHTML =
    `<span data-i18n="judgeNotes">${escapeHtml(t("judgeNotes"))}</span><p data-i18n="feedbackAfter">${escapeHtml(t("feedbackAfter"))}</p>`;
}

function showScreen(screen) {
  [loginScreen, setupScreen, matchmakingScreen, profileScreen, rankingScreen, arenaScreen, resultsScreen].forEach((item) =>
    item.classList.toggle("hidden", item !== screen)
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function configureAiArena() {
  $("#opponentName").textContent = t("adversary");
  $("#opponentAvatar").textContent = "AI";
  $("#voiceToolbar").classList.remove("hidden");
  $(".score-panel-head > span").textContent = t("liveJudge");
}

async function startMatchmaking() {
  state.queueStartedAt = Date.now();
  $("#queueElo").textContent = state.user?.elo || 1200;
  $("#queueTimer").textContent = "00:00";
  showScreen(matchmakingScreen);
  startQueueTimer();
  try {
    const response = await fetch("/api/matchmaking/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: state.topic,
        stance: state.stance,
        rounds: state.rounds,
        language: window.I18N.locale
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not join matchmaking.");
    if (data.status === "matched") return enterHumanMatch(data.match);
    clearInterval(state.matchPoll);
    state.matchPoll = setInterval(checkMatchmaking, 1800);
  } catch (error) {
    showToast(error.message);
    resetArena();
  }
}

function startQueueTimer() {
  clearInterval(state.queueTimer);
  state.queueTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.queueStartedAt) / 1000);
    $("#queueTimer").textContent =
      `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  }, 1000);
}

async function checkMatchmaking() {
  try {
    const response = await fetch("/api/matchmaking/status");
    const data = await response.json();
    if (response.ok && data.status === "matched") enterHumanMatch(data.match);
  } catch {
    // Transient polling failures should not remove the player from the queue.
  }
}

async function cancelMatchmaking() {
  clearInterval(state.matchPoll);
  clearInterval(state.queueTimer);
  await fetch("/api/matchmaking/leave", { method: "POST" }).catch(() => {});
  resetArena();
}

async function enterHumanMatch(match) {
  clearInterval(state.matchPoll);
  clearInterval(state.queueTimer);
  state.mode = "human";
  state.matchId = match.id;
  state.humanResultShown = false;
  $("#voiceToolbar").classList.add("hidden");
  $("#opponentAvatar").textContent = initialsFor(match.opponent.username);
  $(".score-panel-head > span").textContent = "AI judge";
  showScreen(arenaScreen);
  renderHumanMatch(match);
  await showCeremony("round", match.round);
  clearInterval(state.matchPoll);
  state.matchPoll = setInterval(pollHumanMatch, 1500);
}

async function pollHumanMatch() {
  if (!state.matchId) return;
  try {
    const response = await fetch(`/api/matches/${state.matchId}`);
    const data = await response.json();
    if (response.ok) renderHumanMatch(data.match);
  } catch {
    // Keep the room visible while the connection recovers.
  }
}

function renderHumanMatch(match) {
  state.topic = match.topic;
  state.stance = match.stance;
  state.rounds = match.rounds;
  state.round = match.round;
  $("#motionTitle").textContent = match.topic;
  $("#roundNumber").textContent = match.round;
  $("#roundTotal").textContent = match.rounds;
  $("#userStanceLabel").textContent = match.stance === "for" ? t("forSide") : t("againstSide");
  $("#aiStanceLabel").textContent = match.stance === "for" ? t("againstSide") : t("forSide");
  $("#opponentName").textContent = `${match.opponent.username} · ${match.opponent.elo} ELO`;
  transcript.innerHTML = "";
  if (!match.messages.length) {
    transcript.innerHTML = `
      <div class="arena-prompt">
        <span>${escapeHtml(match.yourTurn ? t("openingStatement") : "Opponent opens")}</span>
        <p>${escapeHtml(match.yourTurn ? t("openingHint") : "Waiting for the first argument…")}</p>
      </div>`;
  } else {
    for (const message of match.messages) {
      const own = message.userId === state.user.id;
      addSpeech(
        own ? "user" : "ai",
        message.text,
        own ? `${t("round")} ${message.round}` : match.opponent.username
      );
    }
  }

  const waiting = !match.yourTurn || match.status !== "active";
  argumentInput.disabled = waiting;
  $("#submitArgument").disabled = waiting;
  $("#micButton").disabled = waiting;
  argumentInput.placeholder =
    match.status === "judging"
      ? "The AI judge is reviewing both cases…"
      : match.yourTurn
        ? "Answer your opponent…"
        : `Waiting for ${match.opponent.username}…`;

  if (match.status === "complete" && !state.humanResultShown) {
    state.humanResultShown = true;
    clearInterval(state.matchPoll);
    finishHumanMatch(match);
  }
}

async function submitHumanArgument() {
  const argument = argumentInput.value.trim();
  if (argument.length < 10) return showToast(t("openingHint"));
  state.busy = true;
  setBusy(true);
  let latestMatch = null;
  try {
    const response = await fetch(`/api/matches/${state.matchId}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: argument })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The turn could not be submitted.");
    argumentInput.value = "";
    $("#charCount").textContent = "0 / 2000";
    latestMatch = data.match;
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    setBusy(false);
    if (latestMatch) renderHumanMatch(latestMatch);
  }
}

async function finishHumanMatch(match) {
  const me = await fetch("/api/auth/me").then((response) => response.json()).catch(() => null);
  if (me?.user) state.user = me.user;
  renderProfile();
  renderResults(match.evaluation, match.eloChange);
  $("#resultHeadline").textContent =
    match.result === "win"
      ? "You won the debate."
      : match.result === "loss"
        ? "Your opponent won."
        : "The debate is a draw.";
  $("#resultVerdict").textContent =
    `${match.evaluation.strongest_point} ${t("nextStep")}: ${match.evaluation.improvement} · ${match.score}–${match.opponentScore}`;
  showScreen(resultsScreen);
  await showCeremony("verdict");
}

function initialsFor(name) {
  return String(name)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const creating = mode === "create";
  $("#signInTab").classList.toggle("active", !creating);
  $("#createTab").classList.toggle("active", creating);
  $("#signInTab").setAttribute("aria-selected", String(!creating));
  $("#createTab").setAttribute("aria-selected", String(creating));
  $("#authKicker").textContent = creating ? t("newChallenger") : t("welcomeBack");
  $("#authTitle").textContent = creating ? t("claimPlace") : t("returnArena");
  $("#authSubmit").firstChild.textContent =
    creating ? `${t("createAccountButton")} ` : `${t("enterArenaButton")} `;
  $("#password").autocomplete = creating ? "new-password" : "current-password";
}

async function handleAuth(event) {
  event.preventDefault();
  const username = $("#username").value.trim();
  const password = $("#password").value;
  $("#authSubmit").disabled = true;

  try {
    const endpoint = state.authMode === "create" ? "/api/auth/register" : "/api/auth/login";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        remember: $("#rememberMe").checked
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Authentication failed.");
    signIn(data.user);
    $("#authForm").reset();
    $("#rememberMe").checked = true;
  } catch (error) {
    showToast(error.message);
  } finally {
    $("#authSubmit").disabled = false;
  }
}

async function restoreSession() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) throw new Error("No active session.");
    const data = await response.json();
    signIn(data.user);
  } catch {
    showScreen(loginScreen);
  }
}

function signIn(account) {
  state.user = account;
  renderProfile();
  $("#eloDisplay").classList.remove("hidden");
  $("#profileButton").classList.remove("hidden");
  $("#rankingButton").classList.remove("hidden");
  showScreen(setupScreen);
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  clearInterval(state.timer);
  stopAudio();
  $("#eloDisplay").classList.add("hidden");
  $("#profileButton").classList.add("hidden");
  $("#rankingButton").classList.add("hidden");
  $("#profileMenu").classList.add("hidden");
  setAuthMode("signin");
  showScreen(loginScreen);
}

async function openProfile() {
  if (!state.user) return;
  $("#profileMenu").classList.add("hidden");
  await renderDebateHistory();
  showScreen(profileScreen);
}

async function openRanking() {
  if (!state.user) return;
  $("#profileMenu").classList.add("hidden");
  await renderRanking();
  showScreen(rankingScreen);
}

async function renderRanking() {
  const response = await fetch("/api/ranking");
  if (!response.ok) return;
  const { ranking: accounts } = await response.json();

  $("#rankingCount").textContent = accounts.length;
  $("#rankingList").innerHTML = accounts
    .map((account, index) => {
      const initials = account.username
        .split(/[_\-\s]+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const joined = account.createdAt
        ? new Date(account.createdAt).toLocaleDateString(window.I18N.locale, {
            month: "short",
            year: "numeric"
          })
        : "—";
      const current = state.user?.username.toLowerCase() === account.username.toLowerCase();
      return `
        <article class="ranking-row ${current ? "current" : ""}">
          <strong class="ranking-position">#${index + 1}</strong>
          <div class="ranking-identity">
            <span class="ranking-mini-avatar">${escapeHtml(initials || account.username.slice(0, 2))}</span>
            <div>
              <strong>${escapeHtml(account.username)}</strong>
              <small>${escapeHtml(t("joined"))} ${escapeHtml(joined)}</small>
            </div>
          </div>
          <span class="ranking-matches">${account.matches} ${escapeHtml(t("debates"))}</span>
          <strong class="ranking-elo">${account.elo}</strong>
        </article>
      `;
    })
    .join("");
}

async function renderDebateHistory() {
  if (!state.user) return;
  const response = await fetch("/api/history");
  if (!response.ok) return;
  const { history } = await response.json();
  const wins = history.filter((debate) => debate.result === "win").length;
  $("#userPageName").textContent = state.user.username;
  $("#userPageElo").textContent = state.user.elo;
  $("#userPageMatches").textContent = state.user.matches;
  $("#userPageWins").textContent = wins;

  if (!history.length) {
    $("#debateHistory").innerHTML = `
      <div class="empty-history">
        <strong>${escapeHtml(t("noDebates"))}</strong>
        ${escapeHtml(t("firstVerdict"))}
      </div>
    `;
    return;
  }

  $("#debateHistory").innerHTML = history
    .map((debate) => {
      const resultLabel =
        debate.result === "win" ? t("won") : debate.result === "loss" ? t("lost") : t("draw");
      const date = new Date(debate.playedAt).toLocaleDateString(window.I18N.locale, {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
      const eloChange =
        debate.eloChange > 0 ? `+${debate.eloChange}` : String(debate.eloChange || 0);
      const eloClass =
        debate.eloChange > 0 ? "positive" : debate.eloChange < 0 ? "negative" : "";
      return `
        <article class="history-card ${debate.result}">
          <div class="history-result">
            <strong>${resultLabel}</strong>
            <span>${debate.score}/100</span>
          </div>
          <div class="history-copy">
            <small>${date} · ${escapeHtml(t("argued"))} ${escapeHtml(debate.stance === "for" ? t("forMotion") : t("against"))}</small>
            <h3>${escapeHtml(debate.topic)}</h3>
            <p>${escapeHtml(t("logic"))} ${debate.logic} · ${escapeHtml(t("evidence"))} ${debate.evidence} · ${escapeHtml(t("clarity"))} ${debate.clarity} · ${escapeHtml(t("relevance"))} ${debate.relevance}</p>
          </div>
          <div class="history-rating">
            <strong class="${eloClass}">${eloChange} ELO</strong>
            <span>${escapeHtml(t("finished"))} ${debate.eloAfter}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderProfile() {
  if (!state.user) return;
  const initials = state.user.username
    .split(/[_\-\s]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  $("#avatarInitials").textContent = initials || state.user.username.slice(0, 2).toUpperCase();
  $("#eloDisplay strong").textContent = state.user.elo;
  $("#profileName").textContent = state.user.username;
  $("#profileElo").textContent = state.user.elo;
  $("#profileMatches").textContent = state.user.matches;
}

function updateLocalizedArenaText() {
  if (state.topic) {
    $("#userStanceLabel").textContent = state.stance === "for" ? t("forSide") : t("againstSide");
    $("#aiStanceLabel").textContent = state.stance === "for" ? t("againstSide") : t("forSide");
  }
  $("#voiceToggle").innerHTML = `<span class="speaker-icon">◖))</span> ${
    state.voiceEnabled ? t("aiVoiceOn") : t("aiVoiceOff")
  }`;
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    $("#modeBadge").textContent =
      data.mode === "live"
        ? `Alpha Test · ${data.provider === "gemini" ? "Gemini" : "OpenAI"}`
        : "Alpha Test";
    state.voiceAvailable = Boolean(data.voice);
    if (!state.voiceAvailable) {
      $("#micButton").title = "Add an OpenAI API key to enable transcription.";
    }
  } catch {
    $("#modeBadge").textContent = "Arena offline";
  }
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showToast("Microphone recording is not supported in this browser.");
  }
  if (!state.voiceAvailable) {
    return showToast("Add an OpenAI API key to enable microphone transcription.");
  }

  try {
    state.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.recorder = new MediaRecorder(state.recordingStream);
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) state.audioChunks.push(event.data);
    });
    state.recorder.addEventListener("stop", transcribeRecording, { once: true });
    state.recorder.start();
    setRecordingUI(true);
  } catch (error) {
    showToast(
      error.name === "NotAllowedError"
        ? "Microphone permission was not granted."
        : "The microphone could not be started."
    );
  }
}

async function transcribeRecording() {
  setRecordingUI(false, true);
  const mimeType = state.recorder?.mimeType || "audio/webm";
  const blob = new Blob(state.audioChunks, { type: mimeType });
  stopRecording(true);
  if (!blob.size) return showToast("No audio was captured.");

  try {
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        "X-Debate-Language": window.I18N.locale
      },
      body: blob
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transcription failed.");
    const prefix = argumentInput.value.trim();
    argumentInput.value = `${prefix}${prefix ? " " : ""}${data.text}`.slice(0, 2000);
    $("#charCount").textContent = `${argumentInput.value.length} / 2000`;
    argumentInput.focus();
    showToast("Your argument is ready to edit.");
  } catch (error) {
    showToast(error.message);
  } finally {
    setRecordingUI(false);
  }
}

function stopRecording(silent = false) {
  if (state.recorder?.state === "recording") {
    state.recorder.removeEventListener("stop", transcribeRecording);
    state.recorder.stop();
  }
  state.recordingStream?.getTracks().forEach((track) => track.stop());
  state.recordingStream = null;
  state.recorder = null;
  state.audioChunks = [];
  if (!silent) setRecordingUI(false);
}

function setRecordingUI(recording, transcribing = false) {
  const button = $("#micButton");
  button.classList.toggle("recording", recording);
  button.setAttribute("aria-pressed", String(recording));
  button.disabled = transcribing;
  $(".mic-label").textContent = transcribing
    ? "Transcribing…"
    : recording
      ? "Stop recording"
      : "Use microphone";
}

function toggleVoice() {
  state.voiceEnabled = !state.voiceEnabled;
  const button = $("#voiceToggle");
  button.classList.toggle("active", state.voiceEnabled);
  button.setAttribute("aria-pressed", String(state.voiceEnabled));
  button.innerHTML = `<span class="speaker-icon">◖))</span> ${
    state.voiceEnabled ? t("aiVoiceOn") : t("aiVoiceOff")
  }`;
  if (!state.voiceEnabled) stopAudio();
}

function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) state.audioContext = new AudioContextClass();
  }
  if (state.audioContext?.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

async function showCeremony(type, roundNumber) {
  const overlay = $("#ceremonyOverlay");
  const verdict = type === "verdict";
  overlay.classList.remove("hidden", "leaving", "verdict");
  overlay.classList.toggle("verdict", verdict);
  $("#ceremonyIcon").textContent = verdict ? "⚖" : "🥊";
  $("#ceremonyTitle").textContent = verdict
    ? t("judgeRuled")
    : `${t("round")} ${roundNumber}`;
  $("#ceremonySubtitle").textContent = verdict
    ? t("argumentScore")
    : `${roundNumber} / ${state.rounds}`;
  if (verdict) {
    playGavelSound();
  } else {
    playBoxingBell();
  }
  await new Promise((resolve) => setTimeout(resolve, verdict ? 1050 : 900));
  overlay.classList.add("leaving");
  await new Promise((resolve) => setTimeout(resolve, 260));
  overlay.classList.add("hidden");
  overlay.classList.remove("leaving", "verdict");
}

function playBoxingBell() {
  const context = ensureAudioContext();
  if (!context) return;
  const now = context.currentTime;
  [0, 0.16].forEach((delay, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(index ? 980 : 1180, now + delay);
    oscillator.frequency.exponentialRampToValueAtTime(720, now + delay + 0.42);
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(0.22, now + delay + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.55);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + 0.58);
  });
}

function playGavelSound() {
  const context = ensureAudioContext();
  if (!context) return;
  const strike = (delay, volume) => {
    const now = context.currentTime + delay;
    const length = Math.floor(context.sampleRate * 0.16);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.exp(-index / (length * 0.12));
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = 480;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
  };
  strike(0, 0.65);
  strike(0.24, 0.42);
}

async function speakAI(text) {
  if (!state.voiceEnabled) return;
  stopAudio();

  if (state.voiceAvailable) {
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: window.I18N.locale })
      });
      if (!response.ok) throw new Error("Generated speech was unavailable.");
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      state.currentAudio = new Audio(audioUrl);
      state.currentAudio.addEventListener("ended", () => URL.revokeObjectURL(audioUrl), {
        once: true
      });
      await state.currentAudio.play();
      await new Promise((resolve) => {
        state.currentAudio.addEventListener("ended", resolve, { once: true });
        state.currentAudio.addEventListener("error", resolve, { once: true });
      });
      return;
    } catch {
      // Fall through to the browser voice when generated speech is unavailable.
    }
  }

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    const requestedLanguage = {
      en: "en-US",
      pt: "pt-BR",
      zh: "zh-CN",
      he: "he-IL"
    }[window.I18N.locale];
    const languagePrefix = requestedLanguage.split("-")[0].toLowerCase();
    const matchingVoice = speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));
    if (!matchingVoice) {
      showToast("A native browser voice is not installed for this language.");
      return;
    }
    utterance.lang = requestedLanguage;
    utterance.voice = matchingVoice;
    utterance.rate = 1.02;
    utterance.pitch = 0.92;
    await new Promise((resolve) => {
      utterance.onend = resolve;
      utterance.onerror = resolve;
      speechSynthesis.speak(utterance);
    });
  }
}

function stopAudio() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
