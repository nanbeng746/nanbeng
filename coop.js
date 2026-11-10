(function () {
  var roomId = null;
  var pollTimer = null;
  var beatTimer = null;
  var sawStart = false;

  function $(id) { return document.getElementById(id); }
  function client() {
    return window.BengSocial && BengSocial.sessionClient ? BengSocial.sessionClient() : null;
  }
  function say(text) {
    var el = $("coopStatus");
    if (el) el.textContent = text || "";
  }
  function roomIdFrom(res) {
    var data = res && res.data;
    if (res && res.error) return null;
    if (data && data.ok === true && data.room_id) return data.room_id;
    return null;
  }
  function offsetMs() {
    var n = parseInt(localStorage.getItem("beng_audio_offset_ms") || "0", 10);
    return isFinite(n) ? n : 0;
  }

  function songName(id) {
    return window.songTitle ? window.songTitle(id) : id;
  }

  async function snapshot() {
    var c = client();
    if (!c || !roomId) return null;
    var room = await c.from("coop_rooms").select("*").eq("id", roomId).maybeSingle();
    var members = await c.from("coop_members").select("user_id,seat,ready,last_seen").eq("room_id", roomId);
    var scores = await c.from("coop_scores").select("user_id,seat,score,combo,miss").eq("room_id", roomId);
    if (room.error) return { error: room.error.message || "读房间失败" };
    return { room: room.data, members: members.data || [], scores: scores.data || [] };
  }

  function mine(snap) {
    var id = window.BengSocial && BengSocial.selfId && BengSocial.selfId();
    var me = null;
    (snap.members || []).forEach(function (m) { if (m.user_id === id) me = m; });
    return me;
  }

  function render(snap) {
    if (!snap || snap.error) { say(snap && snap.error ? snap.error : "还没有房间"); return; }
    var room = snap.room;
    var me = mine(snap);
    if (!room || !me) { say("这间房现在读不到。"); return; }
    var other = snap.members.filter(function (m) { return m.user_id !== me.user_id; })[0];
    var seat = me.seat === "front" ? "前半" : "后半";
    var half = Math.round((room.half_at_ms || 0) / 1000);
    var lines = [
      "房间 " + room.code + " · 你打" + seat,
      "曲目 " + songName(room.song_id) + " · " + (room.difficulty === "hard" ? "高级" : "普通"),
      "交接大约在 " + half + " 秒。对方的半段不算你的失误。",
      "两边分数由各自设备报上，服务器没有核对，也不是防作弊记录。"
    ];
    if (!other) lines.push("还差一个人。把房间码给对方。");
    else {
      var age = other.last_seen ? (Date.now() - new Date(other.last_seen).getTime()) / 1000 : 999;
      lines.push(other.ready ? "对方已准备。" : "对方还没准备。");
      if (age > 15) lines.push("对方超过 15 秒没有心跳，可能掉线。用同一房间码可以回到原来的座位。");
    }
    lines.push(me.ready ? "你已准备。" : "你还没准备。");
    if (room.status === "playing" && room.start_at) {
      lines.push("开场时间已定。点下面的按钮解锁声音，到点自动开始。");
    }
    if (room.status === "done") lines.push("这局结束。");
    say(lines.join("\n"));
    var box = $("coopScoreBox");
    if (!box) return;
    box.textContent = "";
    snap.scores.forEach(function (row) {
      var div = document.createElement("div");
      div.textContent = (row.seat === "front" ? "前半" : "后半") + " " + row.score + " 分 · 连击 " + row.combo + " · 失误 " + row.miss + "（未经核对）";
      box.appendChild(div);
    });
    var total = snap.scores.reduce(function (sum, row) { return sum + row.score; }, 0);
    if (snap.scores.length) {
      var all = document.createElement("div");
      all.textContent = "合计 " + total + "（两边相加，未经核对）";
      box.appendChild(all);
    }
    if (room.status === "playing" && room.start_at && !sawStart) {
      sawStart = true;
      armStart(room, me);
    }
  }

  function armStart(room, me) {
    var startAt = new Date(room.start_at).getTime();
    say($("coopStatus").textContent + "\n点「解锁声音并等待」才会开始。公网延迟不会是 0。");
    var btn = $("coopStartBtn");
    btn.textContent = "解锁声音并等待";
    btn.onclick = function () {
      if (window.unlockAudioForCoop) window.unlockAudioForCoop();
      var wait = Math.max(0, startAt - Date.now());
      setTimeout(function () { begin(room, me); }, wait);
      btn.textContent = "等待开场";
    };
  }

  function begin(room, me) {
    var halfAt = (room.half_at_ms || 0) / 1000;
    var prepared = window.prepareCoopChart && window.prepareCoopChart(room.song_id, room.difficulty, halfAt);
    if (!prepared || !prepared.built) {
      say("这台页面没有这首歌的谱。");
      return;
    }
    if (room.chart_rev && window.BENG_CHART_REV && room.chart_rev !== window.BENG_CHART_REV) {
      say("两边的谱面版本不一致：" + room.chart_rev + " / " + window.BENG_CHART_REV);
      return;
    }
    if (prepared.built.halfAt && Math.abs(prepared.built.halfAt - halfAt) > 1.5) {
      say("两边的交接点不一致，先不要开始。");
      return;
    }
    window.BENG_PLAY = { active: true, seat: me.seat, halfAt: halfAt, roomId: room.id };
    $("coopOverlay").style.display = "none";
    $("coopBanner").style.display = "block";
    $("coopBanner").textContent = (me.seat === "front" ? "你打前半" : "你打后半") + " · 交接 " + Math.round(halfAt) + " 秒";
    window.startGame();
  }

  async function tick() {
    var snap = await snapshot();
    render(snap);
  }

  function startLoops() {
    stopLoops();
    pollTimer = setInterval(tick, 1500);
    beatTimer = setInterval(function () {
      var c = client();
      if (!c || !roomId) return;
      // The query builder does not send until something consumes the promise.
      c.rpc("touch_coop", { p_room: roomId }).then(function () {}, function () {});
    }, 5000);
  }
  function stopLoops() {
    if (pollTimer) clearInterval(pollTimer);
    if (beatTimer) clearInterval(beatTimer);
    pollTimer = null;
    beatTimer = null;
  }

  async function createRoom() {
    var c = client();
    if (!c) { say("先登录自己的账号。本机测试码不能代替登录，也不能进别人的房间。"); return; }
    var picked = window.selectedChart ? window.selectedChart() : null;
    if (!picked || !picked.songId || !picked.halfAt) {
      say("先选好歌和难度，再回来开房。");
      return;
    }
    var rev = window.BENG_CHART_REV || "onset-v2";
    if (!picked.duration) { say("这首歌没有时长，不能开房。"); return; }
    var made = await c.rpc("create_coop_room", {
      p_song: picked.songId,
      p_diff: picked.diff || "normal",
      p_rev: rev
    });
    if (made.error) { say(made.error.message || "开房失败"); return; }
    var joined = await c.rpc("join_coop_room", { p_code: made.data });
    roomId = roomIdFrom(joined);
    if (!roomId) { say("开房后没能进入。"); return; }
    sawStart = false;
    startLoops();
    tick();
  }

  async function joinRoom() {
    var c = client();
    if (!c) { say("先登录自己的账号。"); return; }
    var code = ($("coopCodeInput").value || "").trim();
    if (!code) { say("先填写房间码。"); return; }
    var joined = await c.rpc("join_coop_room", { p_code: code });
    roomId = roomIdFrom(joined);
    if (!roomId) { say("进不去。房间码不对、已满、已关闭、已过期或试得太频繁。页面不会说明是哪一种。"); return; }
    sawStart = false;
    startLoops();
    tick();
  }

  async function ready() {
    var c = client();
    if (!c || !roomId) { say("还没有房间。"); return; }
    var snap = await snapshot();
    var me = snap && mine(snap);
    var next = !(me && me.ready);
    var res = await c.rpc("set_coop_ready", { p_room: roomId, p_ready: next });
    if (res.error) { say(res.error.message || "准备失败"); return; }
    tick();
  }

  async function hostStart() {
    var c = client();
    if (!c || !roomId) { say("还没有房间。"); return; }
    var res = await c.rpc("start_coop", { p_room: roomId });
    if (res.error) { say(res.error.message || "还不能开始。要两个人都准备，而且只有房主能开始。"); return; }
    tick();
  }

  function bind() {
    var open = $("openCoopBtn");
    if (open) open.onclick = function () {
      document.querySelectorAll(".overlay").forEach(function (el) { el.style.display = "none"; });
      $("coopOverlay").style.display = "flex";
      $("songLobby").style.display = "none";
      var slider = $("coopOffset");
      if (slider) {
        slider.value = String(offsetMs());
        $("coopOffsetText").textContent = offsetMs() + " ms";
        slider.oninput = function () {
          localStorage.setItem("beng_audio_offset_ms", String(slider.value));
          $("coopOffsetText").textContent = slider.value + " ms";
        };
      }
      if (!client()) say("先登录自己的账号。协力用的是你自己的登录，本机测试码不能代替。没有假队友。");
      else if (!roomId) say("选好歌和难度后开房，或输入朋友的房间码。一个人打前半，另一个人打后半。");
      else tick();
    };
    $("coopClose").onclick = function () {
      $("coopOverlay").style.display = "none";
      $("songLobby").style.display = "flex";
    };
    $("coopCreateBtn").onclick = createRoom;
    $("coopJoinBtn").onclick = joinRoom;
    $("coopReadyBtn").onclick = ready;
    $("coopStartBtn").onclick = hostStart;
    $("coopHostCloseBtn").onclick = function () {
      var c = client();
      if (!c || !roomId) { say("还没有房间。"); return; }
      c.rpc("close_coop_room", { p_room: roomId }).then(function (res) {
        if (res.error) say(res.error.message || "只有房主能关闭还在进行的房间。");
        else { say("房间已关闭。新的人不能再加入。"); tick(); }
      });
    };
    $("coopHostDeleteBtn").onclick = function () {
      var c = client();
      if (!c || !roomId) { say("还没有房间。"); return; }
      c.rpc("delete_my_coop_room", { p_room: roomId }).then(function (res) {
        if (res.error) say(res.error.message || "只能删除自己开的房间。");
        else { roomId = null; sawStart = false; say("测试房间已删除。"); }
      });
    };
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function submitScore(score, combo, miss, attempt) {
    var c = client();
    if (!c || !roomId) return { ok: false, error: "没有房间" };
    var snap = await snapshot();
    var me = snap && mine(snap);
    var room = snap && snap.room;
    if (me && room && room.start_at && attempt === 0) {
      var start = new Date(room.start_at).getTime();
      var open = start + (me.seat === "front" ? Number(room.half_at_ms) : Number(room.duration_ms));
      var delay = open - Date.now();
      if (delay > 0 && delay < 300000) await wait(delay + 750);
    }
    var res;
    try {
      res = await c.rpc("submit_coop_score", {
        p_room: roomId,
        p_score: score | 0,
        p_combo: combo | 0,
        p_miss: miss | 0
      });
    } catch (err) {
      res = { error: { message: (err && err.message) || "提交失败" } };
    }
    var message = res.error && (res.error.message || res.error.code || "提交失败");
    window.BENG_COOP_LAST_SUBMIT = {
      attempt: attempt,
      ok: !res.error,
      error: message || "",
      at: Date.now()
    };
    if (res.error && attempt < 3) {
      await wait(1000);
      return submitScore(score, combo, miss, attempt + 1);
    }
    tick();
    return window.BENG_COOP_LAST_SUBMIT;
  }

  window.BengCoop = {
    bind: bind,
    submit: function (score, combo, miss) {
      return submitScore(score, combo, miss, 0);
    }
  };
})();
