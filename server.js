const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  createUser,
  authenticate,
  createSession,
  getUserBySession,
  deleteSession,
  getRanking,
  getHistory,
  completeDebate,
  joinMatchmaking,
  getMatchmakingStatus,
  leaveMatchmaking,
  submitHumanTurn,
  completeHumanMatch,
  getHumanMatch
} = require("./storage");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const API_KEY = process.env.OPENAI_API_KEY;
const PUBLIC_DIR = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const judgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    logic: { type: "integer", minimum: 0, maximum: 100 },
    evidence: { type: "integer", minimum: 0, maximum: 100 },
    clarity: { type: "integer", minimum: 0, maximum: 100 },
    relevance: { type: "integer", minimum: 0, maximum: 100 },
    overall: { type: "integer", minimum: 0, maximum: 100 },
    strongest_point: { type: "string" },
    improvement: { type: "string" },
    verdict: { type: "string", enum: ["user_leads", "ai_leads", "tied"] }
  },
  required: [
    "logic",
    "evidence",
    "clarity",
    "relevance",
    "overall",
    "strongest_point",
    "improvement",
    "verdict"
  ]
};

const humanMatchJudgeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    player_one: judgeSchema,
    player_two: judgeSchema
  },
  required: ["player_one", "player_two"]
};

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src 'self' blob:; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      return json(res, 200, {
        ok: true,
        mode: API_KEY ? "live" : "alpha",
        model: MODEL,
        voice: Boolean(API_KEY)
      });
    }

    if (req.method === "POST" && req.url === "/api/auth/register") {
      const body = await readJson(req);
      validateCredentials(body);
      let user;
      try {
        user = createUser(body.username.trim(), body.password);
      } catch (error) {
        if (error.code === "USERNAME_TAKEN") {
          throw badRequest("That username is already registered.");
        }
        throw error;
      }
      setSessionCookie(res, createSession(user.id, Boolean(body.remember)));
      return json(res, 201, { user });
    }

    if (req.method === "POST" && req.url === "/api/auth/login") {
      const body = await readJson(req);
      validateCredentials(body);
      const user = authenticate(body.username, body.password);
      if (!user) {
        const error = badRequest("Username or passphrase did not match.");
        error.statusCode = 401;
        throw error;
      }
      setSessionCookie(res, createSession(user.id, Boolean(body.remember)));
      return json(res, 200, { user });
    }

    if (req.method === "POST" && req.url === "/api/auth/logout") {
      deleteSession(getSessionToken(req));
      clearSessionCookie(res);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && req.url === "/api/auth/me") {
      const user = getUserBySession(getSessionToken(req));
      if (!user) return json(res, 401, { error: "Not signed in." });
      return json(res, 200, { user });
    }

    if (req.method === "GET" && req.url === "/api/ranking") {
      requireUser(req);
      return json(res, 200, { ranking: getRanking() });
    }

    if (req.method === "GET" && req.url === "/api/history") {
      const user = requireUser(req);
      return json(res, 200, { history: getHistory(user.id) });
    }

    if (req.method === "POST" && req.url === "/api/matchmaking/join") {
      const user = requireUser(req);
      const body = await readJson(req);
      validateMatchmakingRequest(body);
      return json(res, 200, joinMatchmaking(user.id, body));
    }

    if (req.method === "GET" && req.url === "/api/matchmaking/status") {
      const user = requireUser(req);
      return json(res, 200, getMatchmakingStatus(user.id));
    }

    if (req.method === "POST" && req.url === "/api/matchmaking/leave") {
      const user = requireUser(req);
      leaveMatchmaking(user.id);
      return json(res, 200, { ok: true });
    }

    const matchRoute = req.url.match(/^\/api\/matches\/([a-f0-9-]{20,64})(?:\/turn)?$/i);
    if (matchRoute && req.method === "GET" && !req.url.endsWith("/turn")) {
      const user = requireUser(req);
      const match = getHumanMatch(matchRoute[1], user.id);
      if (!match) return json(res, 404, { error: "Match not found." });
      return json(res, 200, { match });
    }

    if (matchRoute && req.method === "POST" && req.url.endsWith("/turn")) {
      const user = requireUser(req);
      const body = await readJson(req);
      if (!isText(body.text, 10, 2000)) {
        throw badRequest("Your argument must be between 10 and 2,000 characters.");
      }
      let match;
      try {
        match = submitHumanTurn(matchRoute[1], user.id, body.text.trim());
      } catch (error) {
        if (error.code === "NOT_YOUR_TURN") throw badRequest("Wait for your opponent's turn.");
        if (error.code?.startsWith("MATCH_")) throw badRequest("This match is no longer active.");
        throw error;
      }
      if (match.status === "judging") {
        let verdict;
        try {
          verdict = API_KEY ? await judgeHumanMatch(match) : createDemoHumanVerdict(match);
        } catch (error) {
          console.error("Live human-match judging failed; using calibrated fallback.", error);
          verdict = createDemoHumanVerdict(match);
        }
        completeHumanMatch(match.id, verdict.player_one, verdict.player_two);
        match = getHumanMatch(match.id, user.id);
      }
      return json(res, 200, { match });
    }

    if (req.method === "POST" && req.url === "/api/transcribe") {
      if (!API_KEY) return json(res, 503, { error: "Voice input requires an OpenAI API key." });
      const audio = await readBuffer(req, 25_000_000);
      if (!audio.length) throw badRequest("No audio was recorded.");

      const form = new FormData();
      form.append("model", "gpt-4o-mini-transcribe");
      form.append("response_format", "json");
      const transcriptionLanguage = req.headers["x-debate-language"];
      if (["en", "pt", "zh", "he"].includes(transcriptionLanguage)) {
        form.append("language", transcriptionLanguage);
      }
      form.append(
        "file",
        new Blob([audio], { type: req.headers["content-type"] || "audio/webm" }),
        "debate-argument.webm"
      );

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}` },
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw openAIError(data, response.status);
      return json(res, 200, { text: data.text || "" });
    }

    if (req.method === "POST" && req.url === "/api/speech") {
      if (!API_KEY) return json(res, 503, { error: "AI speech requires an OpenAI API key." });
      const body = await readJson(req);
      if (!isText(body.text, 1, 3000)) throw badRequest("Speech text is invalid.");
      const voiceConfig = getVoiceConfig(body.language);

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: openAIHeaders(),
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: voiceConfig.voice,
          input: body.text,
          instructions: voiceConfig.instructions,
          response_format: "mp3"
        })
      });
      if (!response.ok) {
        const data = await response.json();
        throw openAIError(data, response.status);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": audio.length,
        "Cache-Control": "no-store"
      });
      return res.end(audio);
    }

    if (req.method === "POST" && req.url === "/api/debate") {
      requireUser(req);
      const body = await readJson(req);
      validateDebateRequest(body);

      if (!API_KEY) {
        return json(res, 200, createDemoTurn(body));
      }

      await moderate(`${body.topic}\n${body.argument}`);
      const aiReply = await generateOpponentReply(body);
      const evaluation = normalizeEvaluation(await judgeTurn(body, aiReply));

      return json(res, 200, { aiReply, evaluation });
    }

    if (req.method === "POST" && req.url === "/api/final") {
      const user = requireUser(req);
      const body = await readJson(req);
      validateDebateRequest(body, true);

      const evaluation = API_KEY
        ? normalizeEvaluation(await judgeFinal(body))
        : createDemoFinal(body).evaluation;
      let completion;
      try {
        completion = completeDebate(user.id, body, evaluation);
      } catch (error) {
        if (error.code === "DEBATE_ALREADY_SCORED") {
          throw badRequest("This debate has already been scored.");
        }
        throw error;
      }
      return json(res, 200, {
        evaluation,
        user: completion.user,
        eloChange: completion.eloChange,
        result: completion.result
      });
    }

    if (req.method === "GET") {
      return serveStatic(req, res);
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, {
      error: error.publicMessage || "Something went wrong in the arena."
    });
  }
});

server.listen(PORT, () => {
  console.log(`Dialectic is running at http://localhost:${PORT}`);
  console.log(API_KEY ? `Alpha Test · live AI · ${MODEL}` : "Alpha Test · add OPENAI_API_KEY for live AI");
});

