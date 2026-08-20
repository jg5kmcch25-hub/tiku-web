(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VIEWS = {
    splash: "splash-view",
    home: "home-view",
    shelf: "shelf-view",
    wrongbook: "wrongbook-view",
    quiz: "quiz-view",
    result: "result-view",
    cloze: "cloze-view",
    memorize: "memorize-view"
  };
  const STORAGE = { books: "quiz_books_v1", wrong: "quiz_wrongbook_v1" };

  let questions = [];
  let userAnswers = [];
  let current = 0;
  let answered = false;
  let lastSourceName = "";
  let pendingQuestions = [];
  let pendingName = "";
  let appendBookId = "";
  let lastBookId = "";
  let timerInterval = null;
  let sessionSeconds = 0;
  let pickBook = null;
  let pickOrder = "desc"; // desc = 最新优先，asc = 最早优先
  let pickSelected = new Set();

  /* ============ 示例题库 ============ */
  const SAMPLE = {
    questions: [
      {
        question: "中国的首都是哪座城市？",
        options: ["上海", "北京", "广州", "深圳"],
        answer: "B",
        explanation: "北京是中华人民共和国的首都，也是全国政治、文化、国际交往和科技创新中心。"
      },
      {
        question: "光在真空中的传播速度约为多少？",
        options: ["3×10⁶ km/s", "3×10⁵ km/s", "3×10⁸ km/s", "3×10⁷ km/s"],
        answer: "B",
        explanation: "真空中的光速约为 3×10⁸ m/s，也就是 3×10⁵ km/s。"
      },
      {
        question: "下列哪一项被称为中国的“国球”？",
        options: ["足球", "篮球", "乒乓球", "排球"],
        answer: "C",
        explanation: "乒乓球在中国普及度极高、成绩突出，被称为“国球”。"
      },
      {
        question: "《红楼梦》的作者是？",
        options: ["罗贯中", "施耐庵", "吴承恩", "曹雪芹"],
        answer: "D",
        explanation: "《红楼梦》是清代作家曹雪芹创作的章回体长篇小说，位列四大名著之一。"
      },
      {
        question: "太阳每天从哪个方向升起？",
        options: ["东边", "西边", "南边", "北边"],
        answer: "A",
        explanation: "地球自西向东自转，所以我们看到太阳每天从东方升起、西方落下。"
      },
      {
        question: "水的化学式是？",
        options: ["CO₂", "H₂O", "O₂", "NaCl"],
        answer: "B",
        explanation: "水由两个氢原子和一个氧原子构成，化学式为 H₂O。"
      }
    ]
  };

  /* ============ 本地存储 ============ */
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast("保存失败：浏览器本地存储不可用");
      return false;
    }
  }
  const loadBooks = () => loadJSON(STORAGE.books, []);
  const loadWrong = () => loadJSON(STORAGE.wrong, []);

  function addBook(name, qs) {
    const books = loadBooks();
    const book = {
      id: "b" + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      createdAt: Date.now(),
      questions: qs.map((q) => ({ ...q, options: q.options.slice(), addedAt: Date.now() }))
    };
    books.push(book);
    saveJSON(STORAGE.books, books);
    return book;
  }
  function deleteBook(id) {
    saveJSON(
      STORAGE.books,
      loadBooks().filter((b) => b.id !== id)
    );
  }
  function appendToBook(bookId, qs) {
    const books = loadBooks();
    const book = books.find((b) => b.id === bookId);
    if (!book) return null;
    const existing = new Set(
      book.questions.map((q) => q.question + "||" + q.options.join("|"))
    );
    const addedQuestions = [];
    let skipped = 0;
    qs.forEach((q) => {
      const key = q.question + "||" + q.options.join("|");
      if (existing.has(key)) {
        skipped++;
        return;
      }
      existing.add(key);
      const copy = { ...q, options: q.options.slice(), addedAt: Date.now() };
      book.questions.push(copy);
      addedQuestions.push(copy);
    });
    saveJSON(STORAGE.books, books);
    return { book, added: addedQuestions.length, skipped, addedQuestions };
  }
  function addWrongEntries(bookName, qs, answers) {
    const list = loadWrong();
    let added = 0;
    qs.forEach((q, i) => {
      if (answers[i] === q.answer) return;
      const key = q.question + "||" + q.options.join("|");
      if (list.some((w) => w.key === key)) return;
      list.unshift({
        id: "w" + Date.now() + Math.random().toString(36).slice(2, 6),
        key,
        bookName: bookName || "未知来源",
        question: q.question,
        options: q.options.slice(),
        answer: q.answer,
        explanation: q.explanation || "",
        wrongAnswer: answers[i],
        addedAt: Date.now()
      });
      added++;
    });
    if (added) saveJSON(STORAGE.wrong, list);
    return added;
  }
  function removeWrong(id) {
    saveJSON(
      STORAGE.wrong,
      loadWrong().filter((w) => w.id !== id)
    );
  }
  function clearWrong() {
    saveJSON(STORAGE.wrong, []);
  }

  /* ============ 学习计时与统计 ============ */
  function addStudyTime(bookId, ms) {
    if (!bookId || !ms || ms <= 0) return;
    const books = loadBooks();
    const book = books.find((b) => b.id === bookId);
    if (!book) return;
    book.studyTimeMs = (book.studyTimeMs || 0) + ms;
    saveJSON(STORAGE.books, books);
  }

  function startTimer() {
    stopTimer();
    sessionSeconds = 0;
    timerInterval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      sessionSeconds++;
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (sessionSeconds > 0) {
      addStudyTime(lastBookId, sessionSeconds * 1000);
      sessionSeconds = 0;
    }
  }

  function formatDuration(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return sec + " 秒";
    const min = Math.round(sec / 60);
    if (min < 60) return min + " 分钟";
    return Math.floor(min / 60) + " 小时 " + (min % 60) + " 分钟";
  }

  function collectWeekQuestions() {
    const books = loadBooks();
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    const out = [];
    books.forEach((b) => {
      const bookTime = b.createdAt || now;
      b.questions.forEach((q) => {
        const t = q.addedAt || bookTime;
        if (now - t <= week) out.push(q);
      });
    });
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function renderStudyChart() {
    const panel = $("study-panel");
    const books = loadBooks().filter((b) => (b.studyTimeMs || 0) > 0);
    if (!books.length) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const total = books.reduce((s, b) => s + (b.studyTimeMs || 0), 0);
    $("study-title").textContent = "学习时长 · 共 " + formatDuration(total);
    const theme = (document.body && document.body.dataset.theme) || "pink";
    const palette = THEME_PALETTES[theme] || THEME_PALETTES.pink;
    let acc = 0;
    const segs = books.map((b, i) => {
      const from = (acc / total) * 360;
      acc += b.studyTimeMs || 0;
      const to = (acc / total) * 360;
      const color = palette[i % palette.length];
      return { b, from, to, color };
    });
    $("study-pie").style.background =
      "conic-gradient(" +
      segs.map((s) => s.color + " " + s.from + "deg " + s.to + "deg").join(", ") +
      ")";
    const legend = $("study-legend");
    legend.innerHTML = "";
    segs.forEach((s) => {
      const li = document.createElement("li");
      li.className = "legend-item";
      li.innerHTML =
        '<i style="background:' + s.color + '"></i>' +
        '<span class="legend-name">' + escapeHTML(s.b.name) + "</span>" +
        '<span class="legend-time">' + formatDuration(s.b.studyTimeMs) + "</span>";
      legend.appendChild(li);
    });
  }

  /* ============ 轻提示 ============ */
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function updateCounts() {
    $("shelf-count").textContent = loadBooks().length + " 本书";
    $("wrong-count").textContent = loadWrong().length + " 题";
  }

  function formatDate(ts) {
    try {
      return new Date(ts).toLocaleDateString("zh-CN");
    } catch (e) {
      return "";
    }
  }

  function hashCode(s) {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) | 0;
    return h;
  }

  /* ============ 视图切换 ============ */
  function showView(name) {
    if (name !== "quiz") stopTimer();
    Object.keys(VIEWS).forEach((key) => {
      $(VIEWS[key]).classList.toggle("active", key === name);
    });
    window.scrollTo({ top: 0 });
    if (name === "home") renderStudyChart();
    if (name === "memorize") initMemorize();
    document.body.classList.toggle("in-memo", name === "memorize");
    document.body.classList.toggle("in-quiz", name === "quiz");
    $("btn-switch").textContent = name === "memorize" ? "" : "📚 背诵板块";
  }

  /* ============ 开屏导航 ============ */
  function countMemoLeaves() {
    let n = 0;
    (function walk(node) {
      if (node && Array.isArray(node.c) && node.c.length) node.c.forEach(walk);
      else n++;
    })(MEMO_TREE);
    return n;
  }

  function showSplash() {
    $("splash-shelf-count").textContent = loadBooks().length + " 本书";
    $("splash-cloze-count").textContent = clozeLoadBooks().length + " 本挖空";
    $("splash-memo-count").textContent = countMemoLeaves() + " 个知识点";
    showView("splash");
  }

  document.querySelectorAll(".splash-card").forEach((card) => {
    card.addEventListener("click", () => {
      const go = card.dataset.go;
      if (go === "shelf") {
        renderShelf();
        updateCounts();
        showView("shelf");
      } else if (go === "cloze") {
        enterCloze();
      } else if (go === "memo") {
        showView("memorize");
      }
    });
  });
  $("btn-splash-home").addEventListener("click", () => {
    updateCounts();
    showView("home");
  });
  $("btn-home-splash").addEventListener("click", showSplash);

  /* ============ 首页：文件导入 ============ */
  const dropZone = $("drop-zone");
  const fileInput = $("file-input");

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) readFile(fileInput.files[0]);
  });

  function readFile(file) {
    const name = file.name.toLowerCase();
    const type = name.endsWith(".json")
      ? "json"
      : name.endsWith(".csv")
      ? "csv"
      : name.endsWith(".txt")
      ? "txt"
      : "";
    if (!type) {
      showError("暂时只支持 JSON / CSV / TXT 格式的文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => startFromText(reader.result, type, file.name);
    reader.onerror = () => showError("读取文件失败，请重试");
    reader.readAsText(file);
  }

  function showError(msg) {
    const el = $("home-error");
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function clearError() {
    $("home-error").classList.add("hidden");
  }

  $("btn-sample").addEventListener("click", () => {
    const result = normalizeList(SAMPLE.questions);
    pendingQuestions = result.list;
    pendingName = "示例题库";
    openBookPanel();
  });

  $("btn-weekly").addEventListener("click", () => {
    openWeeklyPanel();
  });

  /* ============ 周测组卷：选书 + 随机抽题 ============ */
  const WEEKLY_LIMIT = 50;
  let weeklyBooks = [];
  let weeklyState = {}; // bookId -> { checked, limit }，记住上次的选书设置

  function openWeeklyPanel() {
    weeklyBooks = loadBooks().filter((b) => b.questions.length > 0);
    const list = $("weekly-books");
    list.innerHTML = "";
    if (!weeklyBooks.length) {
      list.innerHTML = '<p class="weekly-empty">书架上还没有书，先去导入一个题库吧</p>';
      $("weekly-summary").textContent = "";
      $("btn-weekly-start").disabled = true;
      $("weekly-panel").classList.remove("hidden");
      return;
    }
    const toolbar = document.createElement("div");
    toolbar.className = "weekly-toolbar";
    toolbar.innerHTML =
      '<button type="button" class="weekly-btn" id="weekly-all">全选</button>' +
      '<button type="button" class="weekly-btn" id="weekly-none">全不选</button>';
    list.appendChild(toolbar);
    weeklyBooks.forEach((b) => {
      const cap = Math.min(b.questions.length, WEEKLY_LIMIT);
      const saved = weeklyState[b.id] || {};
      const checked = saved.checked !== undefined ? saved.checked : true;
      const limitVal = saved.limit || cap;
      const row = document.createElement("div");
      row.className = "weekly-book";
      row.innerHTML =
        '<label class="weekly-book-main">' +
        '<input type="checkbox" class="weekly-check" value="' + b.id + '"' +
        (checked ? " checked" : "") + " />" +
        '<span class="weekly-book-name">' + escapeHTML(b.name) + "</span>" +
        '<span class="weekly-book-count">' + b.questions.length + " 题</span>" +
        "</label>" +
        '<label class="weekly-cap-group">' +
        "<span>限抽</span>" +
        '<input type="number" class="weekly-limit" min="1" max="' + cap + '" value="' + limitVal + '" />' +
        "<span>题</span>" +
        "</label>";
      row.querySelector(".weekly-check").addEventListener("change", updateWeeklySummary);
      const lim = row.querySelector(".weekly-limit");
      lim.addEventListener("input", updateWeeklySummary);
      lim.addEventListener("change", () => {
        let v = parseInt(lim.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > cap) v = cap;
        lim.value = v;
        updateWeeklySummary();
      });
      list.appendChild(row);
    });
    $("weekly-all").addEventListener("click", () => {
      list.querySelectorAll(".weekly-check").forEach((cb) => {
        cb.checked = true;
      });
      updateWeeklySummary();
    });
    $("weekly-none").addEventListener("click", () => {
      list.querySelectorAll(".weekly-check").forEach((cb) => {
        cb.checked = false;
      });
      updateWeeklySummary();
    });
    updateWeeklySummary();
    $("weekly-panel").classList.remove("hidden");
  }

  function updateWeeklySummary() {
    const checks = Array.from(document.querySelectorAll(".weekly-check"));
    const checked = checks.filter((cb) => cb.checked);
    let total = 0;
    let capped = 0;
    checked.forEach((cb) => {
      const b = weeklyBooks.find((x) => x.id === cb.value);
      if (!b) return;
      total += b.questions.length;
      const row = cb.closest(".weekly-book");
      const input = row && row.querySelector(".weekly-limit");
      const raw = input ? parseInt(input.value, 10) : NaN;
      const limit = Number.isFinite(raw) && raw > 0 ? raw : b.questions.length;
      capped += Math.min(b.questions.length, limit);
    });
    const pick = Math.min(capped, WEEKLY_LIMIT);
    $("weekly-summary").textContent =
      "已选 " + checked.length + " 本书 · 共 " + total + " 题 · 限抽后最多 " + capped +
      " 题 · 本次随机抽 " + pick + " 题（总上限 " + WEEKLY_LIMIT + " 题）";
    $("btn-weekly-start").disabled = checked.length === 0 || pick === 0;

    // 记住这次的选择，下次打开面板时还原
    weeklyBooks.forEach((b) => {
      const cb = document.querySelector('.weekly-check[value="' + b.id + '"]');
      if (!cb) return;
      const row = cb.closest(".weekly-book");
      const input = row && row.querySelector(".weekly-limit");
      const raw = input ? parseInt(input.value, 10) : NaN;
      const limit =
        Number.isFinite(raw) && raw > 0
          ? raw
          : Math.min(b.questions.length, WEEKLY_LIMIT);
      weeklyState[b.id] = { checked: cb.checked, limit };
    });
  }

  function startWeeklyQuiz() {
    const pool = [];
    weeklyBooks.forEach((b) => {
      const cb = document.querySelector('.weekly-check[value="' + b.id + '"]');
      if (!cb || !cb.checked) return;
      const row = cb.closest(".weekly-book");
      const input = row && row.querySelector(".weekly-limit");
      const raw = input ? parseInt(input.value, 10) : NaN;
      const limit = Math.min(
        b.questions.length,
        Number.isFinite(raw) && raw > 0 ? raw : b.questions.length
      );
      const qs = b.questions.slice();
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = qs[i];
        qs[i] = qs[j];
        qs[j] = tmp;
      }
      pool.push.apply(pool, qs.slice(0, limit));
    });
    if (!pool.length) {
      toast("请先勾选至少一本书");
      return;
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const picked = pool.slice(0, WEEKLY_LIMIT);
    $("weekly-panel").classList.add("hidden");
    startQuiz(picked, "周测组卷", "");
  }

  $("btn-weekly-start").addEventListener("click", startWeeklyQuiz);
  $("btn-weekly-cancel").addEventListener("click", () => {
    $("weekly-panel").classList.add("hidden");
  });

  $("btn-paste").addEventListener("click", () => {
    $("paste-panel").classList.toggle("hidden");
  });
  $("btn-paste-start").addEventListener("click", () => {
    const text = $("paste-area").value.trim();
    if (!text) {
      showError("请先粘贴题目文本");
      return;
    }
    startFromText(text, "txt");
  });

  function startFromText(text, type, fileName) {
    clearError();
    let result;
    try {
      if (type === "json") result = parseJSON(text);
      else if (type === "csv") result = parseCSV(text);
      else result = parseTXT(text);
    } catch (err) {
      showError(err.message || "解析失败，请检查文件格式");
      return;
    }
    if (!result.list.length) {
      showError("没有解析出有效题目，请检查每道题是否包含题干、选项和答案");
      return;
    }
    pendingQuestions = result.list;
    pendingName = (fileName || "新题库").replace(/\.(json|csv|txt)$/i, "");
    openBookPanel();
  }

  function renderBookTargets() {
    const sel = $("book-target");
    sel.innerHTML = "";
    const optNew = document.createElement("option");
    optNew.value = "new";
    optNew.textContent = "➕ 新建一本书";
    sel.appendChild(optNew);
    loadBooks().forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = "📖 " + b.name + "（已有 " + b.questions.length + " 题）";
      sel.appendChild(opt);
    });
    const valid = loadBooks().some((b) => b.id === appendBookId);
    sel.value = appendBookId && valid ? appendBookId : "new";
    updateNameInput();
  }

  function updateNameInput() {
    $("book-name-input").style.display =
      $("book-target").value === "new" ? "" : "none";
  }

  function openBookPanel() {
    renderBookTargets();
    const input = $("book-name-input");
    input.value = pendingName;
    $("book-name-panel").classList.remove("hidden");
    if ($("book-target").value === "new") {
      input.focus();
      input.select();
    }
  }
  function closeBookPanel() {
    $("book-name-panel").classList.add("hidden");
  }
  $("book-target").addEventListener("change", updateNameInput);

  $("btn-book-save").addEventListener("click", () => {
    const target = $("book-target").value;
    let book;
    let batch;
    if (target === "new") {
      const name = $("book-name-input").value.trim() || "未命名题库";
      book = addBook(name, pendingQuestions);
      batch = pendingQuestions;
    } else {
      const res = appendToBook(target, pendingQuestions);
      if (!res) {
        toast("没有找到这本书，请重试");
        return;
      }
      book = res.book;
      batch = res.addedQuestions;
      if (res.added === 0) {
        appendBookId = "";
        closeBookPanel();
        toast("《" + book.name + "》里已经有这批题了");
        return;
      }
      if (res.skipped > 0) {
        toast("已追加 " + res.added + " 题，跳过 " + res.skipped + " 题重复");
      } else {
        toast("已追加 " + res.added + " 题到《" + book.name + "》");
      }
    }
    appendBookId = "";
    closeBookPanel();
    startQuiz(batch, book.name, book.id);
  });
  $("btn-book-quick").addEventListener("click", () => {
    appendBookId = "";
    closeBookPanel();
    startQuiz(pendingQuestions, pendingName || "临时题库", "");
  });
  $("btn-book-cancel").addEventListener("click", () => {
    appendBookId = "";
    closeBookPanel();
  });

  function startQuiz(rawList, sourceName, bookId) {
    lastSourceName = sourceName || lastSourceName;
    lastBookId = bookId || "";
    const shuffleOn = $("shuffle-options").checked;
    questions = rawList.map((q) => ({ ...q, options: q.options.slice() }));
    if (shuffleOn) {
      questions.forEach((q) => {
        const idx = [0, 1, 2, 3].filter((i) => i < q.options.length);
        for (let i = idx.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [idx[i], idx[j]] = [idx[j], idx[i]];
        }
        const oldOptions = q.options.map((o) => o);
        const oldAnswer = q.answer;
        q.options = idx.map((i) => oldOptions[i]);
        q.answer = idx.indexOf(oldAnswer);
      });
    }
    userAnswers = new Array(questions.length).fill(-1);
    current = 0;
    answered = false;
    $("quiz-source").textContent = lastSourceName
      ? "来源：" + lastSourceName
      : "";
    renderQuestion();
    showView("quiz");
    startTimer();
  }

  /* ============ 书架 ============ */
  $("btn-goto-shelf").addEventListener("click", () => {
    renderShelf();
    updateCounts();
    showView("shelf");
  });
  $("btn-shelf-home").addEventListener("click", () => {
    updateCounts();
    showSplash();
  });
  $("btn-shelf-import").addEventListener("click", () => {
    showView("home");
  });
  $("btn-shelf-newbook").addEventListener("click", () => {
    const name = prompt("新书的名字：", "");
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast("书名为空，未创建");
      return;
    }
    const books = loadBooks();
    if (books.some((b) => b.name === trimmed)) {
      toast("已经有一本叫《" + trimmed + "》的书了");
      return;
    }
    books.push({
      id: "b" + Date.now() + Math.random().toString(36).slice(2, 6),
      name: trimmed,
      createdAt: Date.now(),
      questions: []
    });
    saveJSON(STORAGE.books, books);
    renderShelf();
    updateCounts();
    toast("已创建空白书《" + trimmed + "》");
  });
  $("shelf-empty-link").addEventListener("click", (e) => {
    e.preventDefault();
    showView("home");
  });

  function renderShelf() {
    const books = loadBooks();
    const list = $("shelf-list");
    list.innerHTML = "";
    $("shelf-empty").classList.toggle("hidden", books.length > 0);
    books.forEach((b) => {
      const card = document.createElement("div");
      card.className = "book-card";
      card.innerHTML =
        '<div class="book-cover"></div>' +
        '<div class="book-info">' +
        '<strong class="book-name">' + escapeHTML(b.name) + "</strong>" +
        '<span class="book-meta">' + b.questions.length + " 题</span>" +
        "</div>" +
        '<div class="book-actions">' +
        '<button class="btn btn-primary btn-small" data-act="start" type="button">开始答题</button>' +
        '<button class="btn btn-ghost btn-small" data-act="pick" type="button">选题答题</button>' +
        '<button class="btn btn-ghost btn-small" data-act="append" type="button">追加题目</button>' +
        '<button class="btn btn-ghost btn-small" data-act="del" type="button">删除</button>' +
        "</div>";
      const cover = card.querySelector(".book-cover");
      const hue = Math.abs(hashCode(b.name)) % 360;
      cover.textContent = (b.name.trim().charAt(0) || "书").toUpperCase();
      cover.style.background =
        "linear-gradient(135deg, hsl(" + hue + ", 78%, 80%), hsl(" +
        ((hue + 34) % 360) + ", 72%, 62%))";
      card.querySelector('[data-act="start"]').addEventListener("click", () => {
        if (!b.questions.length) {
          toast("《" + b.name + "》还没有题目，先追加题目或迁入题目吧");
          return;
        }
        startQuiz(b.questions, b.name, b.id);
      });
      card.querySelector('[data-act="append"]').addEventListener("click", () => {
        appendBookId = b.id;
        renderBookTargets();
        showView("home");
        toast("已选择《" + b.name + "》：导入的新题会自动追加进去");
      });
      card.querySelector('[data-act="pick"]').addEventListener("click", () => {
        openPickPanel(b);
      });
      card.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm("确定删除《" + b.name + "》吗？删除后题库内容不会丢失，仍可重新导入。")) {
          deleteBook(b.id);
          renderShelf();
          updateCounts();
          toast("已删除");
        }
      });
      list.appendChild(card);
    });
  }

  /* ---------- 书架：按日期选题答题 ---------- */
  function openPickPanel(book) {
    if (!book.questions || !book.questions.length) {
      toast("这本书里还没有题目");
      return;
    }
    pickBook = book;
    pickOrder = "desc";
    pickSelected = new Set();
    $("pick-book-name").textContent = "《" + book.name + "》· 选题答题";
    $("shelf-list").classList.add("hidden");
    $("shelf-empty").classList.add("hidden");
    $("shelf-pick-panel").classList.remove("hidden");
    renderPickPanel();
  }

  function closePickPanel() {
    pickBook = null;
    pickSelected = new Set();
    $("shelf-pick-panel").classList.add("hidden");
    $("shelf-list").classList.remove("hidden");
    renderShelf();
    updateCounts();
  }

  function pickSortedQuestions() {
    const bookTime = pickBook.createdAt || Date.now();
    return pickBook.questions.slice().sort((a, b) => {
      const ta = a.addedAt || bookTime;
      const tb = b.addedAt || bookTime;
      return pickOrder === "desc" ? tb - ta : ta - tb;
    });
  }

  function formatPickDate(ts) {
    try {
      return new Date(ts).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return "";
    }
  }

  function updatePickCount() {
    const n = pickSelected.size;
    $("pick-count").textContent = "已选 " + n + " 题";
    const btn = $("btn-pick-start");
    btn.disabled = n === 0;
    btn.textContent = "开始答题（" + n + " 题）";
    $("btn-pick-move").disabled = n === 0;
    $("btn-pick-delete").disabled = n === 0;
  }

  function renderPickTargets() {
    const sel = $("pick-move-target");
    const current = sel.value;
    sel.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "选择书目…";
    sel.appendChild(opt);
    loadBooks().forEach((b) => {
      if (b.id === pickBook.id) return;
      const o = document.createElement("option");
      o.value = b.id;
      o.textContent = b.name + "（" + b.questions.length + " 题）";
      sel.appendChild(o);
    });
    if (current && Array.from(sel.options).some((o) => o.value === current)) {
      sel.value = current;
    }
  }

  function persistPickBook() {
    const books = loadBooks();
    const book = books.find((b) => b.id === pickBook.id);
    if (!book) return;
    book.questions = pickBook.questions;
    saveJSON(STORAGE.books, books);
  }

  function deleteSelectedQuestions() {
    if (!pickSelected.size) {
      toast("请先勾选要删除的题目");
      return;
    }
    const n = pickSelected.size;
    if (!confirm("确定删除选中的 " + n + " 道题吗？删除后无法恢复。")) return;
    pickBook.questions = pickBook.questions.filter((q) => !pickSelected.has(q));
    persistPickBook();
    pickSelected.clear();
    renderPickPanel();
    updateCounts();
    toast("已删除 " + n + " 道题");
  }

  function moveSelectedQuestions() {
    const targetId = $("pick-move-target").value;
    if (!targetId) {
      toast("请先选择要迁入的书");
      return;
    }
    if (targetId === pickBook.id) {
      toast("不能迁移到当前这本书");
      return;
    }
    if (!pickSelected.size) {
      toast("请先勾选要迁移的题目");
      return;
    }
    const books = loadBooks();
    const src = books.find((b) => b.id === pickBook.id);
    const dst = books.find((b) => b.id === targetId);
    if (!src || !dst) {
      toast("没有找到这本书，请重试");
      return;
    }
    const selectedCount = pickSelected.size;
    if (!confirm("确定把选中的 " + selectedCount + " 道题迁移到《" + dst.name + "》吗？")) {
      return;
    }
    const existing = new Set(
      dst.questions.map((q) => q.question + "||" + q.options.join("|"))
    );
    const moved = [];
    const remaining = [];
    pickBook.questions.forEach((q) => {
      if (!pickSelected.has(q)) {
        remaining.push(q);
        return;
      }
      const key = q.question + "||" + q.options.join("|");
      if (existing.has(key)) {
        remaining.push(q);
        return;
      }
      existing.add(key);
      moved.push(q);
    });
    pickBook.questions = remaining;
    src.questions = remaining;
    dst.questions = dst.questions.concat(moved);
    saveJSON(STORAGE.books, books);
    pickSelected.clear();
    renderPickPanel();
    updateCounts();
    if (moved.length) {
      toast(
        "已迁移 " + moved.length + " 道题到《" + dst.name + "》" +
        (moved.length < selectedCount ? "，跳过 " + (selectedCount - moved.length) + " 道重复题" : "")
      );
    } else {
      toast("选中的题在《" + dst.name + "》里已经有了，未迁移");
    }
  }

  function renderPickPanel() {
    const list = $("pick-list");
    const qs = pickSortedQuestions();
    list.innerHTML = "";
    qs.forEach((q) => {
      const row = document.createElement("div");
      row.className = "pick-row" + (pickSelected.has(q) ? " checked" : "");
      row.innerHTML =
        '<input type="checkbox" class="pick-check"' +
        (pickSelected.has(q) ? " checked" : "") + " />" +
        '<span class="pick-q">' + escapeHTML(q.question) + "</span>" +
        '<span class="pick-date">' + formatPickDate(q.addedAt || pickBook.createdAt) + "</span>";
      const cb = row.querySelector(".pick-check");
      const toggle = () => {
        const isOn = cb.checked;
        if (isOn) pickSelected.add(q);
        else pickSelected.delete(q);
        row.classList.toggle("checked", isOn);
        updatePickCount();
      };
      row.addEventListener("click", (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        toggle();
      });
      cb.addEventListener("change", toggle);
      list.appendChild(row);
    });
    $("btn-pick-sort").textContent =
      pickOrder === "desc" ? "按日期 · 最新优先" : "按日期 · 最早优先";
    renderPickTargets();
    updatePickCount();
  }

  $("btn-pick-all").addEventListener("click", () => {
    pickSortedQuestions().forEach((q) => pickSelected.add(q));
    renderPickPanel();
  });
  $("btn-pick-none").addEventListener("click", () => {
    pickSelected.clear();
    renderPickPanel();
  });
  $("btn-pick-sort").addEventListener("click", () => {
    pickOrder = pickOrder === "desc" ? "asc" : "desc";
    renderPickPanel();
  });
  $("btn-pick-delete").addEventListener("click", deleteSelectedQuestions);
  $("btn-pick-move").addEventListener("click", moveSelectedQuestions);
  $("btn-pick-cancel").addEventListener("click", closePickPanel);
  $("btn-pick-start").addEventListener("click", () => {
    if (!pickBook || pickSelected.size === 0) {
      toast("请先至少选择一道题");
      return;
    }
    const picked = pickSortedQuestions().filter((q) => pickSelected.has(q));
    const book = pickBook;
    closePickPanel();
    startQuiz(picked, book.name + " · 自选题", book.id);
  });

  /* ============ 错题本 ============ */
  $("btn-goto-wrong").addEventListener("click", () => {
    renderWrongBook();
    updateCounts();
    showView("wrongbook");
  });
  $("btn-wrong-home").addEventListener("click", () => {
    updateCounts();
    showSplash();
  });
  $("btn-goto-wrongbook").addEventListener("click", () => {
    renderWrongBook();
    updateCounts();
    showView("wrongbook");
  });
  $("btn-wrong-clear").addEventListener("click", () => {
    if (!loadWrong().length) return;
    if (confirm("确定清空所有错题吗？")) {
      clearWrong();
      renderWrongBook();
      updateCounts();
      toast("错题本已清空");
    }
  });
  $("btn-wrong-start").addEventListener("click", () => {
    const list = loadWrong();
    if (!list.length) {
      toast("错题本是空的");
      return;
    }
    const raw = list.map((w) => ({
      question: w.question,
      options: w.options.slice(),
      answer: w.answer,
      explanation: w.explanation
    }));
    startQuiz(raw, "错题本", "");
  });

  function renderWrongBook() {
    const list = loadWrong();
    const wrap = $("wrongbook-list");
    wrap.innerHTML = "";
    $("wrongbook-empty").classList.toggle("hidden", list.length > 0);
    $("btn-wrong-start").disabled = list.length === 0;
    list.forEach((w) => {
      const item = document.createElement("div");
      item.className = "wrong-item";
      item.innerHTML =
        '<div class="entry-meta">📒 ' + escapeHTML(w.bookName || "未知来源") +
        (w.addedAt ? " · " + formatDate(w.addedAt) : "") + "</div>" +
        '<div class="q-text">' + escapeHTML(w.question) + "</div>" +
        '<div class="ans-row">你的答案：<b class="no">' +
        escapeHTML(optionLabel(w, w.wrongAnswer)) + "</b></div>" +
        '<div class="ans-row">正确答案：<b class="ok">' +
        escapeHTML(optionLabel(w, w.answer)) + "</b></div>" +
        (w.explanation
          ? '<div class="ans-explain">' + escapeHTML(w.explanation) + "</div>"
          : "") +
        '<div class="entry-actions">' +
        '<button class="btn btn-ghost btn-small" data-act="remove" type="button">移出</button>' +
        "</div>";
      item.querySelector('[data-act="remove"]').addEventListener("click", () => {
        removeWrong(w.id);
        renderWrongBook();
        updateCounts();
        toast("已移出错题本");
      });
      wrap.appendChild(item);
    });
  }

  /* ============ 备份与恢复 ============ */
  function buildBackupData() {
    return {
      app: "quiz-app",
      version: 1,
      exportedAt: new Date().toISOString(),
      books: loadBooks(),
      wrongbook: loadWrong(),
      memorize: memoLoadStore(),
      cloze: clozeLoadBooks()
    };
  }

  function sanitizeBackup(data) {
    if (
      !data ||
      data.app !== "quiz-app" ||
      !Array.isArray(data.books) ||
      !Array.isArray(data.wrongbook)
    ) {
      return null;
    }
    const books = [];
    data.books.forEach((b, bi) => {
      if (!b || typeof b.name !== "string") return;
      const norm = normalizeList(b.questions || []);
      books.push({
        id: b.id || "b" + Date.now() + bi,
        name: b.name,
        createdAt: b.createdAt || Date.now(),
        questions: norm.list
      });
    });
    const wrongbook = [];
    data.wrongbook.forEach((w) => {
      if (!w) return;
      const q = normalizeQuestion(w);
      if (
        !q ||
        !Number.isInteger(w.wrongAnswer) ||
        w.wrongAnswer < 0 ||
        w.wrongAnswer >= q.options.length
      ) {
        return;
      }
      wrongbook.push({
        id: w.id || "w" + Date.now() + Math.random().toString(36).slice(2, 6),
        key: q.question + "||" + q.options.join("|"),
        bookName: w.bookName || "未知来源",
        question: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation || "",
        wrongAnswer: w.wrongAnswer,
        addedAt: w.addedAt || Date.now()
      });
    });
    const memorize = { books: [] };
    const memoRaw = data.memorize;
    if (memoRaw && Array.isArray(memoRaw.books)) {
      memoRaw.books.forEach((b) => {
        if (!b || typeof b.name !== "string") return;
        memorize.books.push({
          id: b.id || "memo" + Date.now(),
          name: b.name,
          tree: b.tree || null,
          cards: b.cards && typeof b.cards === "object" ? b.cards : {}
        });
      });
    }
    const cloze = [];
    const clozeRaw = data.cloze;
    if (Array.isArray(clozeRaw)) {
      clozeRaw.forEach((b, bi) => {
        if (!b || typeof b.name !== "string") return;
        const items = [];
        (b.items || []).forEach((it) => {
          if (
            !it ||
            !Array.isArray(it.parts) ||
            !Array.isArray(it.answers) ||
            it.parts.length !== it.answers.length + 1
          ) {
            return;
          }
          items.push({
            id: it.id || "cz" + Date.now() + Math.random().toString(36).slice(2, 6),
            parts: it.parts.map(String),
            answers: it.answers.map(String),
            addedAt: it.addedAt || Date.now()
          });
        });
        cloze.push({
          id: b.id || "cz" + Date.now() + bi,
          name: b.name,
          createdAt: b.createdAt || Date.now(),
          items
        });
      });
    }
    return { books, wrongbook, memorize, cloze };
  }

  function downloadBackup() {
    const data = buildBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "题库答题备份_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast("备份已下载 💾");
  }

  function restoreBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        toast("恢复失败：文件不是有效的备份");
        return;
      }
      const clean = sanitizeBackup(data);
      if (!clean) {
        toast("恢复失败：文件不是有效的备份");
        return;
      }
      saveJSON(STORAGE.books, clean.books);
      saveJSON(STORAGE.wrong, clean.wrongbook);
      saveJSON(MEMO_STORE_KEY, clean.memorize || { books: [] });
      clozeSaveBooks(clean.cloze || []);
      memoStore = null;
      memoRendered = false;
      updateCounts();
      toast(
        "恢复成功：" + clean.books.length + " 本书 · " +
        clean.wrongbook.length + " 道错题 · 背诵 " +
        (clean.memorize ? clean.memorize.books.length : 0) + " 本 · 挖空 " +
        clean.cloze.length + " 本"
      );
    };
    reader.onerror = () => toast("读取备份文件失败");
    reader.readAsText(file);
  }

  $("btn-backup").addEventListener("click", downloadBackup);
  $("btn-restore").addEventListener("click", () => $("restore-file-input").click());
  $("restore-file-input").addEventListener("change", () => {
    const file = $("restore-file-input").files[0];
    if (file) restoreBackup(file);
    $("restore-file-input").value = "";
  });

  /* ============ 知识点挖空 ============ */
  const CLOZE_STORE_KEY = "quiz_cloze_v1";
  const clozeLoadBooks = () => loadJSON(CLOZE_STORE_KEY, []);
  const clozeSaveBooks = (books) => saveJSON(CLOZE_STORE_KEY, books);

  let clozePreviewItems = [];
  let clozePreviewSelected = new Set();
  let clozeAppendTarget = "";
  let clozePracticeItems = [];
  let clozePracticeInputs = [];
  let clozePracticeCurrent = 0;
  let clozePracticeSource = "";
  let clozePracticeBookId = "";
  let clozePracticeWrong = [];

  function updateClozeCount() {
    $("cloze-shelf-count").textContent = clozeLoadBooks().length;
  }

  function clozeError(msg) {
    const el = $("cloze-error");
    el.textContent = msg;
    el.classList.remove("hidden");
  }
  function clozeClearError() {
    $("cloze-error").classList.add("hidden");
  }

  function enterCloze() {
    clozeClearError();
    updateClozeCount();
    showView("cloze");
    switchClozeTab("import");
  }

  function switchClozeTab(name) {
    document.querySelectorAll(".cloze-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.clozeTab === name);
    });
    $("cloze-tabs").classList.remove("hidden");
    clozeShowPanel(name);
    if (name === "shelf") renderClozeShelf();
  }

  function clozeShowPanel(name) {
    $("cloze-import-panel").classList.toggle("hidden", name !== "import");
    $("cloze-preview-panel").classList.add("hidden");
    $("cloze-shelf-panel").classList.toggle("hidden", name !== "shelf");
    $("cloze-practice-panel").classList.toggle("hidden", name !== "practice");
  }

  /* ---------- 自动挖空 ---------- */
  const CLOZE_SUFFIXES = [
    "代表作品",
    "主义", "运动", "风格", "流派", "学派", "思想", "体系", "理论",
    "设计", "艺术", "工艺", "文化", "建筑", "原则", "观念", "特征",
    "精神", "技法", "方法", "主张"
  ];
  const CLOZE_BOUND = new Set(
    "的了是在把将由从与和及或其对向以于而为等很更也这那被将之因但若如虽同"
  );
  const CLOZE_STOP2 = [
    "发起", "强调", "体现", "提出", "认为", "主张", "包括", "形成",
    "发展", "推动", "促进", "代表", "成为", "出现", "兴起", "采用",
    "坚持", "追求", "注重", "突出", "讲究", "融合", "结合", "吸收",
    "借鉴", "影响", "反对", "开始", "结束", "为了", "通过", "由于",
    "随着", "作为", "比如", "因为"
  ];

  function clozeTermCandidates(sentence, mode) {
    const out = [];
    const add = (start, end, term) => {
      const t = String(term || "").trim();
      if (end > start && start >= 0 && end <= sentence.length && t) {
        out.push({ start, end, term: t });
      }
    };
    let m;
    const scan = (re, pick) => {
      re.lastIndex = 0;
      while ((m = re.exec(sentence))) {
        const term = pick ? pick(m) : m[0];
        const idx = m[0].indexOf(term);
        add(m.index + idx, m.index + idx + term.length, term);
      }
    };
    // 时间
    scan(/\d{1,4}\s*世纪/g);
    scan(/\d{3,4}\s*年/g);
    scan(/\d+\s*年代/g);
    scan(/公元前?\s*\d+\s*年?/g);
    scan(/\d+\s*年\s*\d+\s*月/g);
    // 作品名
    scan(/《[^》]{1,24}》/g);
    // 引号里的概念（保留引号，只挖内容）
    scan(/[“"]([^”"]{2,14})[”"]/g, (mm) => mm[1]);
    // 概念术语：从关键词往前最多找 10 个汉字，遇到虚字/双字动词就停
    for (let i = 0; i < sentence.length; i++) {
      for (const suf of CLOZE_SUFFIXES) {
        if (!sentence.startsWith(suf, i)) continue;
        let start = i;
        let n = 0;
        while (start > 0 && n < 10) {
          const ch = sentence[start - 1];
          if (!/[\u4e00-\u9fa5]/.test(ch) || CLOZE_BOUND.has(ch)) break;
          if (start >= 2 && CLOZE_STOP2.indexOf(sentence.slice(start - 2, start)) >= 0) break;
          start--;
          n++;
        }
        add(start, i + suf.length, sentence.slice(start, i + suf.length));
        i += suf.length - 1;
        break;
      }
    }
    if (mode === "more") {
      // 代表人物姓名等（“代表人物顾恺之”这类）
      scan(
        /(?:代表人物|设计师|建筑师|艺术家|画家|作家|思想家|创始人|奠基人|领袖|领导人|学者|史称|被誉为|认为|提出)[是为:：]?\s*([\u4e00-\u9fa5]{2,4})/g,
        (mm) => trimClozeName(mm[1])
      );
      // “某某发起 / 提出 / 设计 / 创作 …” 这类人物开头
      scan(
        /([\u4e00-\u9fa5·]{2,6})(?:发起了?|提出了?|认为|强调|主张|创建了?|创办了?|设计了?|创作了?|倡导了?)/g,
        (mm) => trimClozeName(mm[1])
      );
    }
    return out;
  }

  function trimClozeName(name) {
    return String(name || "").replace(/[的是了和与及等被把将其在因为中]$/g, "");
  }

  function buildClozeItems(text, mode, maxBlanks) {
    const items = [];
    const source = String(text || "").replace(/\r/g, "").replace(/\u3000/g, " ");
    const re = /[^。！？；\n]+[。！？；]?/g;
    let m;
    while ((m = re.exec(source))) {
      const sentence = m[0].trim();
      if (sentence.length < 8) continue;
      const cands = clozeTermCandidates(sentence, mode);
      if (!cands.length) continue;
      cands.sort((a, b) => b.end - b.start - (a.end - a.start));
      const picked = [];
      for (const c of cands) {
        if (picked.some((p) => c.start < p.end && p.start < c.end)) continue;
        picked.push(c);
        if (picked.length >= maxBlanks) break;
      }
      if (!picked.length) continue;
      picked.sort((a, b) => a.start - b.start);
      const parts = [];
      const answers = [];
      let pos = 0;
      picked.forEach((c) => {
        parts.push(sentence.slice(pos, c.start));
        answers.push(c.term);
        pos = c.end;
      });
      parts.push(sentence.slice(pos));
      items.push({
        id: "cz" + Date.now() + Math.random().toString(36).slice(2, 6) + items.length,
        parts,
        answers,
        addedAt: Date.now()
      });
    }
    return items;
  }

  /* ---------- 导入资料 ---------- */
  const clozeDropZone = $("cloze-drop-zone");
  const clozeFileInput = $("cloze-file-input");
  clozeDropZone.addEventListener("click", () => clozeFileInput.click());
  clozeDropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      clozeFileInput.click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    clozeDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      clozeDropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    clozeDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      clozeDropZone.classList.remove("dragover");
    })
  );
  clozeDropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readClozeFile(file);
  });
  clozeFileInput.addEventListener("change", () => {
    if (clozeFileInput.files[0]) readClozeFile(clozeFileInput.files[0]);
  });

  function readClozeFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      $("cloze-text").value = reader.result;
      clozeClearError();
      toast("已读取《" + file.name + "》，点「生成填空题」试试");
    };
    reader.onerror = () => clozeError("读取文件失败，请重试");
    reader.readAsText(file);
  }

  function generateCloze() {
    const text = $("cloze-text").value.trim();
    if (!text) {
      clozeError("请先粘贴学习资料或拖入 .txt 文件");
      return;
    }
    clozeClearError();
    const mode = $("cloze-mode").value;
    let max = parseInt($("cloze-max").value, 10);
    if (!Number.isFinite(max) || max < 1) max = 1;
    if (max > 5) max = 5;
    const items = buildClozeItems(text, mode, max);
    if (!items.length) {
      clozeError("没有识别出可挖空的重点，试试「更多」强度，或检查资料内容");
      return;
    }
    clozePreviewItems = items;
    clozePreviewSelected = new Set(items.map((i) => i.id));
    renderClozeBookTargets();
    renderClozePreview();
    $("cloze-import-panel").classList.add("hidden");
    $("cloze-preview-panel").classList.remove("hidden");
  }

  $("btn-cloze-generate").addEventListener("click", generateCloze);
  $("btn-cloze-clear").addEventListener("click", () => {
    $("cloze-text").value = "";
    clozeClearError();
  });

  /* ---------- 生成预览 ---------- */
  function renderClozeBookTargets() {
    const sel = $("cloze-book-target");
    sel.innerHTML = "";
    const optNew = document.createElement("option");
    optNew.value = "new";
    optNew.textContent = "➕ 新建一本书";
    sel.appendChild(optNew);
    clozeLoadBooks().forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = "📖 " + b.name + "（已有 " + b.items.length + " 题）";
      sel.appendChild(opt);
    });
    const valid = clozeLoadBooks().some((b) => b.id === clozeAppendTarget);
    sel.value = clozeAppendTarget && valid ? clozeAppendTarget : "new";
    $("cloze-book-name").style.display = sel.value === "new" ? "" : "none";
  }
  $("cloze-book-target").addEventListener("change", () => {
    $("cloze-book-name").style.display =
      $("cloze-book-target").value === "new" ? "" : "none";
  });

  function clozePreviewSentenceHtml(item) {
    let html = "";
    item.parts.forEach((p, i) => {
      html += escapeHTML(p);
      if (i < item.answers.length) {
        html += '<span class="cloze-blank">＿＿＿</span>';
      }
    });
    return html;
  }

  function updateClozePreviewCount() {
    const n = clozePreviewSelected.size;
    $("cloze-preview-count").textContent = "已选 " + n + " 题";
    const btn = $("btn-cloze-save");
    btn.disabled = n === 0;
    btn.textContent = "保存到书架（" + n + " 题）";
  }

  function renderClozePreview() {
    const list = $("cloze-preview-list");
    list.innerHTML = "";
    clozePreviewItems.forEach((item) => {
      const row = document.createElement("div");
      const checked = clozePreviewSelected.has(item.id);
      row.className = "cloze-preview-row" + (checked ? " checked" : "");
      row.innerHTML =
        '<input type="checkbox" class="pick-check"' + (checked ? " checked" : "") + " />" +
        '<div class="cloze-preview-body">' +
        '<p class="cloze-preview-sentence">' + clozePreviewSentenceHtml(item) + "</p>" +
        '<div class="cloze-preview-answers">' +
        item.answers.map((a, i) =>
          '<span class="cloze-answer-chip" data-i="' + i + '">' + escapeHTML(a) + " ✕</span>"
        ).join("") +
        "</div></div>";
      const cb = row.querySelector(".pick-check");
      const toggleRow = () => {
        const on = cb.checked;
        if (on) clozePreviewSelected.add(item.id);
        else clozePreviewSelected.delete(item.id);
        row.classList.toggle("checked", on);
        updateClozePreviewCount();
      };
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("cloze-answer-chip")) return;
        if (e.target !== cb) cb.checked = !cb.checked;
        toggleRow();
      });
      cb.addEventListener("change", toggleRow);
      row.querySelectorAll(".cloze-answer-chip").forEach((chip) => {
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = parseInt(chip.dataset.i, 10);
          if (i < 0 || i >= item.answers.length) return;
          item.parts[i] = item.parts[i] + item.parts[i + 1];
          item.parts.splice(i + 1, 1);
          item.answers.splice(i, 1);
          if (!item.answers.length) {
            clozePreviewItems = clozePreviewItems.filter((x) => x.id !== item.id);
            clozePreviewSelected.delete(item.id);
            renderClozePreview();
            toast("本题已经没有空可挖，已移除");
            return;
          }
          renderClozePreview();
        });
      });
      list.appendChild(row);
    });
    updateClozePreviewCount();
  }

  $("cloze-all").addEventListener("click", () => {
    clozePreviewSelected = new Set(clozePreviewItems.map((i) => i.id));
    renderClozePreview();
  });
  $("cloze-none").addEventListener("click", () => {
    clozePreviewSelected.clear();
    renderClozePreview();
  });

  function saveClozeItems() {
    const selected = clozePreviewItems.filter((i) => clozePreviewSelected.has(i.id));
    if (!selected.length) {
      toast("请先勾选要保存的题目");
      return;
    }
    const target = $("cloze-book-target").value;
    const books = clozeLoadBooks();
    let book;
    if (target === "new") {
      const name = $("cloze-book-name").value.trim() || "未命名挖空";
      book = {
        id: "cz" + Date.now() + Math.random().toString(36).slice(2, 6),
        name,
        createdAt: Date.now(),
        items: []
      };
      books.push(book);
    } else {
      book = books.find((b) => b.id === target);
      if (!book) {
        toast("没有找到这本书，请重试");
        return;
      }
    }
    const existing = new Set(
      book.items.map((i) => i.parts.join("|") + "::" + i.answers.join("|"))
    );
    let added = 0;
    let skipped = 0;
    selected.forEach((i) => {
      const key = i.parts.join("|") + "::" + i.answers.join("|");
      if (existing.has(key)) {
        skipped++;
        return;
      }
      existing.add(key);
      book.items.push({
        ...i,
        id: "cz" + Date.now() + Math.random().toString(36).slice(2, 6)
      });
      added++;
    });
    clozeSaveBooks(books);
    clozePreviewItems = [];
    clozePreviewSelected = new Set();
    clozeAppendTarget = "";
    $("cloze-text").value = "";
    $("cloze-preview-panel").classList.add("hidden");
    updateClozeCount();
    switchClozeTab("shelf");
    toast(
      added
        ? "已保存 " + added + " 题到《" + book.name + "》" +
          (skipped ? "，跳过 " + skipped + " 题重复" : "")
        : "这些题在《" + book.name + "》里已经有了，未重复保存"
    );
  }

  $("btn-cloze-save").addEventListener("click", saveClozeItems);
  $("btn-cloze-regenerate").addEventListener("click", () => {
    $("cloze-preview-panel").classList.add("hidden");
    $("cloze-import-panel").classList.remove("hidden");
  });

  /* ---------- 挖空书架 ---------- */
  function renderClozeShelf() {
    const books = clozeLoadBooks();
    const list = $("cloze-shelf-list");
    list.innerHTML = "";
    $("cloze-shelf-empty").classList.toggle("hidden", books.length > 0);
    books.forEach((b) => {
      const card = document.createElement("div");
      card.className = "cloze-book-card";
      card.innerHTML =
        '<div class="cloze-book-info">' +
        '<strong class="book-name">' + escapeHTML(b.name) + "</strong>" +
        '<span class="book-meta">' + b.items.length + " 题 · " + formatDate(b.createdAt) + "</span>" +
        "</div>" +
        '<div class="book-actions">' +
        '<button class="btn btn-primary btn-small" data-act="start" type="button">开始练习</button>' +
        '<button class="btn btn-ghost btn-small" data-act="append" type="button">追加资料</button>' +
        '<button class="btn btn-ghost btn-small" data-act="del" type="button">删除</button>' +
        "</div>";
      card.querySelector('[data-act="start"]').addEventListener("click", () => {
        if (!b.items.length) {
          toast("这本书还没有填空题，先导入资料生成吧");
          return;
        }
        startClozePractice(b.items, b.name, b.id);
      });
      card.querySelector('[data-act="append"]').addEventListener("click", () => {
        clozeAppendTarget = b.id;
        renderClozeBookTargets();
        switchClozeTab("import");
        toast("已选择《" + b.name + "》：生成的新题会自动追加进去");
      });
      card.querySelector('[data-act="del"]').addEventListener("click", () => {
        if (confirm("确定删除《" + b.name + "》吗？里面的填空题会一并删除。")) {
          clozeSaveBooks(clozeLoadBooks().filter((x) => x.id !== b.id));
          renderClozeShelf();
          updateClozeCount();
          toast("已删除");
        }
      });
      list.appendChild(card);
    });
    updateClozeCount();
  }

  /* ---------- 填空练习 ---------- */
  function startClozePractice(items, sourceName, bookId) {
    clozePracticeItems = items.map((i) => ({
      ...i,
      parts: i.parts.slice(),
      answers: i.answers.slice()
    }));
    clozePracticeInputs = clozePracticeItems.map((i) => i.answers.map(() => ""));
    clozePracticeWrong = clozePracticeItems.map(() => false);
    clozePracticeCurrent = 0;
    clozePracticeSource = sourceName || "";
    clozePracticeBookId = bookId || "";
    $("cloze-result").classList.add("hidden");
    $("cloze-question-card").classList.remove("hidden");
    $("cloze-quiz-footer").classList.remove("hidden");
    $("cloze-tabs").classList.add("hidden");
    clozeShowPanel("practice");
    renderClozeQuestion();
  }

  function renderClozeQuestion() {
    const item = clozePracticeItems[clozePracticeCurrent];
    $("cloze-progress-text").textContent =
      "第 " + (clozePracticeCurrent + 1) + " / " + clozePracticeItems.length + " 题";
    $("cloze-progress-fill").style.width =
      ((clozePracticeCurrent + 1) / clozePracticeItems.length) * 100 + "%";
    $("cloze-quiz-source").textContent = clozePracticeSource
      ? "来源：" + clozePracticeSource
      : "";
    $("cloze-result-msg").textContent = "";
    $("cloze-result-msg").className = "cloze-result-msg";
    let html = "";
    item.parts.forEach((p, i) => {
      html += escapeHTML(p);
      if (i < item.answers.length) {
        const val = escapeHTML(clozePracticeInputs[clozePracticeCurrent][i] || "");
        const width = Math.max(4, item.answers[i].length + 2);
        html +=
          '<input class="cloze-input" data-i="' + i + '" type="text" value="' + val +
          '" autocomplete="off" style="width:' + width + 'em" />';
      }
    });
    $("cloze-question").innerHTML = html;
    $("cloze-question").querySelectorAll(".cloze-input").forEach((inp) => {
      inp.addEventListener("input", () => {
        clozePracticeInputs[clozePracticeCurrent][parseInt(inp.dataset.i, 10)] = inp.value;
        updateClozeNext();
      });
    });
    const nextBtn = $("btn-cloze-next");
    nextBtn.dataset.step = "check";
    nextBtn.textContent = "检查答案";
    $("cloze-footer-hint").textContent = "填完所有空后点「检查答案」";
    $("cloze-footer-hint").classList.remove("hide");
    updateClozeNext();
  }

  function updateClozeNext() {
    const vals = clozePracticeInputs[clozePracticeCurrent] || [];
    const allFilled = vals.every((v) => String(v).trim() !== "");
    $("btn-cloze-next").disabled = !allFilled;
  }

  function handleClozeNext() {
    const btn = $("btn-cloze-next");
    if (btn.dataset.step === "check") {
      const item = clozePracticeItems[clozePracticeCurrent];
      let allOk = true;
      $("cloze-question").querySelectorAll(".cloze-input").forEach((inp, i) => {
        inp.disabled = true;
        const user = String(clozePracticeInputs[clozePracticeCurrent][i]).trim();
        const ok = user === item.answers[i].trim();
        if (!ok) allOk = false;
        inp.classList.add(ok ? "ok" : "no");
        if (!ok) {
          const hint = document.createElement("span");
          hint.className = "cloze-correct";
          hint.textContent = "✓ " + item.answers[i].trim();
          inp.insertAdjacentElement("afterend", hint);
        }
      });
      clozePracticeWrong[clozePracticeCurrent] = !allOk;
      const msg = $("cloze-result-msg");
      msg.textContent = allOk ? "✓ 全对！" : "再看看，正确答案已标出";
      msg.className = "cloze-result-msg " + (allOk ? "ok" : "no");
      btn.textContent =
        clozePracticeCurrent === clozePracticeItems.length - 1 ? "查看成绩" : "下一题";
      btn.dataset.step = "next";
      $("cloze-footer-hint").classList.add("hide");
    } else {
      if (clozePracticeCurrent === clozePracticeItems.length - 1) showClozeResult();
      else {
        clozePracticeCurrent++;
        renderClozeQuestion();
      }
    }
  }
  $("btn-cloze-next").addEventListener("click", handleClozeNext);

  function showClozeResult() {
    const total = clozePracticeItems.length;
    let correct = 0;
    clozePracticeWrong.forEach((w) => {
      if (!w) correct++;
    });
    const rate = total ? Math.round((correct / total) * 100) : 0;
    $("cloze-score-text").textContent = correct + " / " + total;
    $("cloze-rate-text").textContent = rate + "%";
    $("cloze-result-emoji").textContent =
      rate === 100 ? "🏆 全对，太厉害了！"
      : rate >= 80 ? "🎉 很棒！"
      : rate >= 60 ? "👍 继续加油！"
      : "💪 多练几次就会了！";
    $("cloze-question-card").classList.add("hidden");
    $("cloze-quiz-footer").classList.add("hidden");
    $("cloze-result").classList.remove("hidden");
    $("btn-cloze-rewrong").classList.toggle("hidden", total - correct === 0);
  }

  function exitClozePractice() {
    switchClozeTab("shelf");
    renderClozeShelf();
  }

  $("btn-cloze-quit").addEventListener("click", () => {
    if (confirm("确定退出当前练习吗？")) exitClozePractice();
  });
  $("btn-cloze-retry").addEventListener("click", () => {
    startClozePractice(clozePracticeItems, clozePracticeSource, clozePracticeBookId);
  });
  $("btn-cloze-rewrong").addEventListener("click", () => {
    const wrong = clozePracticeItems.filter((_, i) => clozePracticeWrong[i]);
    startClozePractice(wrong, clozePracticeSource + " · 错题重练", clozePracticeBookId);
  });
  $("btn-cloze-done").addEventListener("click", exitClozePractice);

  $("btn-goto-cloze").addEventListener("click", enterCloze);
  $("btn-cloze-home").addEventListener("click", () => showSplash());
  document.querySelectorAll(".cloze-tab").forEach((t) => {
    t.addEventListener("click", () => switchClozeTab(t.dataset.clozeTab));
  });

  /* ============ 题库解析器 ============ */
  function normalizeList(rawList) {
    const list = [];
    let skipped = 0;
    rawList.forEach((raw) => {
      const q = normalizeQuestion(raw);
      if (
        !q ||
        q.options.length < 2 ||
        q.answer < 0 ||
        q.answer >= q.options.length
      ) {
        skipped++;
        return;
      }
      list.push(q);
    });
    return { list, skipped };
  }

  function normalizeQuestion(raw) {
    if (!raw || typeof raw !== "object") return null;
    const question = pick(raw, ["question", "题干", "题目", "title", "问题", "q"]);
    if (!question) return null;

    let options = [];
    if (Array.isArray(raw.options)) options = raw.options;
    else if (Array.isArray(raw.optionList)) options = raw.optionList;
    else
      options = ["A", "B", "C", "D"]
        .map((k) => raw[k] ?? raw["选项" + k] ?? raw["option" + k] ?? null)
        .filter((v) => v != null && String(v).trim() !== "");

    const answerRaw = pick(raw, [
      "answer",
      "答案",
      "参考答案",
      "正确答案",
      "answerIndex",
      "correct"
    ]);
    let answer = -1;
    if (typeof answerRaw === "number") answer = answerRaw;
    else if (typeof answerRaw === "string") {
      const s = answerRaw.trim();
      if (/^\d+$/.test(s)) answer = parseInt(s, 10);
      else {
        const L = s.toUpperCase().charAt(0);
        answer = "ABCD".indexOf(L);
      }
    }

    const explanation = pick(raw, ["explanation", "解析", "详解", "解释", "note"]) || "";
    return {
      question: String(question).trim(),
      options: options.map(String),
      answer,
      explanation: String(explanation).trim()
    };
  }

  function pick(obj, keys) {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null) return obj[k];
    }
    return undefined;
  }

  function parseJSON(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("JSON 格式有误，请检查是否为合法的 JSON 文件");
    }
    const arr = Array.isArray(data)
      ? data
      : data.questions || data.list || data.items;
    if (!Array.isArray(arr)) {
      throw new Error(
        "JSON 中未找到题目列表（应为数组，或 { \"questions\": [...] } 的格式）"
      );
    }
    return normalizeList(arr);
  }

  function parseTXT(text) {
    const lines = text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.trim());
    const questions = [];
    const answerMap = {}; // 题号 -> 答案字母（来自文末答案表）
    const explanationMap = {}; // 题号 -> 解析（来自文末“解析：”区）
    let cur = null;
    let globalExplain = false; // 是否处于文末“解析：”区域
    let lastExplainNum = 0;

    // 文末答案表：整行由 “1. D  2. C  3. B …” 组成
    function tryParseAnswerRow(line) {
      const re = /\d+\s*[.、．]\s*[A-Da-d]/g;
      if (line.replace(re, "").replace(/\s+/g, "") !== "") return false;
      const re2 = /(\d+)\s*[.、．]\s*([A-Da-d])/g;
      let m;
      while ((m = re2.exec(line))) {
        answerMap[parseInt(m[1], 10)] = m[2].toUpperCase();
      }
      return true;
    }

    // 收集题目（文末答案可能还没读到，稍后统一补全）
    function finishCurrent() {
      if (cur && cur.question && Object.keys(cur.options).length >= 2) {
        questions.push(cur);
      }
      cur = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // 文末答案表（“1. D  2. C …”）或纯字母答案行（“D C B A”）
      if (tryParseAnswerRow(line)) continue;
      if (/^[A-Da-d](?:\s+[A-Da-d])+$/.test(line)) {
        const letters = line.trim().split(/\s+/).map((s) => s.toUpperCase());
        const base = Object.keys(answerMap).reduce(
          (max, k) => Math.max(max, parseInt(k, 10) || 0),
          0
        );
        letters.forEach((L, idx) => {
          answerMap[base + idx + 1] = L;
        });
        continue;
      }

      // 独立成行的“解析：”且下一非空行是编号条目 → 文末解析区
      if (/^解析\s*[:：]\s*$/.test(line)) {
        let j = i + 1;
        while (j < lines.length && !lines[j]) j++;
        if (/^\s*\d+\s*[.、．]/.test(lines[j] || "")) {
          globalExplain = true;
          continue;
        }
      }
      if (globalExplain) {
        const em = line.match(/^(\d+)\s*[.、．]\s*(.*)$/);
        if (em) {
          lastExplainNum = parseInt(em[1], 10);
          explanationMap[lastExplainNum] = em[2];
        } else if (lastExplainNum) {
          explanationMap[lastExplainNum] += "\n" + line;
        }
        continue;
      }

      // “答案：1. D  2. C …” 形式的答案表
      const ansTable = line.match(/^(?:答案|参考答案|正确答案)\s*[:：]\s*(.*)$/i);
      if (ansTable) {
        const body = ansTable[1].trim();
        const re = /\d+\s*[.、．]\s*[A-Da-d]/g;
        if (body && body.replace(re, "").replace(/\s+/g, "") === "") {
          const re2 = /(\d+)\s*[.、．]\s*([A-Da-d])/g;
          let m2;
          while ((m2 = re2.exec(body))) {
            answerMap[parseInt(m2[1], 10)] = m2[2].toUpperCase();
          }
          continue;
        }
      }

      // 分隔线（===== 等）：一题结束
      if (/^[=\-*]{3,}$/.test(line)) {
        finishCurrent();
        continue;
      }

      let m = line.match(/^\s*(\d+)\s*[.、．]\s*(.*)$/);
      const qnum = m ? parseInt(m[1], 10) : null;

      // 编号 + 【…】开头的题目头，例如 “1.【出自：宋代绘画——范宽】”
      if (m && /^【/.test(m[2])) {
        finishCurrent();
        cur = {
          number: qnum,
          question: "",
          options: {},
          answerRaw: "",
          explanation: [],
          inExplanation: false,
          meta: m[2]
        };
        continue;
      }

      // 编号开头的题目行，例如 “1、顾恺之的代表作是？”
      if (m) {
        if (cur && cur.inExplanation) {
          // 解析里出现的编号行：仅当下一行是选项行时才视为新题开始
          let j = i + 1;
          while (j < lines.length && !lines[j]) j++;
          if (!/^(?:选项)?[A-D]\s*[:：.、．)）]/.test(lines[j] || "")) {
            cur.explanation.push(line);
            continue;
          }
        }
        if (cur && (cur.question || Object.keys(cur.options).length > 0 || cur.answerRaw)) {
          finishCurrent();
        }
        if (!cur) cur = { question: "", options: {}, answerRaw: "", explanation: [], inExplanation: false };
        cur.number = qnum;
        cur.question = (cur.question ? cur.question + "\n" : "") + m[2];
        continue;
      }

      if (!cur) cur = { question: "", options: {}, answerRaw: "", explanation: [], inExplanation: false };

      // “题目：” 等标签
      m = line.match(/^(?:题目|题干|问题|question|q)\s*[:：]\s*(.*)$/i);
      if (m) {
        if (cur && (Object.keys(cur.options).length > 0 || cur.answerRaw || cur.explanation.length)) {
          finishCurrent();
          cur = { question: "", options: {}, answerRaw: "", explanation: [], inExplanation: false };
        }
        cur.question = (cur.question ? cur.question + "\n" : "") + m[1];
        continue;
      }

      // 选项行，如 “A. 郭熙”“B、范宽”“C) 李唐”
      m = line.match(/^(?:选项)?([A-D])\s*[:：.、．)）]\s*(.*)$/i);
      if (m) {
        if (m[2]) cur.options[m[1]] = m[2];
        continue;
      }

      // 答案行
      m = line.match(/^(?:【)?(?:答案|参考答案|正确答案)(?:】)?\s*[:：]\s*(.*)$/i);
      if (m) {
        cur.answerRaw = m[1];
        continue;
      }

      // 解析行
      m = line.match(/^(?:解析|详解|解释|答案分析|explanation|note)\s*[:：]\s*(.*)$/i);
      if (m) {
        cur.inExplanation = true;
        if (m[1]) cur.explanation.push(m[1]);
        continue;
      }

      if (cur.inExplanation) {
        cur.explanation.push(line);
      } else if (Object.keys(cur.options).length === 0 && !cur.answerRaw) {
        cur.question = (cur.question ? cur.question + "\n" : "") + line;
      } else {
        cur.explanation.push(line);
      }
    }

    finishCurrent();

    // 用文末答案表 / 解析区补全题目
    const filled = [];
    questions.forEach((q) => {
      const letter =
        q.answerRaw && /^[A-D]$/i.test(q.answerRaw)
          ? q.answerRaw.toUpperCase()
          : ((q.number ? answerMap[q.number] : "") || "");
      if (!/^[A-D]$/.test(letter)) return;
      const options = ["A", "B", "C", "D"]
        .map((k) => q.options[k])
        .filter((v) => v !== undefined);
      const explanation = [
        q.meta || "",
        q.explanation.join("\n"),
        (q.number ? explanationMap[q.number] : "") || ""
      ]
        .filter(Boolean)
        .join("\n");
      filled.push({
        question: q.question,
        options,
        answer: "ABCD".indexOf(letter),
        explanation
      });
    });

    return normalizeList(filled);
  }

  function parseCSV(text) {
    const rows = parseCSVRows(text);
    if (rows.length < 2) {
      throw new Error("CSV 文件需要包含表头和数据行");
    }
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const find = (names) => header.findIndex((h) => names.includes(h));
    const qi = find(["题干", "题目", "question", "q", "title", "问题"]);
    const ai = find(["选项a", "a", "optiona"]);
    const bi = find(["选项b", "b", "optionb"]);
    const ci = find(["选项c", "c", "optionc"]);
    const di = find(["选项d", "d", "optiond"]);
    const ansI = find(["答案", "参考答案", "正确答案", "answer", "ans"]);
    const exI = find(["解析", "详解", "explanation", "解释"]);

    if (qi < 0 || ai < 0 || bi < 0 || ci < 0 || di < 0) {
      throw new Error(
        "CSV 表头需要包含：题干、选项A、选项B、选项C、选项D、答案、解析"
      );
    }

    const rawList = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r].map((c) => String(c).trim());
      if (!row[qi]) continue;
      rawList.push({
        question: row[qi],
        options: [row[ai], row[bi], row[ci], row[di]].filter(
          (v) => v !== "" && v !== undefined
        ),
        answer: ansI >= 0 ? row[ansI] : -1,
        explanation: exI >= 0 ? row[exI] || "" : ""
      });
    }
    return normalizeList(rawList);
  }

  function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  /* ============ 答题逻辑 ============ */
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function optionLabel(q, idx) {
    return "ABCD"[idx] + "、" + q.options[idx];
  }

  function renderQuestion() {
    const q = questions[current];
    $("progress-text").textContent = `第 ${current + 1} / ${questions.length} 题`;
    $("progress-fill").style.width =
      ((current + 1) / questions.length) * 100 + "%";
    $("question-text").textContent = q.question;

    const wrap = $("options");
    wrap.innerHTML = "";
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      btn.innerHTML =
        '<span class="letter">' + "ABCD"[i] + "</span>" +
        '<span class="text">' + escapeHTML(opt) + "</span>";
      btn.addEventListener("click", () => selectOption(i));
      wrap.appendChild(btn);
    });

    $("explanation").classList.add("hidden");
    $("explanation-body").textContent = "";
    answered = false;
    const nextBtn = $("btn-next");
    nextBtn.disabled = true;
    nextBtn.textContent = "继续";
    nextBtn.dataset.step = "answer";
    $("footer-hint").classList.remove("hide");
  }

  function selectOption(i) {
    if (answered) return;
    answered = true;
    $("footer-hint").classList.add("hide");
    userAnswers[current] = i;
    const q = questions[current];
    const buttons = $("options").querySelectorAll(".option");
    buttons.forEach((btn, j) => {
      btn.disabled = true;
      if (j === q.answer) {
        btn.classList.add("correct");
        btn.insertAdjacentHTML("beforeend", '<span class="mark ok">✓ 答对啦</span>');
      } else if (j === i) {
        btn.classList.add("wrong");
        btn.insertAdjacentHTML("beforeend", '<span class="mark no">✗ 再想想</span>');
      }
    });
    const nextBtn = $("btn-next");
    nextBtn.disabled = false;
    nextBtn.textContent = "继续";
    nextBtn.dataset.step = "explain";
  }

  function handleNext() {
    const nextBtn = $("btn-next");
    if (!answered) return;
    if (nextBtn.dataset.step === "explain") {
      const q = questions[current];
      $("explanation-body").textContent = q.explanation || "（本题暂无解析）";
      $("explanation").classList.remove("hidden");
      nextBtn.textContent =
        current === questions.length - 1 ? "查看成绩" : "下一题";
      nextBtn.dataset.step = "next";
    } else if (nextBtn.dataset.step === "next") {
      if (current === questions.length - 1) showResult();
      else {
        current++;
        renderQuestion();
      }
    }
  }
  $("btn-next").addEventListener("click", handleNext);

  $("btn-quit").addEventListener("click", () => {
    if (confirm("确定要退出当前答题吗？")) {
      updateCounts();
      showSplash();
    }
  });

  /* ============ 结果页 ============ */
  function showResult() {
    let correct = 0;
    questions.forEach((q, i) => {
      if (userAnswers[i] === q.answer) correct++;
    });
    const total = questions.length;
    const rate = Math.round((correct / total) * 100);
    $("score-ring").style.setProperty("--p", rate);
    $("score-text").textContent = correct + " / " + total;
    $("rate-text").textContent = rate + "%";
    $("result-emoji").textContent =
      rate === 100 ? "🏆 全对，太厉害了！"
      : rate >= 80 ? "🎉 很棒！"
      : rate >= 60 ? "👍 继续加油！"
      : "💪 多练几次就会了！";

    const added = addWrongEntries(lastSourceName, questions, userAnswers);
    if (added > 0) toast("已将 " + added + " 道错题加入错题本 📒");

    const wrongList = $("wrong-list");
    wrongList.innerHTML = "";
    let wrongCount = 0;
    questions.forEach((q, i) => {
      if (userAnswers[i] === q.answer) return;
      wrongCount++;
      const item = document.createElement("div");
      item.className = "wrong-item";
      const yours =
        userAnswers[i] < 0
          ? '<b class="muted">未作答</b>'
          : '<b class="no">' + escapeHTML(optionLabel(q, userAnswers[i])) + "</b>";
      item.innerHTML =
        '<div class="q-text">第 ' + (i + 1) + " 题：" + escapeHTML(q.question) + "</div>" +
        '<div class="ans-row">你的答案：' + yours + "</div>" +
        '<div class="ans-row">正确答案：<b class="ok">' +
        escapeHTML(optionLabel(q, q.answer)) + "</b></div>" +
        (q.explanation
          ? '<div class="ans-explain">' + escapeHTML(q.explanation) + "</div>"
          : "");
      wrongList.appendChild(item);
    });
    if (wrongCount === 0) {
      wrongList.innerHTML = '<p class="all-right">全部答对，没有错题 🎉</p>';
    }
    $("wrong-title").classList.toggle("hidden", wrongCount === 0);
    $("btn-wrong-review").classList.toggle("hidden", wrongCount === 0);
    showView("result");
  }

  $("btn-retry").addEventListener("click", () => {
    startQuiz(questions, lastSourceName, lastBookId);
  });
  $("btn-wrong-review").addEventListener("click", () => {
    const wrong = questions.filter((q, i) => userAnswers[i] !== q.answer);
    startQuiz(wrong, "错题本练习", "");
  });
  $("btn-reimport").addEventListener("click", () => {
    fileInput.value = "";
    updateCounts();
    showView("home");
  });

  /* ============ 背诵板块：框架导图 + 知识卡片 ============ */
  const MEMO_TREE = {"t":"世界现代设计史","c":[{"t":"第一章 现代设计概述","c":[{"t":"什么是设计"},{"t":"设计的分类和范畴"}]},{"t":"第二章 工业革命前的设计","c":[{"t":"工业革命前欧洲的设计情况"},{"t":"新古典设计运动"},{"t":"工业革命之前的西方民间产品设计"},{"t":"“维多利亚”和“第二帝国”风格"}]},{"t":"第三章 现代设计的前奏：“工艺美术”与“新艺术”运动","c":[{"t":"现代设计萌发的时代背景和促进因素"},{"t":"英国的设计改革和“工艺美术”运动"},{"t":"“新艺术”运动"}]},{"t":"第四章 带装饰的现代设计：“装饰艺术”运动","c":[{"t":"“装饰艺术”运动的概况"},{"t":"影响“装饰艺术”运动风格的重要因素"},{"t":"“装饰艺术”运动的设计特点"},{"t":"“装饰艺术”风格在平面设计上的发展"},{"t":"“装饰艺术”风格的产品设计和著名的设计师"}]},{"t":"第五章 现代主义设计运动的萌起","c":[{"t":"现代设计思想体系和先驱人物"},{"t":"包豪斯"},{"t":"俄国构成主义设计运动"},{"t":"荷兰的“风格派”运动"}]},{"t":"第六章 工业设计的兴起","c":[{"t":"美国工业设计发展的背景和概况"},{"t":"美国工业设计先驱人物"},{"t":"制造业对美国现代设计的影响"},{"t":"美国现代工业设计的重要推手——大型展览和博览会"}]},{"t":"第七章 消费时代的设计","c":[{"t":"战后重建时期的产品设计"},{"t":"工业设计体制的形成"},{"t":"工业设计在联邦德国的确立"},{"t":"美国战后工业产品设计——“世纪中叶”设计浪潮"},{"t":"批判设计理论的形成"},{"t":"人体工程学的发展"},{"t":"建筑上的“国际主义”风格"},{"t":"战后平面设计的发展"}]},{"t":"第八章 后现代主义设计运动","c":[{"t":"后现代主义设计运动的兴起"},{"t":"英国的波普设计运动"},{"t":"意大利的“激进设计”运动和后现代主义设计"},{"t":"后现代主义设计在其他各国的发展"}]},{"t":"第九章 当代汽车设计","c":[{"t":"概述"},{"t":"战前汽车设计发展概况"},{"t":"战后汽车发展"},{"t":"石油危机之后的汽车设计"},{"t":"各国重要车厂和汽车设计师"}]},{"t":"第十章 各国设计简史（之一）","c":[{"t":"美国当代设计"},{"t":"德国当代设计"},{"t":"英国当代设计"}]},{"t":"第十一章 各国设计简史（之二）","c":[{"t":"意大利现代设计"},{"t":"日本当代设计"},{"t":"北欧当代设计"}]}]};

  let memoLeaves = [];
  let memoLeafIndex = 0;
  let memoRendered = false;
  const MEMO_STORE_KEY = "memorize_knowledge_v1";
  let memoStore = null;
  let memoBook = null;
  let memoCurKey = "";
  let memoCurType = "term";
  let memoCurNode = null;
  let memoCurPath = null;
  let memoImageDirty = null; // 编辑弹窗中暂存的图片（null 表示未改动）

  function memoLoadStore() {
    try {
      const raw = localStorage.getItem(MEMO_STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { books: [] };
  }
  function memoSaveStore() {
    try {
      localStorage.setItem(MEMO_STORE_KEY, JSON.stringify(memoStore));
      return true;
    } catch (e) {
      toast("保存失败：浏览器存储不可用");
      return false;
    }
  }
  function memoSeed() {
    memoStore = memoLoadStore();
    if (!Array.isArray(memoStore.books) || !memoStore.books.length) {
      memoStore.books = [
        {
          id: "memo1",
          name: MEMO_TREE.t,
          tree: MEMO_TREE,
          cards: {}
        }
      ];
      memoSaveStore();
    }
    memoBook = memoStore.books[0];
    if (!memoBook.cards) memoBook.cards = {};
  }
  function memoCardKey(node, path) {
    return (path || []).slice(1).join("›") || node.t;
  }
  function memoGetCard(node, path) {
    const key = memoCardKey(node, path);
    if (!memoBook.cards[key]) memoBook.cards[key] = {};
    return memoBook.cards[key];
  }
  function memoFilledCount() {
    let n = 0;
    Object.keys(memoBook.cards).forEach((k) => {
      const c = memoBook.cards[k];
      if (c.def || c.features || c.works || c.memory || c.points || c.cases || c.keywords || c.image) n++;
    });
    return n;
  }
  function memoUpdateFilled() {
    $("memo-filled-count").textContent = memoFilledCount();
  }

  function memoCardType(node) {
    if (node.c && node.c.length) return "frame";
    if (/论述|影响|发展|对比|背景|概况|推动|促进|推手|体制|形成|兴起|改革/.test(node.t)) return "essay";
    return "term";
  }

  function memoFlatten(node, path) {
    const p = path.concat(node.t);
    if (node.c && node.c.length) node.c.forEach((child) => memoFlatten(child, p));
    else memoLeaves.push({ title: node.t, path: p, node });
  }

  function memoBuildBack(node, type, card) {
    const t = node.t;
    const h = (title, html) => '<div class="memo-sec"><h4>' + title + "</h4>" + html + "</div>";
    const empty = '<p class="memo-empty-note">还没有内容，点卡片右上角「✏️ 编辑」填写。</p>';
    const para = (v) =>
      v && v.trim()
        ? "<p>" + escapeHTML(v.trim()).replace(/\n/g, "<br>") + "</p>"
        : empty;
    const lines = (v) => {
      const arr = String(v || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      return arr.length
        ? "<ul>" + arr.map((s) => "<li>" + escapeHTML(s) + "</li>").join("") + "</ul>"
        : empty;
    };
    if (type === "frame") {
      return h("包含知识点",
        '<ul class="memo-frame-list">' +
        node.c.map((c) => '<li><button data-memo-jump="' + escapeHTML(c.t) + '" type="button">' + escapeHTML(c.t) + "</button></li>").join("") +
        "</ul>");
    }
    if (type === "essay") {
      return (
        h("论点骨架", lines(card.points)) +
        h("论据与案例", para(card.cases)) +
        h("关键词", para(card.keywords))
      );
    }
    return (
      h("定义", para(card.def)) +
      h("关键特征", lines(card.features)) +
      h("代表作品 / 人物", para(card.works)) +
      h("一句话记忆", para(card.memory))
    );
  }

  function memoShowCard(node, path) {
    const type = memoCardType(node);
    const isFrame = type === "frame";
    const card = isFrame ? {} : memoGetCard(node, path);
    memoCurKey = memoCardKey(node, path);
    memoCurType = type;
    memoCurNode = node;
    memoCurPath = path;
    const crumb = isFrame ? [node.t] : path.slice(1);
    $("memo-breadcrumb").innerHTML =
      crumb.slice(0, -1).map((s) => '<span>' + escapeHTML(s) + '</span><span class="memo-crumb-sep">/</span>').join("") +
      '<span class="memo-crumb-current">' + escapeHTML(crumb[crumb.length - 1]) + "</span>" +
      '<span class="memo-type-tag ' +
      (isFrame ? "memo-tag-frame" : type === "term" ? "memo-tag-term" : "memo-tag-essay") +
      '">' + (type === "term" ? "名词解释" : type === "essay" ? "论述题" : "框架卡") + "</span>";

    $("memo-f-title").textContent = node.t;
    $("memo-b-title").textContent = node.t;
    $("memo-b-body").innerHTML = memoBuildBack(node, type, card);
    const frameEl = $("memo-f-frame");
    const imgEl = $("memo-f-image");
    $("memo-edit").style.display = isFrame ? "none" : "inline-flex";
    if (isFrame) {
      frameEl.classList.add("show");
      imgEl.style.display = "none";
      frameEl.innerHTML =
        '<ul class="memo-frame-list">' +
        node.c.map((c) => '<li><button data-memo-jump="' + escapeHTML(c.t) + '" type="button">' + escapeHTML(c.t) + "</button></li>").join("") +
        "</ul>";
      frameEl.querySelectorAll("[data-memo-jump]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const leaf = memoLeaves.find((l) => l.title === btn.dataset.memoJump);
          if (leaf) memoSelectLeaf(leaf);
        });
      });
      $("memo-f-hint").textContent = "框架卡 · 轻点条目跳转到对应知识点";
      $("memo-hint").textContent = "框架卡：先看整体结构，再点条目进入细节";
    } else {
      frameEl.classList.remove("show");
      frameEl.innerHTML = "";
      imgEl.style.display = "flex";
      if (card.image) {
        imgEl.innerHTML = '<img class="memo-card-img" src="' + card.image + '" alt="作品图" />';
      } else {
        imgEl.innerHTML =
          '<div class="memo-monogram">' + (node.t.trim().charAt(0) || "?").toUpperCase() + "</div>" +
          '<span class="memo-img-hint">作品图位 · 点「✏️ 编辑」上传</span>';
      }
      $("memo-f-hint").textContent = "轻点卡片翻面 · 对照背面自测";
      $("memo-hint").textContent = "轻点卡片翻面 · 自评后自动进入下一张";
    }
    $("memo-flip").classList.remove("flipped");
    memoUpdateFilled();

    $("memo-b-body").querySelectorAll("[data-memo-jump]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const leaf = memoLeaves.find((l) => l.title === btn.dataset.memoJump);
        if (leaf) memoSelectLeaf(leaf);
      });
    });
  }

  function memoSelectNode(node) {
    document.querySelectorAll(".memo-row").forEach((r) => r.classList.remove("selected"));
    const target = document.querySelector('.memo-row.memo-chapter[data-title="' + node.t + '"]');
    if (target) target.classList.add("selected");
    memoShowCard(node, [MEMO_TREE.t, node.t]);
    memoCloseDrawer();
  }

  function memoSelectLeaf(leaf) {
    memoLeafIndex = memoLeaves.indexOf(leaf);
    document.querySelectorAll(".memo-row").forEach((r) => r.classList.remove("selected"));
    const target = document.querySelector('.memo-row.memo-leaf[data-title="' + leaf.title + '"]');
    if (target) {
      target.classList.add("selected");
      target.scrollIntoView({ block: "nearest" });
    }
    const chapterRow = document.querySelector('.memo-row.memo-chapter[data-title="' + leaf.path[1] + '"]');
    if (chapterRow) {
      const childList = chapterRow.parentElement.querySelector(".memo-children");
      if (childList) childList.classList.remove("collapsed");
      chapterRow.querySelector(".memo-chev").classList.add("open");
    }
    memoShowCard(leaf.node, leaf.path);
    memoCloseDrawer();
  }

  function memoNextLeaf(step) {
    const i = (memoLeafIndex + step + memoLeaves.length) % memoLeaves.length;
    memoSelectLeaf(memoLeaves[i]);
  }

  function memoRenderTree() {
    const root = $("memo-tree");
    root.innerHTML = "";
    const ul = document.createElement("ul");
    const rootLi = document.createElement("li");
    rootLi.innerHTML =
      '<button class="memo-row memo-chapter memo-root" data-title="' + escapeHTML(MEMO_TREE.t) + '" type="button">' +
      '<span class="memo-chev open">▶</span>' +
      '<span class="memo-label">' + escapeHTML(MEMO_TREE.t) + "</span>" +
      '<span class="memo-count">' + memoLeaves.length + "</span></button>";
    const childWrap = document.createElement("div");
    childWrap.className = "memo-children";
    const cul = document.createElement("ul");
    MEMO_TREE.c.forEach((chapter) => {
      const li = document.createElement("li");
      li.innerHTML =
        '<button class="memo-row memo-chapter" data-title="' + escapeHTML(chapter.t) + '" type="button">' +
        '<span class="memo-chev open">▶</span>' +
        '<span class="memo-label">' + escapeHTML(chapter.t) + "</span>" +
        '<span class="memo-count">' + (chapter.c ? chapter.c.length : 0) + "</span></button>";
      const wrap = document.createElement("div");
      wrap.className = "memo-children";
      const cul2 = document.createElement("ul");
      (chapter.c || []).forEach((leaf) => {
        const lli = document.createElement("li");
        lli.innerHTML =
          '<button class="memo-row memo-leaf" data-title="' + escapeHTML(leaf.t) + '" type="button">' +
          '<span class="memo-leaf-dot"></span>' +
          '<span class="memo-label">' + escapeHTML(leaf.t) + "</span></button>";
        lli.querySelector(".memo-leaf").addEventListener("click", () => {
          const found = memoLeaves.find((l) => l.title === leaf.t);
          if (found) memoSelectLeaf(found);
        });
        cul2.appendChild(lli);
      });
      wrap.appendChild(cul2);
      li.querySelector(".memo-chapter").addEventListener("click", (e) => {
        const ch = li.querySelector(".memo-chev");
        if (e.target.closest(".memo-chev")) {
          const collapsed = wrap.classList.toggle("collapsed");
          ch.classList.toggle("open", !collapsed);
          return;
        }
        wrap.classList.remove("collapsed");
        ch.classList.add("open");
        memoSelectNode(chapter);
      });
      li.appendChild(wrap);
      cul.appendChild(li);
    });
    childWrap.appendChild(cul);
    rootLi.appendChild(childWrap);
    ul.appendChild(rootLi);
    root.appendChild(ul);
  }

  function memoCloseDrawer() {
    $("memo-sidebar").classList.remove("open");
    $("memo-scrim").classList.remove("show");
  }

  function initMemorize() {
    if (memoRendered) return;
    memoRendered = true;
    memoSeed();
    memoFlatten(MEMO_TREE, []);
    $("memo-leaf-count").textContent = memoLeaves.length;
    memoRenderTree();
    memoSelectLeaf(memoLeaves[0]);
  }

  $("btn-goto-memo").addEventListener("click", () => showView("memorize"));
  $("btn-switch").addEventListener("click", () => showView("memorize"));
  $("btn-memo-home").addEventListener("click", () => showSplash());
  $("memo-expand-all").addEventListener("click", () => {
    document.querySelectorAll(".memo-children").forEach((w) => w.classList.remove("collapsed"));
    document.querySelectorAll(".memo-chev").forEach((c) => c.classList.add("open"));
  });
  $("memo-collapse-all").addEventListener("click", () => {
    document.querySelectorAll(".memo-children").forEach((w, i) => {
      if (i > 0) w.classList.add("collapsed");
    });
    document.querySelectorAll(".memo-chev").forEach((c) => c.classList.remove("open"));
    const rootChev = document.querySelector(".memo-root .memo-chev");
    if (rootChev) rootChev.classList.add("open");
  });
  $("memo-flip").addEventListener("click", (e) => {
    if (e.target.closest("[data-memo-jump]")) return;
    if (!$("memo-f-frame").classList.contains("show")) {
      $("memo-flip").classList.toggle("flipped");
    }
  });
  $("memo-drawer").addEventListener("click", () => {
    $("memo-sidebar").classList.add("open");
    $("memo-scrim").classList.add("show");
  });
  $("memo-scrim").addEventListener("click", memoCloseDrawer);
  document.querySelectorAll(".memo-rate").forEach((btn) => {
    btn.addEventListener("click", () => {
      toast("已标记：「" + btn.dataset.rate + "」· 进入下一张");
      setTimeout(() => memoNextLeaf(1), 260);
    });
  });

  /* ---------- 背诵：编辑卡片 ---------- */
  function memoOpenEdit() {
    const card = memoBook.cards[memoCurKey] || (memoBook.cards[memoCurKey] = {});
    memoImageDirty = null;
    const field = (label, id, val, ph, rows) =>
      '<label class="memo-field"><span>' + label + "</span>" +
      '<textarea id="' + id + '" rows="' + rows + '" placeholder="' + ph + '">' + escapeHTML(val || "") + "</textarea></label>";
    const input = (label, id, val, ph) =>
      '<label class="memo-field"><span>' + label + "</span>" +
      '<input id="' + id + '" type="text" placeholder="' + ph + '" value="' + escapeHTML(val || "") + '" /></label>';

    let body = "";
    if (memoCurType === "essay") {
      body =
        field("论点骨架（每行一个论点）", "memo-f-points", card.points, "论点一…\n论点二…", 5) +
        field("论据与案例", "memo-f-cases", card.cases, "作品、人物、事件…", 4) +
        input("关键词", "memo-f-keywords", card.keywords, "关键词A、关键词B");
    } else {
      body =
        field("定义", "memo-f-def", card.def, "定义、定位、核心观点…", 5) +
        field("关键特征（每行一个）", "memo-f-features", card.features, "特征一\n特征二", 4) +
        field("代表作品 / 人物", "memo-f-works", card.works, "作品、人物…", 3) +
        input("一句话记忆", "memo-f-memory", card.memory, "一句话记住它");
    }
    const imgPreview = card.image
      ? '<img id="memo-edit-img-preview" src="' + card.image + '" alt="预览" />'
      : '<div class="memo-img-placeholder" id="memo-edit-img-preview">还没有图片</div>';
    body +=
      '<div class="memo-img-edit"><span>作品图</span>' + imgPreview +
      '<div class="memo-img-actions">' +
      '<button type="button" id="memo-img-pick" class="memo-btn-ghost">选择图片</button>' +
      (card.image ? '<button type="button" id="memo-img-remove" class="memo-btn-ghost">移除图片</button>' : "") +
      "</div>" +
      '<input type="file" id="memo-img-file" accept="image/*" hidden /></div>';

    $("memo-edit-title").textContent = memoCurNode.t;
    $("memo-edit-sub").textContent =
      (memoCurType === "term" ? "名词解释" : "论述题") + " · 保存后自动生效";
    $("memo-edit-body").innerHTML = body;
    $("memo-edit-modal").classList.remove("hidden");

    $("memo-img-pick").addEventListener("click", () => $("memo-img-file").click());
    $("memo-img-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) {
        toast("图片请小于 3MB");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        memoImageDirty = reader.result;
        const box = $("memo-edit-img-preview");
        if (box) {
          const img = document.createElement("img");
          img.src = reader.result;
          img.alt = "预览";
          img.id = "memo-edit-img-preview";
          box.replaceWith(img);
        }
      };
      reader.readAsDataURL(f);
    });
    const removeBtn = $("memo-img-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        memoImageDirty = "";
        const box = $("memo-edit-img-preview");
        if (box) {
          const div = document.createElement("div");
          div.className = "memo-img-placeholder";
          div.id = "memo-edit-img-preview";
          div.textContent = "还没有图片";
          box.replaceWith(div);
        }
      });
    }
  }

  function memoCloseEdit() {
    $("memo-edit-modal").classList.add("hidden");
    memoImageDirty = null;
  }

  function memoSaveEdit() {
    const card = memoBook.cards[memoCurKey];
    const val = (id) => {
      const el = $(id);
      return el ? el.value.trim() : "";
    };
    if (memoCurType === "essay") {
      card.points = val("memo-f-points");
      card.cases = val("memo-f-cases");
      card.keywords = val("memo-f-keywords");
    } else {
      card.def = val("memo-f-def");
      card.features = val("memo-f-features");
      card.works = val("memo-f-works");
      card.memory = val("memo-f-memory");
    }
    if (memoImageDirty !== null) card.image = memoImageDirty || null;
    if (memoSaveStore()) {
      memoCloseEdit();
      memoShowCard(memoCurNode, memoCurPath);
      toast("已保存 ✓");
    }
  }

  $("memo-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    memoOpenEdit();
  });
  $("memo-edit-save").addEventListener("click", memoSaveEdit);
  $("memo-edit-cancel").addEventListener("click", memoCloseEdit);
  $("memo-edit-close").addEventListener("click", memoCloseEdit);
  $("memo-edit-modal").addEventListener("click", (e) => {
    if (e.target === $("memo-edit-modal")) memoCloseEdit();
  });

  /* ============ 主题切换 ============ */
  const THEME_PALETTES = {
    pink: ["#ff8fb2", "#ff5c8a", "#e5487a", "#ffc9d8", "#ff7ba9"],
    mint: ["#5eead4", "#14b8a6", "#0d9488", "#7de0cf", "#2dd4bf"],
    blue: ["#60a5fa", "#3b82f6", "#2563eb", "#93c5fd", "#818cf8"],
    cream: ["#f59e0b", "#d97706", "#b45309", "#fbd58a", "#f0a13d"],
    dark: ["#a78bfa", "#8b5cf6", "#7c3aed", "#c4b5fd", "#6d28d9"]
  };
  const THEME_NAMES = {
    pink: "粉色",
    mint: "薄荷",
    blue: "雾蓝",
    cream: "奶油",
    dark: "暗夜"
  };

  function buildThemePanel() {
    const panel = $("theme-panel");
    panel.innerHTML = "";
    Object.keys(THEME_NAMES).forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-option";
      btn.dataset.theme = t;
      btn.innerHTML =
        '<i class="theme-swatch swatch-' + t + '"></i><span>' + THEME_NAMES[t] + "</span>";
      btn.addEventListener("click", () => applyTheme(t));
      panel.appendChild(btn);
    });
  }

  function applyTheme(name) {
    if (document.body) document.body.dataset.theme = name;
    try {
      localStorage.setItem("quiz_theme_v1", name);
    } catch (e) {}
    document.querySelectorAll(".theme-option").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === name);
    });
    $("theme-panel").classList.add("hidden");
    renderStudyChart();
  }

  $("theme-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    $("theme-panel").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    const panel = $("theme-panel");
    if (
      !panel.classList.contains("hidden") &&
      !e.target.closest("#theme-panel") &&
      !e.target.closest("#theme-toggle")
    ) {
      panel.classList.add("hidden");
    }
  });

  /* ============ 启动 ============ */
  buildThemePanel();
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem("quiz_theme_v1");
  } catch (e) {}
  applyTheme(savedTheme && THEME_NAMES[savedTheme] ? savedTheme : "pink");
  showSplash();
  updateCounts();
  updateClozeCount();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      parseJSON,
      parseTXT,
      parseCSV,
      normalizeList,
      escapeHTML,
      addBook,
      deleteBook,
      addWrongEntries,
      removeWrong,
      clearWrong,
      loadBooks,
      loadWrong,
      startQuiz,
      selectOption,
      handleNext,
      sanitizeBackup,
      buildBackupData,
      appendToBook,
      addStudyTime,
      formatDuration,
      collectWeekQuestions
    };
  }
})();
