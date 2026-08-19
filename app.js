(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const VIEWS = {
    home: "home-view",
    shelf: "shelf-view",
    wrongbook: "wrongbook-view",
    quiz: "quiz-view",
    result: "result-view"
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
    let acc = 0;
    const segs = books.map((b) => {
      const from = (acc / total) * 360;
      acc += b.studyTimeMs || 0;
      const to = (acc / total) * 360;
      const hue = Math.abs(hashCode(b.name)) % 360;
      const color = "hsl(" + hue + ", 72%, 66%)";
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
  }

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
    const qs = collectWeekQuestions();
    if (!qs.length) {
      toast("最近一周还没有新题");
      return;
    }
    startQuiz(qs, "本周测验", "");
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
    showView("home");
  });
  $("btn-shelf-import").addEventListener("click", () => {
    showView("home");
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
        startQuiz(b.questions, b.name, b.id);
      });
      card.querySelector('[data-act="append"]').addEventListener("click", () => {
        appendBookId = b.id;
        renderBookTargets();
        showView("home");
        toast("已选择《" + b.name + "》：导入的新题会自动追加进去");
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

  /* ============ 错题本 ============ */
  $("btn-goto-wrong").addEventListener("click", () => {
    renderWrongBook();
    updateCounts();
    showView("wrongbook");
  });
  $("btn-wrong-home").addEventListener("click", () => {
    updateCounts();
    showView("home");
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
      wrongbook: loadWrong()
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
      if (!norm.list.length) return;
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
    return { books, wrongbook };
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
      updateCounts();
      toast(
        "恢复成功：" + clean.books.length + " 本书 · " +
        clean.wrongbook.length + " 道错题"
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
      showView("home");
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

  /* ============ 主题切换 ============ */
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
  showView("home");
  updateCounts();

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