async function generateOpponentReply({
  topic,
  stance,
  argument,
  history,
  language,
  difficulty,
  round,
  rounds
}) {
  const opponentStance = stance === "for" ? "against" : "for";
  const transcript = formatHistory(history);
  const languageName = getLanguageName(language);
  const level = getDifficultyPrompt(difficulty);
  const priorOpponentReplies = history
    .filter((item) => item.speaker === "ai")
    .map((item, index) => `${index + 1}. ${item.text}`)
    .join("\n");
  const prompt = [
    `Motion: ${topic}`,
    `The user argues ${stance} the motion. You argue ${opponentStance}.`,
    `This is round ${round} of ${rounds}.`,
    transcript ? `Debate so far:\n${transcript}` : "This is the opening exchange.",
    `User's latest argument:\n${argument}`,
    "You are the opponent, not a coach. Directly rebut the user's argument from the opposite side.",
    "Never help the user formulate, improve, restructure, or strengthen their case.",
    "Never say 'your argument would be stronger if' or offer advice about how the user should argue.",
    "Attack the reasoning, challenge assumptions, answer evidence, and advance your own opposing case.",
    "Respond primarily to the user's latest argument. Use earlier rounds only to expose contradictions or unresolved claims.",
    "Sound like a sharp human conversation partner, not a scoring system, tutor, or debate template.",
    "Begin with the substance of the disagreement. Do not begin with meta phrases such as 'your latest argument', 'your claim is', 'you say', 'let us grant', or equivalents in any language.",
    "Do not quote or restate the user's sentence unless a very short phrase is essential to challenge a precise ambiguity.",
    "Use natural transitions and varied sentence rhythm. Avoid canned mic-drop endings, slogans, parallel catchphrases, and theatrical verdict language.",
    priorOpponentReplies
      ? `Your previous replies, which you must not recycle semantically:\n${priorOpponentReplies}`
      : "You have not replied before.",
    "Do not repeat or lightly paraphrase an argument, opening, analogy, framing, attack, or conclusion you used earlier.",
    "Advance the debate with a genuinely new counterpoint in every round.",
    level,
    "Do not invent citations, statistics, studies, or quotations.",
    "If the user makes an unsupported factual claim, identify it as unsupported rather than asserting it is false.",
    `Write the entire response in ${languageName}. Do not switch languages unless quoting the user's exact words.`
  ].join("\n\n");

  const response = await openAIResponse({
    model: MODEL,
    reasoning: { effort: difficulty === "harvey" ? "high" : difficulty === "adult" ? "medium" : "low" },
    text: { verbosity: difficulty === "baby" ? "low" : "medium" },
    instructions:
      "You are an expert competitive debate opponent. You must always defend the side opposite the user. Never coach the user. Be intellectually honest, civil, concise, and persuasive.",
    input: prompt
  });

  return extractOutputText(response);
}

async function judgeTurn(body, aiReply) {
  const languageName = getLanguageName(body.language);
  const prompt = [
    `Motion: ${body.topic}`,
    `User stance: ${body.stance}`,
    `User argument:\n${body.argument}`,
    `Opponent response:\n${aiReply}`,
    "Score only the user's latest argument.",
    "Logic: internal validity and handling of counterarguments.",
    "Evidence: quality and appropriate use of verifiable support; do not reward made-up specificity.",
    "Clarity: structure, precision, and readability.",
    "Relevance: direct engagement with the motion and prior exchange.",
    "Overall should reflect the four dimensions, not confidence or rhetorical aggression.",
    scoreCalibrationPrompt(),
    "Do not default to 80–90. Most ordinary unsupported arguments belong between 40 and 70.",
    "Evidence must stay below 45 when the user gives only assertions, generic examples, or unverifiable claims.",
    "A short argument can score well, but only when its inference is explicit and its support is concrete.",
    "The verdict compares the force of this exchange, not the truth of the political or moral position.",
    `Write strongest_point and improvement entirely in ${languageName}.`
  ].join("\n\n");

  return structuredResponse(
    "You are an impartial debate judge. Apply the rubric consistently across viewpoints. Give concise, actionable feedback.",
    prompt,
    "debate_turn_score"
  );
}

async function judgeFinal(body) {
  const transcript = formatHistory(body.history);
  const languageName = getLanguageName(body.language);
  const prompt = [
    `Motion: ${body.topic}`,
    `User stance: ${body.stance}`,
    `Full debate:\n${transcript}`,
    "Score the user's total debate performance.",
    "Logic: consistency, valid inference, and rebuttal quality.",
    "Evidence: credible support and honest handling of uncertainty.",
    "Clarity: organization, precision, and accessibility.",
    "Relevance: sustained engagement with the motion and opponent.",
    "Judge argument quality, not whether you personally agree with the position.",
    scoreCalibrationPrompt(),
    "Evaluate development across rounds. Penalize repetition, evasion, contradictions, and failure to answer rebuttals.",
    "Do not default to 80–90. Reserve that band for genuinely strong competitive debating.",
    `Write strongest_point and improvement entirely in ${languageName}.`
  ].join("\n\n");

  return structuredResponse(
    "You are the final impartial judge of a debate. Be viewpoint-neutral, rigorous, and constructive.",
    prompt,
    "final_debate_score"
  );
}

async function structuredResponse(instructions, input, name) {
  const response = await openAIResponse({
    model: MODEL,
    reasoning: { effort: "medium" },
    instructions,
    input,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name,
        strict: true,
        schema: judgeSchema
      }
    }
  });

  return JSON.parse(extractOutputText(response));
}

async function judgeHumanMatch(match) {
  const firstUserId = match.messages[0]?.userId;
  const transcript = match.messages
    .map((item) => {
      const player = item.userId === firstUserId ? "Player one" : "Player two";
      return `Round ${item.round} — ${player}: ${item.text}`;
    })
    .join("\n\n");
  const languageName = getLanguageName(match.language);
  const response = await openAIResponse({
    model: MODEL,
    reasoning: { effort: "high" },
    instructions:
      "You are an impartial championship debate judge. Score each human independently and never favor a viewpoint.",
    input: [
      `Motion: ${match.topic}`,
      "The first speaker is Player one. The two players defend opposite sides of the motion.",
      `Transcript:\n${transcript}`,
      scoreCalibrationPrompt(),
      "Compare direct engagement, but score each player's logic, evidence, clarity, and relevance independently.",
      "Penalize unsupported claims, dropped objections, repetition, contradictions, and rhetorical confidence without substance.",
      `Write all feedback entirely in ${languageName}.`
    ].join("\n\n"),
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "human_match_verdict",
        strict: true,
        schema: humanMatchJudgeSchema
      }
    }
  });
  const result = JSON.parse(extractOutputText(response));
  return {
    player_one: normalizeEvaluation(result.player_one),
    player_two: normalizeEvaluation(result.player_two)
  };
}

