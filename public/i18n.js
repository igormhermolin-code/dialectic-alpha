(() => {
  const translations = {
    en: {
      viewHistory: "View debate history", signOut: "Sign out", recordBegins: "Your record begins here",
      buildReputation: "Build a reputation", oneArgument: "one argument at a time.",
      ratingFollows: "Your rating follows your performance. Strong reasoning earns ground; weak claims give it back.",
      startingRating: "Starting rating", equalFooting: "Every challenger begins on equal footing.",
      signIn: "Sign in", createAccount: "Create account", username: "Username", passphrase: "Passphrase",
      rememberMe: "Keep me signed in on this device", passwordNote: "Your account, password hash, ELO, and debate history are stored securely on the server.",
      ideasEnter: "Ideas enter. Arguments survive.", enterArena: "Enter the arena", withIdea: "with an idea.",
      intro: "Debate a relentless AI opponent. Every claim is judged on logic, evidence, clarity, and relevance—not volume.",
      motion: "The motion", yourPosition: "Your position", forMotion: "For the motion", against: "Against",
      format: "Format", aiFormat: "AI opponent", roundsLabel: "rounds", takePosition: "Take your position",
      logic: "Logic", evidence: "Evidence", clarity: "Clarity", relevance: "Relevance",
      logicHint: "Does it follow?", evidenceHint: "Can it stand?", clarityHint: "Can it be understood?", relevanceHint: "Does it answer?",
      backArena: "Back to arena", challengerRecord: "Challenger record", debateHistory: "debate history.",
      currentElo: "Current ELO", debates: "Debates", wins: "Wins", pastDebates: "Past debates",
      argumentsRecord: "Your arguments, on the record.", newDebate: "New debate", leaveDebate: "Leave debate",
      round: "ROUND", tonightsMotion: "Tonight's motion", challenger: "The Challenger", adversary: "The Adversary",
      aiAudioDisclosure: "Spoken audio is AI-generated.", openingStatement: "Your opening statement",
      openingHint: "Make a claim, show your reasoning, and give the judge something concrete to weigh.",
      yourArgument: "Your argument", submitHint: "⌘ + Enter to submit", useMicrophone: "Use microphone",
      submitArgument: "Submit argument", liveJudge: "Live judge", argumentScore: "Argument score",
      judgeNotes: "Judge's notes", feedbackAfter: "Your feedback will appear after the first exchange.", judgeRuled: "The judge has ruled", rating: "Rating",
      enterNewArena: "Enter a new arena", welcomeBack: "Welcome back", newChallenger: "New challenger",
      returnArena: "Return to the arena.", claimPlace: "Claim your place.", enterArenaButton: "Enter the arena",
      createAccountButton: "Create account", forSide: "For the motion", againstSide: "Against the motion",
      usernamePlaceholder: "your_name", passwordPlaceholder: "At least 8 characters", topicPlaceholder: "e.g. Social media has done more harm than good", argumentPlaceholder: "Build your case…",
      opponentLevel: "Opponent level", babyLevel: "Baby", babyHint: "Weak replies with useful openings", adultLevel: "Adult", adultHint: "Balanced competitive debate", harveyHint: "Sharp, strategic, unconventional",
      won: "Won", lost: "Lost", draw: "Draw", argued: "Argued", finished: "Finished",
      noDebates: "No debates on the record—yet.", firstVerdict: "Your first verdict will appear here with its score and rating change.",
      leadsYou: "You lead this exchange.", leadsAI: "The opponent leads this exchange.", level: "This exchange is level.",
      carried: "Argument carried.", challenged: "Argument challenged.", measuredDraw: "A measured draw.",
      nextStep: "Next step", noChange: "No change", listening: "Listening", aiVoiceOn: "AI voice on", aiVoiceOff: "AI voice off",
      ranking: "Ranking", globalStandings: "Arena standings", bestArguments: "The strongest arguments", riseTop: "rise to the top.",
      rankingIntro: "Every account is ranked by ELO. Debate more, reason better, and climb the table.", rankedChallengers: "Ranked challengers", rank: "Rank", joined: "Joined"
    },
    pt: {
      viewHistory: "Ver histórico de debates", signOut: "Sair", recordBegins: "Seu histórico começa aqui",
      buildReputation: "Construa uma reputação", oneArgument: "um argumento de cada vez.",
      ratingFollows: "Sua pontuação acompanha seu desempenho. Bons argumentos conquistam terreno; argumentos fracos o devolvem.",
      startingRating: "Pontuação inicial", equalFooting: "Todos os debatedores começam em igualdade.",
      signIn: "Entrar", createAccount: "Criar conta", username: "Usuário", passphrase: "Senha",
      rememberMe: "Manter minha sessão neste dispositivo", passwordNote: "Sua conta, hash da senha, ELO e histórico de debates ficam salvos com segurança no servidor.",
      ideasEnter: "Ideias entram. Argumentos sobrevivem.", enterArena: "Entre na arena", withIdea: "com uma ideia.",
      intro: "Debata contra uma IA incansável. Cada afirmação é avaliada por lógica, evidência, clareza e relevância — não pelo volume.",
      motion: "A moção", yourPosition: "Sua posição", forMotion: "A favor", against: "Contra",
      format: "Formato", aiFormat: "Oponente IA", roundsLabel: "rodadas", takePosition: "Assuma sua posição",
      logic: "Lógica", evidence: "Evidência", clarity: "Clareza", relevance: "Relevância",
      logicHint: "A conclusão segue?", evidenceHint: "Há sustentação?", clarityHint: "É compreensível?", relevanceHint: "Responde ao tema?",
      backArena: "Voltar à arena", challengerRecord: "Histórico do debatedor", debateHistory: "histórico de debates.",
      currentElo: "ELO atual", debates: "Debates", wins: "Vitórias", pastDebates: "Debates anteriores",
      argumentsRecord: "Seus argumentos, registrados.", newDebate: "Novo debate", leaveDebate: "Sair do debate",
      round: "RODADA", tonightsMotion: "Moção de hoje", challenger: "O Desafiante", adversary: "O Adversário",
      aiAudioDisclosure: "A voz reproduzida é gerada por IA.", openingStatement: "Sua declaração inicial",
      openingHint: "Faça uma afirmação, mostre seu raciocínio e ofereça algo concreto para o juiz avaliar.",
      yourArgument: "Seu argumento", submitHint: "⌘ + Enter para enviar", useMicrophone: "Usar microfone",
      submitArgument: "Enviar argumento", liveJudge: "Juiz ao vivo", argumentScore: "Nota do argumento",
      judgeNotes: "Notas do juiz", feedbackAfter: "Seu feedback aparecerá após a primeira troca.", judgeRuled: "O juiz decidiu", rating: "Pontuação",
      enterNewArena: "Entrar em uma nova arena", welcomeBack: "Bem-vindo de volta", newChallenger: "Novo desafiante",
      returnArena: "Volte à arena.", claimPlace: "Reivindique seu lugar.", enterArenaButton: "Entrar na arena",
      createAccountButton: "Criar conta", forSide: "A favor da moção", againstSide: "Contra a moção",
      usernamePlaceholder: "seu_nome", passwordPlaceholder: "Pelo menos 8 caracteres", topicPlaceholder: "ex.: As redes sociais causaram mais mal do que bem", argumentPlaceholder: "Construa seu argumento…",
      opponentLevel: "Nível do oponente", babyLevel: "Bebê", babyHint: "Respostas fracas com boas aberturas", adultLevel: "Adulto", adultHint: "Debate competitivo equilibrado", harveyHint: "Afiado, estratégico e fora do padrão",
      won: "Vitória", lost: "Derrota", draw: "Empate", argued: "Defendeu", finished: "Terminou em",
      noDebates: "Nenhum debate registrado — ainda.", firstVerdict: "Seu primeiro veredito aparecerá aqui com a nota e a mudança de ELO.",
      leadsYou: "Você lidera esta troca.", leadsAI: "O oponente lidera esta troca.", level: "Esta troca está equilibrada.",
      carried: "Argumento prevaleceu.", challenged: "Argumento contestado.", measuredDraw: "Um empate equilibrado.",
      nextStep: "Próximo passo", noChange: "Sem alteração", listening: "Ouvindo", aiVoiceOn: "Voz da IA ligada", aiVoiceOff: "Voz da IA desligada",
      ranking: "Ranking", globalStandings: "Classificação da arena", bestArguments: "Os melhores argumentos", riseTop: "chegam ao topo.",
      rankingIntro: "Todas as contas são classificadas pelo ELO. Debata mais, argumente melhor e suba na tabela.", rankedChallengers: "Debatedores classificados", rank: "Posição", joined: "Entrou em"
    },
    zh: {
      viewHistory: "查看辩论记录", signOut: "退出登录", recordBegins: "你的记录从这里开始",
      buildReputation: "建立你的声誉", oneArgument: "从每一次论证开始。",
      ratingFollows: "评分会随表现变化。严谨的推理赢得分数，薄弱的论点则会失分。",
      startingRating: "初始评分", equalFooting: "每位辩手都从同一起点开始。",
      signIn: "登录", createAccount: "创建账户", username: "用户名", passphrase: "密码",
      rememberMe: "在此设备上保持登录", passwordNote: "账户、密码哈希、ELO 和辩论记录会安全地保存在服务器上。",
      ideasEnter: "观点入场，论证生存。", enterArena: "进入辩论场", withIdea: "带着你的观点。",
      intro: "与不懈的 AI 对手辩论。每个主张都按逻辑、证据、清晰度和相关性评分，而不是音量。",
      motion: "辩题", yourPosition: "你的立场", forMotion: "支持", against: "反对",
      format: "赛制", aiFormat: "AI 对手", roundsLabel: "回合", takePosition: "选择立场",
      logic: "逻辑", evidence: "证据", clarity: "清晰度", relevance: "相关性",
      logicHint: "推理成立吗？", evidenceHint: "有依据吗？", clarityHint: "容易理解吗？", relevanceHint: "回应了辩题吗？",
      backArena: "返回辩论场", challengerRecord: "辩手档案", debateHistory: "辩论记录。",
      currentElo: "当前 ELO", debates: "辩论", wins: "胜场", pastDebates: "历史辩论",
      argumentsRecord: "你的论证，记录在案。", newDebate: "新辩论", leaveDebate: "离开辩论",
      round: "回合", tonightsMotion: "本场辩题", challenger: "挑战者", adversary: "对手",
      aiAudioDisclosure: "语音由 AI 生成。", openingStatement: "你的开篇陈词",
      openingHint: "提出主张，展示推理，并给裁判提供可衡量的具体内容。",
      yourArgument: "你的论点", submitHint: "⌘ + Enter 提交", useMicrophone: "使用麦克风",
      submitArgument: "提交论点", liveJudge: "实时裁判", argumentScore: "论点得分",
      judgeNotes: "裁判意见", feedbackAfter: "第一轮交锋后会显示反馈。", judgeRuled: "裁判已作出判决", rating: "等级分",
      enterNewArena: "开始新辩论", welcomeBack: "欢迎回来", newChallenger: "新挑战者",
      returnArena: "重返辩论场。", claimPlace: "占据你的位置。", enterArenaButton: "进入辩论场",
      createAccountButton: "创建账户", forSide: "支持辩题", againstSide: "反对辩题",
      usernamePlaceholder: "你的用户名", passwordPlaceholder: "至少 8 个字符", topicPlaceholder: "例如：社交媒体弊大于利", argumentPlaceholder: "构建你的论点…",
      opponentLevel: "对手级别", babyLevel: "婴儿", babyHint: "较弱的回应，留下反击空间", adultLevel: "成人", adultHint: "均衡的竞技辩论", harveyHint: "犀利、战略性、出人意料",
      won: "胜", lost: "负", draw: "平", argued: "立场", finished: "最终",
      noDebates: "还没有辩论记录。", firstVerdict: "你的首次裁决、得分和 ELO 变化会显示在这里。",
      leadsYou: "你在本轮领先。", leadsAI: "对手在本轮领先。", level: "本轮势均力敌。",
      carried: "论证获胜。", challenged: "论证受挫。", measuredDraw: "势均力敌。",
      nextStep: "下一步", noChange: "无变化", listening: "正在聆听", aiVoiceOn: "AI 语音开启", aiVoiceOff: "AI 语音关闭",
      ranking: "排名", globalStandings: "辩论场排名", bestArguments: "最有力的论证", riseTop: "登上榜首。",
      rankingIntro: "所有账户按 ELO 排名。多参与辩论、提升推理并攀升榜单。", rankedChallengers: "上榜辩手", rank: "名次", joined: "加入于"
    },
    he: {
      viewHistory: "הצגת היסטוריית דיונים", signOut: "התנתקות", recordBegins: "הרשומה שלך מתחילה כאן",
      buildReputation: "בנו מוניטין", oneArgument: "טיעון אחד בכל פעם.",
      ratingFollows: "הדירוג משתנה בהתאם לביצועים. היגיון חזק מרוויח נקודות; טיעונים חלשים מאבדים אותן.",
      startingRating: "דירוג התחלתי", equalFooting: "כל המתדיינים מתחילים באותה נקודה.",
      signIn: "כניסה", createAccount: "יצירת חשבון", username: "שם משתמש", passphrase: "סיסמה",
      rememberMe: "להשאיר אותי מחובר במכשיר זה", passwordNote: "החשבון, גיבוב הסיסמה, דירוג ה-ELO והיסטוריית הדיונים נשמרים באופן מאובטח בשרת.",
      ideasEnter: "רעיונות נכנסים. טיעונים שורדים.", enterArena: "היכנסו לזירה", withIdea: "עם רעיון.",
      intro: "התמודדו מול יריב AI נחוש. כל טענה נמדדת לפי היגיון, ראיות, בהירות ורלוונטיות — לא לפי עוצמת הקול.",
      motion: "נושא הדיון", yourPosition: "העמדה שלך", forMotion: "בעד", against: "נגד",
      format: "פורמט", aiFormat: "יריב AI", roundsLabel: "סבבים", takePosition: "בחירת עמדה",
      logic: "היגיון", evidence: "ראיות", clarity: "בהירות", relevance: "רלוונטיות",
      logicHint: "האם המסקנה נובעת?", evidenceHint: "האם יש בסיס?", clarityHint: "האם זה מובן?", relevanceHint: "האם זה עונה לנושא?",
      backArena: "חזרה לזירה", challengerRecord: "רשומת המתמודד", debateHistory: "היסטוריית דיונים.",
      currentElo: "ELO נוכחי", debates: "דיונים", wins: "ניצחונות", pastDebates: "דיונים קודמים",
      argumentsRecord: "הטיעונים שלך, מתועדים.", newDebate: "דיון חדש", leaveDebate: "יציאה מהדיון",
      round: "סבב", tonightsMotion: "נושא הדיון", challenger: "המתמודד", adversary: "היריב",
      aiAudioDisclosure: "הקול נוצר על ידי AI.", openingStatement: "הצהרת הפתיחה שלך",
      openingHint: "הציגו טענה, הראו את ההיגיון ותנו לשופט משהו ממשי לשקול.",
      yourArgument: "הטיעון שלך", submitHint: "⌘ + Enter לשליחה", useMicrophone: "שימוש במיקרופון",
      submitArgument: "שליחת טיעון", liveJudge: "שופט חי", argumentScore: "ציון הטיעון",
      judgeNotes: "הערות השופט", feedbackAfter: "המשוב יופיע לאחר חילופי הדברים הראשונים.", judgeRuled: "השופט הכריע", rating: "דירוג",
      enterNewArena: "כניסה לזירה חדשה", welcomeBack: "ברוכים השבים", newChallenger: "מתמודד חדש",
      returnArena: "חזרה לזירה.", claimPlace: "תפסו את מקומכם.", enterArenaButton: "כניסה לזירה",
      createAccountButton: "יצירת חשבון", forSide: "בעד הנושא", againstSide: "נגד הנושא",
      usernamePlaceholder: "שם_משתמש", passwordPlaceholder: "לפחות 8 תווים", topicPlaceholder: "לדוגמה: הרשתות החברתיות גרמו יותר נזק מתועלת", argumentPlaceholder: "בנו את הטיעון שלכם…",
      opponentLevel: "רמת היריב", babyLevel: "תינוק", babyHint: "תגובות חלשות עם פתחים לתשובה", adultLevel: "מבוגר", adultHint: "דיון תחרותי מאוזן", harveyHint: "חד, אסטרטגי ובלתי צפוי",
      won: "ניצחון", lost: "הפסד", draw: "תיקו", argued: "עמדה", finished: "דירוג סופי",
      noDebates: "עדיין אין דיונים ברשומה.", firstVerdict: "פסק הדין הראשון יופיע כאן עם הציון ושינוי ה-ELO.",
      leadsYou: "אתם מובילים בחילופי הדברים.", leadsAI: "היריב מוביל בחילופי הדברים.", level: "חילופי הדברים מאוזנים.",
      carried: "הטיעון ניצח.", challenged: "הטיעון אותגר.", measuredDraw: "תיקו מאוזן.",
      nextStep: "השלב הבא", noChange: "ללא שינוי", listening: "מקשיב", aiVoiceOn: "קול AI פעיל", aiVoiceOff: "קול AI כבוי",
      ranking: "דירוג", globalStandings: "טבלת הזירה", bestArguments: "הטיעונים החזקים ביותר", riseTop: "עולים לפסגה.",
      rankingIntro: "כל החשבונות מדורגים לפי ELO. התדיינו יותר, נתחו טוב יותר וטפסו בטבלה.", rankedChallengers: "מתמודדים מדורגים", rank: "מקום", joined: "הצטרף"
    }
  };

  const LOCALE_KEY = "dialectic.locale.v1";
  let locale = localStorage.getItem(LOCALE_KEY) || "en";

  function t(key) {
    return translations[locale]?.[key] || translations.en[key] || key;
  }

  function applyLanguage(nextLocale = locale) {
    locale = translations[nextLocale] ? nextLocale : "en";
    localStorage.setItem(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    const select = document.querySelector("#languageSelect");
    if (select) select.value = locale;
    const username = document.querySelector("#username");
    const password = document.querySelector("#password");
    const topic = document.querySelector("#topic");
    const argument = document.querySelector("#argument");
    if (username) username.placeholder = t("usernamePlaceholder");
    if (password) password.placeholder = t("passwordPlaceholder");
    if (topic) topic.placeholder = t("topicPlaceholder");
    if (argument) argument.placeholder = t("argumentPlaceholder");
    window.dispatchEvent(new CustomEvent("dialectic:language", { detail: { locale } }));
  }

  window.I18N = { t, applyLanguage, get locale() { return locale; } };
  document.addEventListener("DOMContentLoaded", () => applyLanguage(locale));
})();