async function moderate(input) {
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify({ model: "omni-moderation-latest", input })
  });

  const data = await response.json();
  if (!response.ok) throw openAIError(data, response.status);
  if (data.results?.[0]?.flagged) {
    const error = new Error("Moderation blocked this debate.");
    error.statusCode = 400;
    error.publicMessage =
      "That topic or argument cannot be used in the arena. Try reframing it toward ideas and policy.";
    throw error;
  }
}

async function openAIResponse(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) throw openAIError(data, response.status);
  return data;
}

function openAIHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`
  };
}

function openAIError(data, status) {
  const error = new Error(data?.error?.message || "OpenAI request failed");
  error.statusCode = status >= 400 && status < 500 ? 400 : 502;
  error.publicMessage =
    status === 401
      ? "The OpenAI API key is invalid or missing."
      : "The AI judge is temporarily unavailable. Please try again.";
  return error;
}

function extractOutputText(response) {
  const text = response.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")?.text;

  if (!text) throw new Error("The model returned no text output.");
  return text;
}

function createDemoTurn(body) {
  const evaluation = analyzeArgument(body.argument, body.topic, body.history);

  const copy = getDemoCopy(body.language, body.difficulty);
  return {
    aiReply: getDemoRoundReply(body, copy),
    evaluation: {
      ...evaluation,
      strongest_point: copy.strongestPoint,
      improvement: evaluation.evidence >= 55
        ? copy.improvementEvidence
        : copy.improvementNoEvidence,
      verdict:
        evaluation.overall >= 72
          ? "user_leads"
          : evaluation.overall >= 58
            ? "tied"
            : "ai_leads"
    }
  };
}

function createDemoFinal(body) {
  const userArguments = body.history.filter((item) => item.speaker === "user");
  const combined = userArguments.map((item) => item.text).join(" ");
  return {
    evaluation: createDemoTurn({ ...body, argument: combined || body.argument }).evaluation
  };
}

function createDemoHumanVerdict(match) {
  const firstUserId = match.messages[0]?.userId;
  const oneText = match.messages
    .filter((item) => item.userId === firstUserId)
    .map((item) => item.text)
    .join(" ");
  const twoText = match.messages
    .filter((item) => item.userId !== firstUserId)
    .map((item) => item.text)
    .join(" ");
  const copy = getDemoCopy(match.language);
  const decorate = (score) => ({
    ...score,
    strongest_point: copy.strongestPoint,
    improvement:
      score.evidence >= 55 ? copy.improvementEvidence : copy.improvementNoEvidence,
    verdict: score.overall >= 65 ? "user_leads" : score.overall >= 50 ? "tied" : "ai_leads"
  });
  return {
    player_one: decorate(analyzeArgument(oneText, match.topic, [])),
    player_two: decorate(analyzeArgument(twoText, match.topic, []))
  };
}

function analyzeArgument(text, topic, history = []) {
  const clean = String(text).trim();
  const words = clean.match(/[\p{L}\p{N}]+/gu) || [];
  const wordCount = words.length;
  const sentences = clean.split(/[.!?。！？]+/).filter((item) => item.trim()).length;
  const causal = countMatches(
    clean,
    /\b(because|therefore|thus|since|consequently|porque|portanto|logo|pois|因此|所以|因为|לכן|מפני|משום)\b/giu
  );
  const rebuttal = countMatches(
    clean,
    /\b(however|although|but|yet|despite|however|porém|embora|mas|contudo|然而|但是|尽管|אבל|אולם|למרות)\b/giu
  );
  const example = countMatches(
    clean,
    /\b(for example|for instance|such as|por exemplo|como no caso|例如|比如|לדוגמה|למשל)\b/giu
  );
  const source = countMatches(
    clean,
    /\b(according to|study|research|report|survey|data|statistics|segundo|estudo|pesquisa|relatório|dados|统计|研究|报告|数据|מחקר|דו"ח|נתונים|סקר)\b/giu
  );
  const numbers = (clean.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).length;
  const absolutes = countMatches(
    clean,
    /\b(always|never|everyone|nobody|obviously|sempre|nunca|todos|ninguém|obviamente|总是|从不|所有人|显然|תמיד|לעולם|כולם|ברור)\b/giu
  );
  const topicTerms = new Set(
    (String(topic).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(
      (term) => !COMMON_WORDS.has(term)
    )
  );
  const argumentTerms = new Set(words.map((word) => word.toLocaleLowerCase()));
  const overlap = [...topicTerms].filter((term) => argumentTerms.has(term)).length;
  const priorUserText = history
    .filter((item) => item.speaker === "user")
    .map((item) => item.text.toLocaleLowerCase());
  const repeated = priorUserText.some((prior) => textSimilarity(clean.toLocaleLowerCase(), prior) > 0.7);
  const lengthQuality =
    wordCount < 12 ? -18 : wordCount < 30 ? -7 : wordCount <= 220 ? 10 : wordCount <= 350 ? 3 : -8;
  const structure = Math.min(14, Math.max(0, sentences - 1) * 3);
  const jitter = stableJitter(clean);

  const logic = clampScore(
    38 + lengthQuality + Math.min(18, causal * 7) + Math.min(12, rebuttal * 6) + structure - absolutes * 4 - (repeated ? 14 : 0) + jitter
  );
  const evidence = clampScore(
    22 + Math.min(18, example * 9) + Math.min(28, source * 14) + Math.min(18, numbers * 7) + (wordCount >= 45 ? 5 : 0) - absolutes * 3 + jitter
  );
  const clarity = clampScore(
    48 + lengthQuality + structure + (sentences >= 2 ? 8 : 0) - (wordCount > 300 ? 10 : 0) - (repeated ? 6 : 0) + jitter
  );
  const relevance = clampScore(
    48 + Math.min(28, overlap * 9) + Math.min(10, rebuttal * 4) - (overlap === 0 && topicTerms.size ? 12 : 0) - (repeated ? 8 : 0) + jitter
  );
  return normalizeEvaluation({ logic, evidence, clarity, relevance });
}

const COMMON_WORDS = new Set([
  "the", "and", "that", "this", "with", "from", "para", "com", "que", "uma", "por",
  "como", "mais", "should", "has", "have", "ser", "não", "dos", "das"
]);

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function stableJitter(text) {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.codePointAt(0)) | 0;
  return Math.abs(hash % 7) - 3;
}

function textSimilarity(one, two) {
  const a = new Set(one.match(/[\p{L}\p{N}]{3,}/gu) || []);
  const b = new Set(two.match(/[\p{L}\p{N}]{3,}/gu) || []);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((term) => b.has(term)).length;
  return shared / Math.min(a.size, b.size);
}

function normalizeEvaluation(score) {
  const logic = clampScore(score.logic);
  const evidence = clampScore(score.evidence);
  const clarity = clampScore(score.clarity);
  const relevance = clampScore(score.relevance);
  const overall = Math.round(logic * 0.35 + evidence * 0.25 + clarity * 0.2 + relevance * 0.2);
  return { ...score, logic, evidence, clarity, relevance, overall };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function scoreCalibrationPrompt() {
  return [
    "Use this absolute scale for every criterion:",
    "90–100: exceptional championship-level reasoning with precise, credible support and no important dropped objection.",
    "75–89: strong and persuasive, but with identifiable limitations.",
    "60–74: competent and relevant, with incomplete support or rebuttal.",
    "40–59: weak; material gaps, assertions, or limited engagement.",
    "20–39: seriously flawed, largely unsupported, confused, or evasive.",
    "0–19: absent, incoherent, or unrelated."
  ].join("\n");
}

function validateDebateRequest(body, final = false) {
  if (!body || typeof body !== "object") throw badRequest("Invalid request.");
  if (!isText(body.topic, 8, 240)) throw badRequest("Enter a debate topic between 8 and 240 characters.");
  if (!["for", "against"].includes(body.stance)) throw badRequest("Choose a side.");
  if (!["baby", "adult", "harvey"].includes(body.difficulty || "adult")) {
    throw badRequest("Choose a valid difficulty.");
  }
  if (![3, 5].includes(body.rounds)) throw badRequest("Choose a 3-round or 5-round debate.");
  if (!Number.isInteger(body.round) || body.round < 1 || body.round > body.rounds) {
    throw badRequest("The debate round is invalid.");
  }
  if (!["en", "pt", "zh", "he"].includes(body.language || "en")) {
    throw badRequest("Choose a supported language.");
  }
  if (
    final &&
    (typeof body.debateId !== "string" ||
      !/^[a-f0-9-]{20,64}$/i.test(body.debateId))
  ) {
    throw badRequest("The debate identifier is invalid.");
  }
  if (!Array.isArray(body.history) || body.history.length > 20) {
    throw badRequest("The debate history is invalid or too long.");
  }
  if (final && body.history.filter((item) => item.speaker === "user").length !== body.rounds) {
    throw badRequest("Complete every round before requesting the final verdict.");
  }
  if (!final && !isText(body.argument, 10, 2000)) {
    throw badRequest("Your argument must be between 10 and 2,000 characters.");
  }
}

function validateCredentials(body) {
  if (!body || typeof body !== "object") throw badRequest("Invalid request.");
  if (
    typeof body.username !== "string" ||
    !/^[\p{L}\p{N}_-]{3,24}$/u.test(body.username.trim())
  ) {
    throw badRequest("Username must contain 3–24 letters, numbers, underscores, or hyphens.");
  }
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72) {
    throw badRequest("Passphrase must contain 8–72 characters.");
  }
}

function validateMatchmakingRequest(body) {
  if (!body || typeof body !== "object") throw badRequest("Invalid request.");
  if (!isText(body.topic, 8, 240)) throw badRequest("Enter a debate topic between 8 and 240 characters.");
  if (!["for", "against"].includes(body.stance)) throw badRequest("Choose a side.");
  if (![3, 5].includes(body.rounds)) throw badRequest("Choose a 3-round or 5-round debate.");
  if (!["en", "pt", "zh", "he"].includes(body.language)) {
    throw badRequest("Choose a supported language.");
  }
}

function requireUser(req) {
  const user = getUserBySession(getSessionToken(req));
  if (!user) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    error.publicMessage = "Sign in to continue.";
    throw error;
  }
  return user;
}

function getSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)dialectic_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setSessionCookie(res, session) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = session.maxAge ? `; Max-Age=${session.maxAge}` : "";
  res.setHeader(
    "Set-Cookie",
    `dialectic_session=${encodeURIComponent(session.token)}; HttpOnly; Path=/; SameSite=Lax${secure}${maxAge}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `dialectic_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
}

function getLanguageName(language) {
  return {
    en: "English",
    pt: "Brazilian Portuguese",
    zh: "Simplified Chinese",
    he: "Hebrew"
  }[language] || "English";
}

function getDifficultyPrompt(difficulty) {
  if (difficulty === "baby") {
    return "Difficulty: Baby. Use 45–75 words. Make one surface-level objection with simple vocabulary. Rely on one obvious premise, do not synthesize multiple lines of attack, and leave one contestable assumption exposed. Never deliberately agree or coach.";
  }
  if (difficulty === "harvey") {
    return "Difficulty: Harvey Specter. Use 120–190 words. Privately generate three distinct counter-strategies, reject any that resemble earlier replies, and output only the strongest. Steelman the latest claim, expose its hidden premise, make one strategic concession, then use an inversion, dilemma, or consequence test to turn the case. Be surgical and surprising, not theatrical. Do not impersonate or quote any copyrighted character.";
  }
  return "Difficulty: Adult. Use 90–145 words. Privately map the claim, premise, evidence, and missing link. Directly rebut the weakest link, answer one likely defense, and advance one positive reason for the opposing side. Be rigorous but conventional.";
}

function getVoiceConfig(language) {
  const configs = {
    en: {
      voice: "cedar",
      instructions:
        "Speak in native, natural English with a composed, incisive debate cadence."
    },
    pt: {
      voice: "coral",
      instructions:
        "Fale somente em português brasileiro, com pronúncia nativa, ritmo natural e tom confiante de debate. Não use sotaque de falante de inglês."
    },
    zh: {
      voice: "marin",
      instructions:
        "请只使用自然、地道的普通话发音，语速清晰，语气自信而有辩论感。不要带英语口音。"
    },
    he: {
      voice: "sage",
      instructions:
        "דברו רק בעברית ישראלית טבעית, בהגייה מקומית, בקצב ברור ובטון בטוח של דיון. אין להשתמש במבטא אנגלי."
    }
  };
  return configs[language] || configs.en;
}

function getDemoCopy(language, difficulty = "adult") {
  const copies = {
    en: {
      strongestPoint: "You state a recognizable claim and connect it directly to the motion.",
      improvementEvidence: "Explain why your evidence supports the conclusion and address the strongest objection.",
      improvementNoEvidence: "Add one concrete, verifiable example and make the causal link explicit."
    },
    pt: {
      strongestPoint: "Você apresenta uma afirmação reconhecível e a conecta diretamente à moção.",
      improvementEvidence: "Explique por que a evidência sustenta a conclusão e responda à objeção mais forte.",
      improvementNoEvidence: "Adicione um exemplo concreto e verificável e deixe explícita a relação causal."
    },
    zh: {
      strongestPoint: "你提出了明确的主张，并将它直接与辩题联系起来。",
      improvementEvidence: "说明证据为何支持结论，并回应最有力的反对意见。",
      improvementNoEvidence: "加入一个具体、可验证的例子，并明确说明因果关系。"
    },
    he: {
      strongestPoint: "הצגתם טענה ברורה וקישרתם אותה ישירות לנושא הדיון.",
      improvementEvidence: "הסבירו מדוע הראיות תומכות במסקנה והתייחסו להתנגדות החזקה ביותר.",
      improvementNoEvidence: "הוסיפו דוגמה קונקרטית וניתנת לאימות והבהירו את הקשר הסיבתי."
    }
  };
  return copies[language] || copies.en;
}

function getDemoRoundReply(body) {
  const theme = detectDebateTheme(`${body.topic} ${body.argument}`);
  const side = body.stance === "for" ? "against" : "for";
  const preferredAngle = detectCounterAngle(body.argument, theme);
  const bank = getContextualReplyBank(body.language, theme, side, body.difficulty);
  const priorReplies = body.history
    .filter((item) => item.speaker === "ai")
    .map((item) => item.text);
  for (let offset = 0; offset < bank.length; offset += 1) {
    const candidate = bank[(preferredAngle + offset) % bank.length];
    if (!priorReplies.some((reply) => textSimilarity(reply, candidate) > 0.58)) {
      return candidate;
    }
  }
  return bank[Math.max(0, (body.round || 1) - 1) % bank.length];
}

function detectDebateTheme(text) {
  const normalized = String(text).toLocaleLowerCase();
  if (/(rede social|redes sociais|social media|misinformation|desinforma|algorit|instagram|tiktok|facebook|社交媒体|רשתות חברתיות)/u.test(normalized)) {
    return "social_media";
  }
  if (/(transporte público|public transport|ônibus|metro|metrô|tarifa|公交|תחבורה ציבורית)/u.test(normalized)) {
    return "public_transport";
  }
  if (/(inteligência artificial|inteligencia artificial|artificial intelligence|\bia\b|\bai\b|人工智能|בינה מלאכותית)/u.test(normalized)) {
    return "artificial_intelligence";
  }
  return "general";
}

function detectCounterAngle(argument, theme) {
  const text = String(argument).toLocaleLowerCase();
  if (theme === "social_media") {
    if (/(algorit|vício|vicio|atenção|atencao|engajamento)/u.test(text)) return 2;
    if (/(saúde mental|saude mental|ansiedade|depress|mental health|autoestima)/u.test(text)) return 1;
    if (/(desinforma|fake news|mentira|misinformation)/u.test(text)) return 0;
    if (/(conecta|comunidade|amizade|informação|informacao|acesso)/u.test(text)) return 3;
  }
  if (/(custo|preço|preco|imposto|financia|cost|tax)/u.test(text)) return 1;
  if (/(dados|estudo|pesquisa|relatório|relatorio|%|data|study|report)/u.test(text)) return 2;
  if (/(sempre|nunca|todos|ninguém|ninguem|always|never|everyone)/u.test(text)) return 3;
  return 0;
}

function getContextualReplyBank(language, theme, side, difficulty) {
  const locale = CONTEXTUAL_REPLIES[language] || CONTEXTUAL_REPLIES.en;
  const themeBank = locale[theme] || locale.general;
  const sideBank = themeBank[side];
  return sideBank[difficulty] || sideBank.adult;
}

const CONTEXTUAL_REPLIES = {
  pt: {
    social_media: {
      against: {
        baby: [
          "Desinformação já existia antes das redes. Elas também permitem que erros sejam corrigidos rapidamente e por muita gente.",
          "Nem todo uso de rede social causa ansiedade. Para muita gente, ela é justamente onde encontra apoio e companhia.",
          "O algoritmo pode ser ruim, mas isso mostra que o algoritmo precisa mudar — não que toda rede social faça mais mal do que bem.",
          "Você está deixando de lado quem usa essas plataformas para trabalhar, aprender ou manter contato com pessoas distantes.",
          "Há problemas reais, mas ainda falta mostrar que eles são maiores do que todos os benefícios somados."
        ],
        adult: [
          "Desinformação não nasceu nas redes sociais; o que mudou foi a velocidade de circulação. Só que a mesma velocidade também permite contestação pública, checagem coletiva e acesso direto a fontes que antes dependiam de poucos intermediários. Para provar um saldo negativo, não basta mostrar que a mentira viaja rápido — é preciso mostrar que a correção e o acesso ampliado à informação pesam menos.",
          "A relação com saúde mental não é tão simples quanto “usar rede social causa ansiedade”. Pessoas isoladas ou já vulneráveis tendem a usar mais essas plataformas, então parte da correlação pode ter a direção inversa. Além disso, comunidades de apoio e contato social também protegem o bem-estar. O efeito depende muito mais do tipo de uso do que da existência da ferramenta.",
          "O alvo mais convincente aí é o modelo de recomendação, não a rede social em si. Feed infinito, incentivo ao choque e coleta agressiva de dados podem ser regulados sem eliminar os benefícios de comunicação, mobilização e criação. Se o dano vem de escolhas específicas de design, condenar o meio inteiro é amplo demais.",
          "Para quem vive longe da família, tem uma doença rara, pertence a uma minoria ou depende da internet para trabalhar, essas plataformas não são distração: são infraestrutura social. Esses ganhos são menos barulhentos do que uma polêmica viral, mas contam no balanço. Um caso de dano visível não apaga milhões de usos cotidianos úteis.",
          "Mostrar que as redes produzem danos sérios ainda não resolve a comparação. Televisão, jornais, grupos privados e aplicativos de mensagem também espalham manipulação, só com menos transparência e menor possibilidade de resposta pública. A pergunta é se retirar ou reduzir as redes melhoraria o ambiente informacional — e isso não está garantido."
        ],
        harvey: [
          "Culpar a rede pela desinformação confunde o amplificador com a origem. Antes, poucas instituições decidiam quais erros seriam vistos e quais correções teriam espaço; agora a mentira escala, mas o contraditório também. Se a acusação é “há mais informação ruim”, falta a parte decisiva: provar que uma sociedade com menos acesso, menos contestação e mais gatekeepers produziria um saldo melhor.",
          "Ansiedade não assina recibo dizendo de onde veio. Pessoas vulneráveis procuram mais interação online, comparações sociais machucam alguns usuários e comunidades digitais salvam outros do isolamento. Transformar efeitos diferentes numa condenação única parece firme, mas foge da pergunta difícil: qual uso, qual plataforma, qual faixa etária e comparado a quê?",
          "Se o problema é um feed projetado para maximizar atenção, então temos um réu bem específico: o incentivo econômico do algoritmo. Condenar toda a rede social por isso seria como proibir estradas porque certos pedágios foram mal desenhados. Regule a arquitetura nociva; não finja que comunicação, organização política e acesso a mercados são danos colaterais descartáveis.",
          "Os benefícios mais importantes quase nunca viralizam. É o pequeno negócio que encontra clientes, a família separada por um oceano, o paciente que finalmente encontra alguém com o mesmo diagnóstico. Seu balanço dá peso total ao escândalo visível e peso zero ao valor cotidiano. Assim qualquer tecnologia parece culpada.",
          "Uma internet sem redes sociais não vira uma praça iluminada e racional. A conversa migra para canais fechados, onde boatos circulam sem contestação pública e pesquisadores enxergam menos. Você pode reduzir a vitrine e piorar o problema. Para vencer essa comparação, precisa mostrar um mundo alternativo melhor, não apenas um presente imperfeito."
        ]
      },
      for: {
        baby: [
          "A mentira existia antes, mas as redes fazem ela chegar a milhões de pessoas em minutos. Isso muda bastante o tamanho do dano.",
          "Mesmo conectando pessoas, essas plataformas também incentivam comparação constante e podem piorar a ansiedade.",
          "O problema do algoritmo não é pequeno: ele escolhe o que as pessoas veem e costuma premiar o conteúdo mais exagerado.",
          "Alguns usos são bons, mas isso não significa que o efeito geral seja positivo para a sociedade.",
          "Corrigir uma mentira depois não desfaz todo o impacto que ela já causou."
        ],
        adult: [
          "A existência anterior da desinformação não absolve uma tecnologia que a tornou instantânea, barata e precisamente direcionada. Uma correção raramente alcança as mesmas pessoas com a mesma força emocional da mentira original. O ganho de acesso à informação existe, mas o sistema recompensa aquilo que prende atenção — e falsidades indignantes fazem isso muito bem.",
          "Dizer que o efeito depende do uso ignora quem desenha esse uso. Notificações, comparação pública, métricas de aprovação e rolagem infinita não surgiram por acaso; foram construídas para prolongar permanência. Quando milhões de adolescentes são expostos ao mesmo incentivo, já não estamos falando apenas de escolhas individuais.",
          "Separar o algoritmo da rede parece elegante, mas o algoritmo é o coração econômico dessas plataformas. O conteúdo mais provocador gera mais interação, mais dados e mais anúncios. Se o lucro depende do mecanismo que produz o dano, tratá-lo como um detalhe corrigível subestima o problema.",
          "Os benefícios para comunidades e pequenos negócios são reais, mas não exigem necessariamente feeds manipulativos, vigilância comercial e competição permanente por atenção. Comunicação digital pode existir sem esse modelo. Defender os benefícios não justifica aceitar a arquitetura que os acompanha hoje.",
          "O saldo social não é uma soma simples de usuários satisfeitos. Polarização política, perseguição coordenada e desinformação sanitária geram custos para pessoas que nem usam a plataforma. Quando o dano transborda para eleições, escolas e saúde pública, o benefício privado deixa de encerrar a conta."
        ],
        harvey: [
          "“A mentira sempre existiu” é uma defesa estranha para uma máquina que industrializou sua distribuição. A diferença não é filosófica; é operacional: alcance automático, segmentação precisa e repetição contínua. A correção entra numa corrida depois da largada, enquanto o modelo de negócio paga justamente ao conteúdo que provoca antes de informar.",
          "Chamar isso de escolha do usuário é conveniente para quem desenhou a escolha. A plataforma decide quando interromper, o que recomendar, quais números transformar em status e quanto atrito remover antes do próximo vídeo. Quando o ambiente é construído para explorar impulsos previsíveis, responsabilizar apenas quem caiu nele não é liberdade; é terceirização.",
          "O algoritmo não é um acessório que pode ser retirado sem mexer no negócio. Ele é o gerente da atenção: escolhe o que aparece, quem cresce e qual emoção paga melhor. Se indignação e medo rendem mais minutos de tela, o dano não é uma falha ocasional. É um produto secundário lucrativo.",
          "Conexão, comunidade e comércio são funções valiosas; o problema é usá-las como escudo para vigilância, dependência e manipulação. Um serviço pode oferecer algo útil e ainda causar um saldo negativo. Cassinos também criam empregos — ninguém usa isso para fingir que o mecanismo de exploração deixou de existir.",
          "O usuário recebe uma conversa gratuita; a plataforma recebe um mapa comportamental e o poder de ordenar sua realidade. Esse acordo afeta até quem nunca o aceitou, porque muda eleições, reputações e normas sociais. Quando o custo é coletivo e o lucro é privado, contar apenas os benefícios individuais distorce o placar."
        ]
      }
    },
    public_transport: {
      against: {
        baby: [
          "Gratuito para o passageiro não significa gratuito para a cidade. O dinheiro ainda precisa sair de algum lugar.",
          "Se a procura aumentar muito e a frota continuar igual, o serviço pode ficar mais lotado e pior.",
          "Pessoas ricas também deixariam de pagar, mesmo podendo arcar com a tarifa.",
          "Talvez seja melhor ajudar diretamente quem precisa do que eliminar a tarifa para todos.",
          "Sem explicar como ampliar ônibus e metrôs, retirar a tarifa resolve só uma parte do problema."
        ],
        adult: [
          "Zerar a tarifa remove uma barreira, mas também elimina uma fonte de receita justamente quando a demanda tende a subir. Sem financiamento estável para ampliar frota e frequência, o acesso melhora no papel e piora dentro de veículos mais lotados.",
          "A gratuidade universal subsidia da mesma forma quem não consegue pagar e quem pagaria sem dificuldade. Uma tarifa social bem desenhada pode concentrar recursos nos passageiros vulneráveis e preservar dinheiro para qualidade, segurança e expansão.",
          "O principal obstáculo em muitas cidades não é apenas o preço; é o ônibus que não chega, a viagem longa e a integração ruim. Gastar todo o orçamento na tarifa pode deixar intacto aquilo que mais afasta as pessoas do transporte coletivo.",
          "Financiar o sistema por impostos pode ser justo, mas depende de qual imposto e de quem realmente paga. Sem essa definição, a proposta corre o risco de trocar uma cobrança visível por outra regressiva e menos transparente.",
          "Aumentar passageiros só reduz congestionamento se o sistema tiver capacidade e se motoristas realmente migrarem do carro. Caso contrário, a gratuidade atrai sobretudo pessoas que antes caminhavam ou pedalavam, com pouco efeito sobre o trânsito."
        ],
        harvey: [
          "A catraca pode desaparecer; o custo não. Ele apenas muda de endereço e chega ao orçamento que também paga frota, manutenção e frequência. Se a demanda sobe enquanto a capacidade fica parada, a vitória é entrar de graça num serviço pior.",
          "Universalidade soa justa até você perceber que entrega o mesmo subsídio a quem precisa escolher entre passagem e almoço e a quem poderia pagar sem notar. Igualdade de desconto não é igualdade de impacto. Direcionar o benefício pode proteger os vulneráveis sem drenar a expansão do sistema.",
          "Preço é a porta de entrada, não a viagem inteira. Um ônibus gratuito que leva duas horas, não aparece à noite e deixa bairros periféricos sem conexão continua excluindo. Se o orçamento só compra a retirada da tarifa, a proposta pode financiar um símbolo e abandonar o serviço.",
          "“O governo paga” não é uma fonte de recursos; é uma frase que esconde o pagador. Imposto sobre consumo, folha, imóvel ou congestionamento produz efeitos completamente diferentes. Até essa escolha aparecer, a gratuidade é uma conta sem nome.",
          "Para tirar carros da rua, você precisa competir com conveniência, tempo e confiabilidade. Tarifa zero pode deslocar pedestres e ciclistas sem convencer motoristas. A proposta celebra o número de embarques antes de provar o resultado que realmente importa."
        ]
      },
      for: {
        baby: [
          "A tarifa também tem custo: ela impede pessoas pobres de chegar ao trabalho, à escola e ao médico.",
          "Cobrar passagem não garante um serviço bom. Muitas cidades já cobram caro e ainda oferecem transporte lotado.",
          "O transporte beneficia a cidade inteira, então faz sentido ser financiado coletivamente.",
          "Mais passageiros podem significar menos carros, menos trânsito e menos poluição.",
          "Uma tarifa social ainda deixa burocracia e pessoas vulneráveis de fora."
        ],
        adult: [
          "A tarifa não é apenas receita; é uma barreira que limita acesso a emprego, saúde e educação. Quando a mobilidade determina quais oportunidades uma pessoa consegue alcançar, retirar essa barreira produz ganhos econômicos que voltam para a própria cidade.",
          "Preservar a cobrança não garante investimento em qualidade. Um financiamento público estável pode separar a sobrevivência do sistema da quantidade de passageiros e permitir planejamento de longo prazo, inclusive em linhas pouco lucrativas mas socialmente essenciais.",
          "O benefício não fica restrito a quem embarca. Menos carros significam menos congestionamento, poluição e espaço urbano dedicado a estacionamento. Como a cidade inteira recebe parte do retorno, o financiamento coletivo é defensável.",
          "Tarifa focalizada parece eficiente, mas cria cadastro, fiscalização, estigma e erros de exclusão. A gratuidade universal elimina esses custos e garante que uma perda de renda não interrompa imediatamente a mobilidade de alguém.",
          "Tratar a passagem como consumo comum ignora que transporte conecta todos os outros direitos. A cidade já financia ruas sem cobrar cada motorista por viagem; aplicar outra lógica ao ônibus penaliza justamente quem ocupa menos espaço e polui menos."
        ],
        harvey: [
          "A tarifa cobra mais de quem tem menos escolha. Para um trabalhador de baixa renda, ela não precifica uma viagem; decide quantas oportunidades cabem no mês. Mobilidade abre acesso a emprego, estudo e saúde, então tratá-la apenas como receita ignora o valor econômico que ela cria.",
          "Manter a catraca em nome da qualidade pressupõe que a cobrança atual entrega qualidade — e frequentemente não entrega. Receita previsível via orçamento público permite planejar frota e linhas essenciais sem punir o sistema toda vez que a demanda cai.",
          "Motoristas recebem ruas, viadutos e estacionamento subsidiados sem uma cobrança a cada esquina. Quando o transporte coletivo pede financiamento comum, de repente surge a obsessão com o usuário pagador. Essa assimetria favorece o meio mais caro e poluente.",
          "Focalização economiza no benefício e gasta na fronteira: cadastro, prova de pobreza, fiscalização e gente elegível ficando de fora. A universalidade não é desperdício automático; é uma forma de eliminar o pedágio burocrático que costuma punir quem mais precisa.",
          "O orçamento público já paga pelo congestionamento, pela poluição e pelos acidentes. A tarifa zero não cria todos os custos do nada; ela troca parte de custos dispersos e destrutivos por investimento direto em mobilidade. A comparação correta não é passagem contra zero, mas sistema contra sistema."
        ]
      }
    },
    artificial_intelligence: {
      against: {
        baby: [
          "A IA pode errar, mas também ajuda pessoas a trabalhar e aprender mais rápido.",
          "Proibir ou limitar demais pode impedir usos médicos e científicos importantes.",
          "O problema pode estar no uso irresponsável, não na tecnologia inteira.",
          "Ferramentas novas sempre mudam empregos, mas também criam funções novas.",
          "Regras específicas podem reduzir riscos sem bloquear os benefícios."
        ],
        adult: [
          "O risco de erro é real, mas precisa ser comparado ao erro humano que a ferramenta pode reduzir. Em diagnóstico, revisão e detecção de padrões, usar IA com supervisão pode ser mais seguro do que manter processos inteiramente manuais.",
          "Automação desloca tarefas, não necessariamente profissões inteiras. Ao reduzir trabalho repetitivo, ela também pode ampliar produtividade e permitir que pessoas se concentrem em julgamento, negociação e cuidado — atividades difíceis de automatizar.",
          "Casos de abuso justificam responsabilidade e auditoria, não uma condenação geral da tecnologia. Regras focadas em impacto conseguem tratar reconhecimento facial, decisões de crédito e conteúdo sintético de formas diferentes.",
          "Acesso a tutoria, tradução e ferramentas criativas pode deixar de ser privilégio de quem paga por especialistas. Esse ganho distributivo merece entrar no balanço junto com os riscos.",
          "Frear adoção local não faz a tecnologia desaparecer; pode apenas deslocar desenvolvimento para ambientes com menos transparência. Participar da construção torna mais viável impor padrões e fiscalização."
        ],
        harvey: [
          "Comparar uma IA imperfeita com um humano ideal é um truque. A comparação honesta é com sistemas reais: cansados, caros, inconsistentes e também enviesados. Supervisão, rastreabilidade e testes podem tornar a combinação melhor do que qualquer lado sozinho.",
          "A automação raramente engole uma profissão inteira de uma vez; ela desmonta tarefas. Quem trata toda mudança de tarefa como destruição ignora o aumento de demanda que produtividade mais alta pode criar. A questão séria é transição e distribuição, não congelamento.",
          "“IA” não é um único risco. Um filtro de spam, um sistema de crédito e uma arma autônoma não merecem a mesma regra. Legislar pelo rótulo produz proibição vaga; legislar pelo dano cria responsabilidade verificável.",
          "Um tutor particular sempre disponível, tradução instantânea e assistência técnica barata têm enorme valor para quem hoje não pode comprar especialistas. Ignorar isso porque usuários ricos já têm alternativas transforma prudência em preservação de privilégio.",
          "Sair da corrida não encerra a corrida. Só entrega padrões, capacidade e influência a outros atores. Governança exige presença técnica suficiente para auditar, entender e negociar — distância não é controle."
        ]
      },
      for: {
        baby: [
          "A IA pode ajudar, mas também pode repetir preconceitos em grande escala.",
          "Quando empresas automatizam trabalho, os benefícios nem sempre chegam aos trabalhadores.",
          "Erros médicos ou jurídicos feitos por IA podem afetar muita gente rapidamente.",
          "Nem sempre sabemos quais dados foram usados ou por que o sistema decidiu algo.",
          "Sem regras fortes, a velocidade da tecnologia pode ser maior do que a capacidade de corrigir danos."
        ],
        adult: [
          "Eficiência não resolve o problema de responsabilidade. Quando um sistema opaco nega crédito, emprego ou tratamento, a pessoa afetada pode não saber qual dado pesou nem como contestar a decisão.",
          "Automatizar tarefas aumenta produtividade, mas não garante distribuição. Se poucas empresas controlam modelos, dados e infraestrutura, o ganho pode concentrar renda enquanto trabalhadores absorvem a transição.",
          "Supervisão humana frequentemente vira assinatura automática quando há pressão de tempo e confiança excessiva na ferramenta. Colocar uma pessoa no circuito não basta se ela não tem autoridade, informação e tempo para discordar.",
          "Escala transforma pequenos vieses em danos sistemáticos. Um recrutador preconceituoso afeta candidatos; um modelo replicado por milhares de empresas pode fechar portas para grupos inteiros antes que o padrão seja percebido.",
          "Competição internacional não justifica aceitar riscos internos. Corridas tecnológicas incentivam justamente o corte de testes e salvaguardas. Regras comuns podem desacelerar o pior comportamento sem abandonar pesquisa útil."
        ],
        harvey: [
          "A promessa de eficiência costuma chegar antes da pergunta sobre recurso. Se ninguém consegue explicar por que o sistema negou uma oportunidade, a velocidade só torna a injustiça mais barata de repetir. Decisão sem contestação não é inteligência; é poder opaco.",
          "Produtividade é uma medida de produção, não de justiça. A empresa pode produzir mais com menos gente e chamar isso de progresso enquanto salários, segurança e poder de barganha encolhem. Sem mecanismo de distribuição, o benefício coletivo é apenas uma hipótese.",
          "“Há um humano supervisionando” tranquiliza até você olhar a rotina: centenas de decisões, poucos minutos e uma interface que apresenta a máquina como autoridade. O carimbo humano pode servir menos como controle e mais como escudo jurídico.",
          "A escala é vendida como vantagem quando o resultado é bom e tratada como detalhe quando o viés aparece. Mas é justamente ela que muda o risco: um erro deixa de ser episódio e vira infraestrutura. Corrigir depois significa encontrar todas as vidas já filtradas.",
          "A corrida global é o argumento favorito de quem quer que a urgência substitua a governança. Se cada ator reduz segurança porque teme o concorrente, todos chegam mais rápido ao mesmo risco. Coordenação difícil continua sendo melhor do que irresponsabilidade sincronizada."
        ]
      }
    },
    general: {
      against: {
        baby: [
          "Esse resultado pode acontecer, mas não é certo. Há outros fatores que também influenciam o problema.",
          "A proposta pode ajudar um grupo e criar um custo inesperado para outro.",
          "Um caso positivo não prova que a mesma solução funciona em toda situação.",
          "Talvez exista uma forma mais limitada de alcançar o benefício com menos risco.",
          "Ainda falta comparar a proposta com o que aconteceria sem ela."
        ],
        adult: [
          "A ligação entre a medida e o resultado ainda está rápida demais. Entre intenção e efeito existem comportamento, incentivos e condições que podem mudar completamente o desfecho.",
          "O benefício para um grupo não encerra a análise se o custo for deslocado para outro. O ponto decisivo é quem ganha, quem paga e se havia uma alternativa menos onerosa.",
          "Um exemplo mostra possibilidade, não frequência. Para sustentar uma regra geral, seria preciso explicar por que o caso representa o padrão e não uma exceção favorável.",
          "Há uma diferença importante entre reconhecer o problema e aceitar essa solução específica. Medidas mais estreitas podem atacar a causa sem assumir todos os riscos da proposta ampla.",
          "A comparação não pode ser com um mundo perfeito. É preciso colocar a proposta ao lado do cenário atual e das alternativas reais; só então sabemos se ela melhora o saldo."
        ],
        harvey: [
          "A conclusão parece inevitável porque todo o espaço entre causa e efeito foi apagado. Pessoas reagem, instituições se adaptam e incentivos mudam. Uma política não recebe crédito pelo que pretende fazer, mas pelo que continua funcionando depois dessas reações.",
          "O ganho está sob o holofote; o custo ficou fora do palco. Isso não o elimina. Até identificar quem absorve esse custo e por que essa pessoa deveria absorvê-lo, o benefício é apenas metade da conta.",
          "Um caso bem escolhido consegue provar quase qualquer coisa. O que importa é se o mecanismo se repete quando as condições deixam de ser convenientes. Sem essa ponte, a história ilustra; não demonstra.",
          "Você provou que existe um problema. Ainda não provou que sua solução ganhou o direito de ser a resposta. Uma intervenção mais precisa pode preservar o benefício e evitar o risco que sua proposta trata como inevitável.",
          "O adversário real da proposta não é a perfeição; é a melhor alternativa disponível. Se ela não vence essa comparação concreta, entusiasmo não fecha a diferença."
        ]
      },
      for: {
        baby: [
          "Apontar um risco não mostra que ficar parado seja melhor.",
          "O cenário atual também tem custos, mesmo que eles pareçam normais.",
          "Uma regra pode ser ajustada se surgirem problemas.",
          "Não precisamos de certeza absoluta para agir diante de um dano real.",
          "A alternativa precisa resolver o problema, não apenas criticar a proposta."
        ],
        adult: [
          "Risco por si só não decide a questão, porque manter o cenário atual também produz danos. A comparação correta é entre os custos das duas escolhas, não entre mudança imperfeita e estabilidade imaginária.",
          "Tratar o presente como neutro favorece quem já se beneficia dele. Se o problema é contínuo, adiar ação também é uma decisão com consequências identificáveis.",
          "A possibilidade de falha justifica salvaguardas, metas e revisão periódica. Ela não demonstra que a proposta deva ser abandonada antes de ser testada.",
          "Políticas públicas raramente chegam com certeza absoluta. O padrão razoável é evidência suficiente, risco proporcional e capacidade de correção — não garantia total.",
          "Criticar a proposta sem oferecer uma alternativa melhor deixa o dano original intacto. Cautela é útil quando melhora a ação; usada sozinha, vira apenas defesa do cenário atual."
        ],
        harvey: [
          "Toda a sua cautela é cobrada da mudança e nenhuma do presente. Mas o cenário atual não é uma sala vazia; ele já distribui custos, protege interesses e produz vítimas. Inação também precisa defender seu histórico.",
          "O risco que você aponta pode ser administrado. O dano atual, por outro lado, já está acontecendo. Exigir que a solução seja impecável enquanto o problema só precisa ser familiar é um padrão desigual.",
          "Salvaguardas não confessam fraqueza; mostram que a proposta consegue aprender. Uma política revisável é menos perigosa do que um status quo que fracassa sem nem ser tratado como escolha.",
          "Certeza absoluta é uma exigência que quase sempre aparece quando alguém prefere que nada mude. Decisões sérias trabalham com probabilidade, proporcionalidade e correção — o mesmo padrão usado em qualquer outro risco.",
          "Uma objeção vence apenas quando leva a uma escolha melhor. Se ela desmonta uma solução e devolve todos ao problema original, não resolveu o debate; apenas preservou o desconforto conhecido."
        ]
      }
    }
  },
  en: createGenericLocalizedBank("en"),
  zh: createGenericLocalizedBank("zh"),
  he: createGenericLocalizedBank("he")
};

function createGenericLocalizedBank(language) {
  const copy = {
    en: {
      against: [
        "That outcome is possible, but the causal link is doing too much work. Other forces may explain the same result.",
        "The visible benefit may come with a cost shifted to people who never chose it.",
        "One favorable example shows possibility, not how often the result survives ordinary conditions.",
        "A narrower measure could preserve the benefit without taking on every risk of the broader proposal.",
        "The real comparison is with practical alternatives, not with an idealized version of the plan."
      ],
      for: [
        "A possible risk does not make the status quo harmless. Doing nothing has consequences too.",
        "The current system is not neutral; it already distributes costs and advantages.",
        "A correctable flaw supports safeguards and review, not automatic rejection.",
        "Public decisions rarely offer certainty. Proportionate evidence and the ability to adjust are enough to act.",
        "An objection needs a better alternative, otherwise it simply returns everyone to the original problem."
      ]
    },
    zh: {
      against: ["这种结果可能发生，但因果关系并没有得到充分证明。", "明显的收益也可能把成本转移给没有选择的人。", "一个成功案例只能说明可能性，不能代表普遍结果。", "更有限的措施也许能保留收益，同时减少风险。", "真正的比较对象应是现实替代方案，而不是理想化计划。"],
      for: ["存在风险并不意味着现状没有伤害，不行动同样有后果。", "现有制度并不中立，它已经在分配成本和利益。", "可以修正的缺陷支持加强保障，而不是直接否定。", "公共决策很少拥有绝对确定性；足够证据和调整能力即可支持行动。", "反对意见还需要提出更好的替代方案，否则只是回到原来的问题。"]
    },
    he: {
      against: ["התוצאה אפשרית, אך הקשר הסיבתי עדיין אינו מוכח.", "התועלת הגלויה עלולה להעביר עלות למי שלא בחר בה.", "דוגמה מוצלחת מראה אפשרות, לא תוצאה כללית.", "צעד מצומצם יותר עשוי לשמור על התועלת ולהפחית סיכון.", "ההשוואה האמיתית היא לחלופות מעשיות, לא לגרסה אידיאלית של התוכנית."],
      for: ["סיכון אפשרי אינו הופך את המצב הקיים לחסר נזק; גם אי־פעולה עולה מחיר.", "המערכת הנוכחית אינה ניטרלית; היא כבר מחלקת עלויות ויתרונות.", "פגם שניתן לתקן מצדיק הגנות ובקרה, לא דחייה אוטומטית.", "החלטות ציבוריות כמעט לעולם אינן ודאיות לחלוטין; ראיות סבירות ויכולת תיקון מספיקות לפעולה.", "התנגדות זקוקה לחלופה טובה יותר, אחרת היא רק מחזירה אותנו לבעיה המקורית."]
    }
  }[language];
  const expand = (sentences) => ({
    baby: sentences.map((sentence) => sentence.split(/[.!?。！？]/)[0] + "."),
    adult: sentences,
    harvey: sentences
  });
  return {
    social_media: { against: expand(copy.against), for: expand(copy.for) },
    public_transport: { against: expand(copy.against), for: expand(copy.for) },
    artificial_intelligence: { against: expand(copy.against), for: expand(copy.for) },
    general: { against: expand(copy.against), for: expand(copy.for) }
  };
}

function isText(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicMessage = message;
  return error;
}

function formatHistory(history) {
  return history
    .map((item, index) => {
      const label = item.speaker === "user" ? "User" : "Opponent";
      return `${index + 1}. ${label}: ${String(item.text).slice(0, 2200)}`;
    })
    .join("\n\n");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(badRequest("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(badRequest("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(badRequest("Audio recording is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));

  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
      return json(res, 500, { error: "Unable to read file" });
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(content);
  });
}

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
