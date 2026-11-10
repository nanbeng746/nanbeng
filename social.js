(function () {
  var Status = window.BengStatus;
  var client = null;
  var me = null;
  var feedRows = [];
  var feedCursor = null;
  var chatWith = null;
  var bound = false;
  var busy = false;

  function $(id) { return document.getElementById(id); }
  function cfg() { return window.BENG_SUPABASE_CONFIG || {}; }
  function configured() { return Status && Status.isConfigured(cfg()); }

  function setTip(text) {
    var el = $("loginTip");
    if (el) el.textContent = text || "";
  }

  function setDiag(lines) {
    var el = $("authDiag");
    if (!el) return;
    el.textContent = "";
    (lines || []).forEach(function (line) {
      var div = document.createElement("div");
      div.textContent = line;
      el.appendChild(div);
    });
  }

  function ensureClient() {
    if (!configured()) return null;
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!client) {
      client = window.supabase.createClient(cfg().url, cfg().publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "implicit"
        }
      });
    }
    return client;
  }

  function hashError() {
    var raw = String(window.location.hash || "").replace(/^#/, "");
    if (!raw) return "";
    var params = new URLSearchParams(raw);
    var desc = params.get("error_description") || params.get("error") || "";
    if (!desc) return "";
    return "邮箱链接没有完成登录：" + desc;
  }

  function playerName() {
    if (me && me.profile) return me.profile.display_name || me.profile.username || "";
    return "";
  }

  function playerLabel() {
    if (!me) return "本机进度（未登录）";
    if (!me.profile) return "已登录，还没有读到玩家资料";
    return "已登录：" + (me.profile.display_name || me.profile.username);
  }

  function explainDb(error) {
    var msg = String((error && error.message) || "");
    var code = String((error && error.code) || "");
    var low = msg.toLowerCase();
    if (code === "23505" || low.indexOf("duplicate") !== -1) return "这个操作已经做过了。";
    if (msg.indexOf("rate_limit") !== -1) return "操作太频繁，请等几分钟再试。";
    if (msg.indexOf("blocked") !== -1 || msg.indexOf("message_forbidden") !== -1 || msg.indexOf("request_forbidden") !== -1) {
      return "现在不能这样做。可能还不是好友，或者有拉黑。";
    }
    if (code === "PGRST205" || low.indexOf("schema cache") !== -1) {
      return "数据库脚本还没装好，或接口还没刷新。请让家长先执行社交数据库脚本。这次没有成功。";
    }
    if (code === "42501" || low.indexOf("permission denied") !== -1 || low.indexOf("row-level security") !== -1) {
      return "没有权限做这件事。";
    }
    if (msg.indexOf("username_invalid") !== -1) return "玩家名需要 2 到 20 位，只能用字母、数字、下划线或中文。";
    if (!msg) return "服务器没有完成操作。";
    return "服务器没有完成操作：" + msg;
  }

  async function readProbe(url) {
    var key = cfg().publishableKey;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      var res = await fetch(url, {
        method: "GET",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          Accept: "application/json"
        },
        signal: ctrl.signal
      });
      var text = "";
      try { text = await res.text(); } catch (e) { text = ""; }
      return { status: res.status, body: text.slice(0, 500) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function diagnose() {
    if (!Status) return { level: "missing", lines: ["状态脚本没有加载。"] };
    if (!configured()) {
      return { level: "unconfigured", lines: ["社交服务器配置不完整。好友、私信和圈子保持关闭。"] };
    }
    if (!window.supabase || !window.supabase.createClient) {
      return { level: "library", lines: ["页面里的 Supabase 脚本没有加载。社交功能不可用。"] };
    }
    var base = cfg().url.replace(/\/+$/, "");
    try {
      var auth = await readProbe(base + "/auth/v1/health");
      var root = await readProbe(base + "/rest/v1/");
      var table = await readProbe(base + "/rest/v1/profiles?select=id&limit=1");
      return Status.classifyProbes({
        authStatus: auth.status,
        rootStatus: root.status,
        rootBody: root.body,
        tableStatus: table.status,
        tableBody: table.body
      });
    } catch (e) {
      return Status.classifyProbes({ networkError: true });
    }
  }

  async function refreshDiag() {
    var result = await diagnose();
    setDiag(result.lines);
    return result;
  }

  async function loadProfile() {
    if (!client || !me) return;
    var res = await client.from("profiles").select("id,username,display_name,bio,avatar_key").eq("id", me.user.id).maybeSingle();
    if (res.error) {
      me.profile = null;
      me.profileError = explainDb(res.error);
      return;
    }
    if (!res.data) {
      var nick = me.user.user_metadata && me.user.user_metadata.display_name;
      var made = await client.rpc("ensure_my_profile", {
        p_display_name: (typeof nick === "string" && nick.trim()) ? nick.trim().slice(0, 30) : null
      });
      if (made.error) {
        me.profile = null;
        me.profileError = explainDb(made.error);
        return;
      }
      res = await client.from("profiles").select("id,username,display_name,bio,avatar_key").eq("id", me.user.id).maybeSingle();
    }
    me.profile = res.data || null;
    me.profileError = res.error ? explainDb(res.error) : "";
  }

  function requireSocial() {
    if (!configured()) return "社交服务器还没配好。";
    if (!me) return "请先用登录名登录。未登录时不会显示本机假好友或假圈子。";
    if (!me.profile) return me.profileError || "还没有读到你的玩家资料。";
    return "";
  }

  function emptyNode(el, text) {
    if (!el) return;
    el.textContent = "";
    if (text) {
      var div = document.createElement("div");
      div.style.color = "#aaa";
      div.style.fontSize = "13px";
      div.style.textAlign = "center";
      div.style.padding = "12px";
      div.textContent = text;
      el.appendChild(div);
    }
  }

  function button(label, className, fn) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = className || "friend-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function row(title, actions) {
    var div = document.createElement("div");
    div.className = "friend-row";
    var name = document.createElement("span");
    name.textContent = title;
    var box = document.createElement("span");
    box.style.display = "flex";
    box.style.gap = "8px";
    box.style.flexWrap = "wrap";
    (actions || []).forEach(function (el) { box.appendChild(el); });
    div.appendChild(name);
    div.appendChild(box);
    return div;
  }

  var AVATARS = {
    TOM: "ck_TOM.jpg",
    RAA: "ck_RAA.jpg",
    SOY: "ck_SOY.jpg",
    TAK: "ck_TAK.jpg",
    ANO: "ck_ANO.jpg",
    KAS: "ck_KAS.jpg",
    RYO: "ck_RYO.jpg",
    BOC: "ck_BOC.jpg",
    IJI: "ck_IJI.jpg",
    KIT: "ck_KIT.jpg",
    SOY_RAGE: "ck_bzsoy.jpg"
  };

  function avatarSrc(key) {
    return AVATARS[key] || "ck_TOM.jpg";
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  async function renderFriends() {
    var list = $("friendListBox");
    var incoming = $("friendIncoming");
    var outgoing = $("friendOutgoing");
    var blockedBox = $("friendBlocked");
    var gate = requireSocial();
    [list, incoming, outgoing, blockedBox].forEach(function (el) { if (el) el.textContent = ""; });
    if (gate) {
      emptyNode(list, gate);
      return;
    }
    var friends = await client.rpc("list_friends");
    var requests = await client.rpc("list_friend_requests");
    var blocks = await client.rpc("list_blocks");
    if (friends.error || requests.error || blocks.error) {
      emptyNode(list, explainDb(friends.error || requests.error || blocks.error));
      return;
    }
    var uid = me.user.id;
    (requests.data || []).filter(function (r) { return r.to_user === uid; }).forEach(function (r) {
      incoming.appendChild(row(r.from_username + " 请求加好友", [
        button("同意", "friend-btn", function () { respondRequest(r.id, "accepted"); }),
        button("拒绝", "friend-btn gray", function () { respondRequest(r.id, "rejected"); })
      ]));
    });
    if (!incoming.childNodes.length) emptyNode(incoming, "没有新的好友申请");
    (requests.data || []).filter(function (r) { return r.from_user === uid; }).forEach(function (r) {
      outgoing.appendChild(row("已向 " + r.to_username + " 发出申请", [
        button("撤回", "friend-btn gray", function () { respondRequest(r.id, "cancelled"); })
      ]));
    });
    if (!outgoing.childNodes.length) emptyNode(outgoing, "没有发出的申请");
    if (!(friends.data || []).length) emptyNode(list, "还没有好友");
    (friends.data || []).forEach(function (f) {
      list.appendChild(row(f.display_name + "（" + f.username + "）", [
        button("聊天", "friend-btn", function () { openChat(f.friend_id, f.display_name); }),
        button("删除", "friend-btn gray", function () { removeFriend(f.friend_id); }),
        button("拉黑", "friend-btn warn", function () { blockUser(f.friend_id); }),
        button("举报", "friend-btn gray", function () { reportUser(f.friend_id); })
      ]));
    });
    (blocks.data || []).forEach(function (b) {
      blockedBox.appendChild(row("已拉黑 " + b.display_name, [
        button("取消拉黑", "friend-btn gray", function () { unblockUser(b.blocked); })
      ]));
    });
  }

  async function respondRequest(id, status) {
    var res = await client.from("friend_requests").update({ status: status }).eq("id", id);
    if (res.error) alert(explainDb(res.error));
    await renderFriends();
  }

  async function removeFriend(id) {
    if (!confirm("删除这个好友？之后双方都看不到原来的私信。")) return;
    var low = me.user.id < id ? me.user.id : id;
    var high = me.user.id < id ? id : me.user.id;
    var res = await client.from("friendships").delete().eq("user_low", low).eq("user_high", high);
    if (res.error) alert(explainDb(res.error));
    await renderFriends();
  }

  async function blockUser(id) {
    if (!confirm("拉黑后会解除好友，并且互相看不到动态和私信。")) return;
    var res = await client.from("blocks").insert({ blocked: id });
    if (res.error) alert(explainDb(res.error));
    await renderFriends();
  }

  async function unblockUser(id) {
    var res = await client.from("blocks").delete().eq("blocked", id);
    if (res.error) alert(explainDb(res.error));
    await renderFriends();
  }

  async function reportUser(id) {
    var reason = window.prompt("请用一句话说明要举报的原因", "");
    if (!reason || !reason.trim()) return;
    var res = await client.from("reports").insert({ target_user: id, reason: reason.trim().slice(0, 300) });
    alert(res.error ? explainDb(res.error) : "举报已提交。只有你能在自己的记录里看到它。");
  }

  async function searchFriend() {
    var out = $("friendSearchResult");
    if (!out) return;
    out.textContent = "";
    var gate = requireSocial();
    if (gate) { out.textContent = gate; return; }
    var q = ($("friendSearchInput").value || "").trim();
    if (!q) { out.textContent = "请输入要搜索的玩家名"; return; }
    var res = await client.rpc("search_players", { p_query: q, p_limit: 20 });
    if (res.error) { out.textContent = explainDb(res.error); return; }
    if (!res.data || !res.data.length) { out.textContent = "没有找到这个名字"; return; }
    res.data.forEach(function (p) {
      out.appendChild(row(p.display_name + "（" + p.username + "）", [
        button("加好友", "friend-btn", function () { sendRequest(p.id); }),
        button("拉黑", "friend-btn warn", function () { blockUser(p.id); }),
        button("举报", "friend-btn gray", function () { reportUser(p.id); })
      ]));
    });
  }

  async function sendRequest(id) {
    var res = await client.from("friend_requests").insert({ to_user: id });
    if (res.error) alert(explainDb(res.error));
    else alert("好友申请已发出。对方同意后才能私信。");
    await renderFriends();
  }

  function openChat(id, label) {
    chatWith = { id: id, label: label || "好友" };
    if ($("chatTitle")) $("chatTitle").textContent = "与 " + chatWith.label + " 聊天";
    if (window.closeAllOverlays) window.closeAllOverlays();
    $("chatOverlay").style.display = "flex";
    renderChat();
  }

  async function renderChat() {
    var box = $("chatBox");
    if (!box) return;
    box.textContent = "";
    var gate = requireSocial();
    if (gate) { emptyNode(box, gate); return; }
    if (!chatWith) { emptyNode(box, "先从好友列表选一个人"); return; }
    var res = await client.rpc("list_messages", { p_with: chatWith.id, p_before: null, p_limit: 30 });
    if (res.error) { emptyNode(box, explainDb(res.error)); return; }
    if (!res.data || !res.data.length) {
      emptyNode(box, "还没有可以看的私信。只有互为好友且没有拉黑时才能聊天。");
      return;
    }
    res.data.forEach(function (m) {
      var d = document.createElement("div");
      d.className = "chat-msg " + (m.sender_id === me.user.id ? "chat-me" : "chat-you");
      var text = document.createElement("div");
      text.textContent = m.body;
      var time = document.createElement("div");
      time.style.fontSize = "11px";
      time.style.opacity = "0.7";
      time.style.marginTop = "3px";
      time.textContent = formatTime(m.created_at);
      d.appendChild(text);
      d.appendChild(time);
      if (m.sender_id === me.user.id) {
        d.appendChild(button("删除", "friend-btn gray", function () { deleteMessage(m.id); }));
      }
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }

  async function sendChat() {
    var input = $("chatInput");
    var text = input ? input.value.trim() : "";
    if (!text || !chatWith) return;
    var gate = requireSocial();
    if (gate) { alert(gate); return; }
    var res = await client.from("messages").insert({ recipient_id: chatWith.id, body: text.slice(0, 500) });
    if (res.error) { alert(explainDb(res.error)); return; }
    input.value = "";
    await renderChat();
  }

  async function deleteMessage(id) {
    var res = await client.from("messages").delete().eq("id", id);
    if (res.error) alert(explainDb(res.error));
    await renderChat();
  }

  function resultFields(pending, text) {
    var rank = String((pending && pending.rank) || "").trim();
    if (["S", "A", "B", "C"].indexOf(rank) === -1) {
      return { error: "只有通关评级 S、A、B、C 可以发到圈子。没通关的成绩不会发出去，也不会被标成已核对。" };
    }
    var allowed = AVATARS;
    var charId = pending.charId && allowed[pending.charId] ? pending.charId : null;
    var diff = pending.custom ? "custom" : (pending.diff === "hard" ? "hard" : "normal");
    var score = Math.max(0, Math.min(10000000, Math.round(Number(pending.score) || 0)));
    var combo = Math.max(0, Math.min(100000, Math.round(Number(pending.combo) || 0)));
    var miss = Math.max(0, Math.min(100000, Math.round(Number(pending.miss) || 0)));
    var song = String(pending.song || "").trim().slice(0, 40);
    if (!song) return { error: "缺少曲名，没有发出去。" };
    return {
      row: {
        kind: "result",
        body: String(text || "").trim().slice(0, 200),
        result_song: song,
        result_diff: diff,
        result_rank: rank,
        result_score: score,
        result_combo: combo,
        result_miss: miss,
        result_char: charId
      }
    };
  }

  async function publishResult(pending, text) {
    var gate = requireSocial();
    if (gate) return { ok: false, msg: gate };
    var built = resultFields(pending, text);
    if (built.error) return { ok: false, msg: built.error };
    var res = await client.from("posts").insert(built.row);
    if (res.error) return { ok: false, msg: explainDb(res.error) };
    return { ok: true, msg: "已发到共同圈子。这是本机成绩，服务器没有核对，也不算防作弊记录。" };
  }

  async function publishText() {
    var gate = requireSocial();
    if (gate) { alert(gate); return; }
    var input = $("circleSayInput");
    var text = input ? input.value.trim() : "";
    if (!text) { alert("先写点什么再发"); return; }
    var res = await client.from("posts").insert({ kind: "text", body: text.slice(0, 200) });
    if (res.error) { alert(explainDb(res.error)); return; }
    input.value = "";
    await renderCircle(true);
  }

  async function renderCircle(reset) {
    var box = $("circleBox");
    var count = $("circleCount");
    if (!box) return;
    var gate = requireSocial();
    if (gate) {
      feedRows = [];
      emptyNode(box, gate);
      if (count) count.textContent = "共同圈子未打开";
      return;
    }
    if (reset !== false) {
      feedRows = [];
      feedCursor = null;
    }
    var res = await client.rpc("list_feed", { p_before: feedCursor, p_limit: 20 });
    if (res.error) {
      emptyNode(box, explainDb(res.error));
      return;
    }
    var page = res.data || [];
    feedRows = feedRows.concat(page);
    if (page.length) feedCursor = page[page.length - 1].created_at;
    box.textContent = "";
    if (count) count.textContent = "这一页共 " + feedRows.length + " 条。本机成绩未经服务器核对。";
    if (!feedRows.length) {
      emptyNode(box, "还没有动态。");
      return;
    }
    feedRows.forEach(function (p) { box.appendChild(postCard(p)); });
    var more = $("circleMoreBtn");
    if (more) more.style.display = page.length >= 20 ? "inline-block" : "none";
  }

  function postCard(p) {
    var card = document.createElement("div");
    card.className = "post-card";
    var img = document.createElement("img");
    img.className = "post-avatar";
    img.alt = "";
    img.src = avatarSrc(p.result_char || p.avatar_key);
    img.onerror = function () { img.style.display = "none"; };
    var main = document.createElement("div");
    main.className = "post-main";
    var head = document.createElement("div");
    head.className = "post-head";
    var who = document.createElement("span");
    who.textContent = p.display_name || p.username || "玩家";
    var when = document.createElement("span");
    when.style.color = "#888";
    when.textContent = formatTime(p.created_at);
    head.appendChild(who);
    head.appendChild(when);
    var body = document.createElement("div");
    body.className = "post-text";
    body.textContent = p.body || (p.kind === "result" ? "（分享了一局本机成绩）" : "");
    main.appendChild(head);
    main.appendChild(body);
    if (p.kind === "result") {
      var stat = document.createElement("div");
      stat.className = "post-stat";
      stat.textContent = p.result_song + " · " + (p.result_diff === "hard" ? "高级" : (p.result_diff === "custom" ? "自定义" : "普通"))
        + " · 评级 " + p.result_rank
        + "\n分数 " + p.result_score + " · 连击 " + p.result_combo + " · 失误 " + p.result_miss
        + "\n本机成绩，未经服务器核对";
      main.appendChild(stat);
    }
    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    var like = button((p.liked_by_me ? "已赞 " : "赞 ") + (p.like_count || 0), "post-like" + (p.liked_by_me ? " done" : ""), function () {
      toggleLike(p);
    });
    actions.appendChild(like);
    if (p.author_id === me.user.id) {
      actions.appendChild(button("删除", "friend-btn gray", function () { deletePost(p.id); }));
    } else {
      actions.appendChild(button("举报", "friend-btn gray", function () { reportPost(p.id); }));
    }
    main.appendChild(actions);
    card.appendChild(img);
    card.appendChild(main);
    return card;
  }

  async function toggleLike(p) {
    var res = p.liked_by_me
      ? await client.from("post_likes").delete().eq("post_id", p.id)
      : await client.from("post_likes").insert({ post_id: p.id });
    if (res.error) alert(explainDb(res.error));
    await renderCircle(true);
  }

  async function deletePost(id) {
    if (!confirm("删除这条自己的动态？")) return;
    var res = await client.from("posts").delete().eq("id", id);
    if (res.error) alert(explainDb(res.error));
    await renderCircle(true);
  }

  async function reportPost(id) {
    var reason = window.prompt("请用一句话说明要举报的原因", "");
    if (!reason || !reason.trim()) return;
    var res = await client.from("reports").insert({ target_post: id, reason: reason.trim().slice(0, 300) });
    alert(res.error ? explainDb(res.error) : "举报已提交。");
  }

  async function saveProfile() {
    var gate = requireSocial();
    if (gate && !me) { alert(gate); return; }
    var display = ($("profileDisplay").value || "").trim();
    var bio = ($("profileBio").value || "").trim();
    var avatar = $("profileAvatar").value || "";
    if (!display || display.length > 30 || /[<>]/.test(display)) {
      alert("昵称需要 1 到 30 个字，不能有尖括号。没有保存。");
      return;
    }
    var res = await client.from("profiles").update({
      display_name: display,
      bio: bio.slice(0, 200),
      avatar_key: avatar
    }).eq("id", me.user.id);
    if (res.error) { alert(explainDb(res.error)); return; }
    await loadProfile();
    if (window.refreshLobbyUI) window.refreshLobbyUI();
    await renderFriends();
  }

  function fillProfile() {
    var box = $("profileBox");
    if (!box) return;
    box.textContent = "";
    if (!me || !me.profile) {
      box.textContent = me && me.profileError ? me.profileError : "";
      return;
    }
    var mail = document.createElement("div");
    mail.style.fontSize = "12px";
    mail.style.color = "#aaa";
    mail.textContent = "登录名不能改。显示昵称可以改。没有自助找回密码。";
    var email = document.createElement("div");
    email.style.fontSize = "13px";
    email.style.color = "#4ecdc4";
    email.textContent = "登录名：" + (me.profile.username || "");
    function labeled(id, value, placeholder) {
      var input = document.createElement("input");
      input.id = id;
      input.value = value || "";
      input.placeholder = placeholder;
      input.maxLength = id === "profileBio" ? 200 : 30;
      input.style.cssText = "width:100%;padding:8px;border-radius:8px;border:1px solid #4ecdc4;background:#222;color:#fff";
      return input;
    }
    var bio = document.createElement("input");
    bio.id = "profileBio";
    bio.value = me.profile.bio || "";
    bio.placeholder = "一句话介绍，别人能看到";
    bio.maxLength = 200;
    bio.style.cssText = "width:100%;padding:8px;border-radius:8px;border:1px solid #4ecdc4;background:#222;color:#fff";
    var select = document.createElement("select");
    select.id = "profileAvatar";
    select.style.cssText = "width:100%;padding:8px;border-radius:8px;background:#222;color:#fff;border:1px solid #4ecdc4";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "默认头像";
    select.appendChild(empty);
    Object.keys(AVATARS).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = key;
      if (me.profile.avatar_key === key) opt.selected = true;
      select.appendChild(opt);
    });
    box.appendChild(mail);
    box.appendChild(email);
    box.appendChild(labeled("profileDisplay", me.profile.display_name, "显示昵称"));
    box.appendChild(bio);
    box.appendChild(select);
    box.appendChild(button("保存资料", "friend-btn", saveProfile));
  }

  async function onSubmit() {
    if (busy) return;
    var loginName = Status.normalizeLoginName($("accUsername").value);
    var email = Status.syntheticLoginEmail(loginName);
    var password = $("accPassword").value || "";
    var nickname = ($("accDisplay") && $("accDisplay").value || "").trim();
    var isReg = $("tabRegister").classList.contains("active");
    if (!configured()) {
      setTip("社交配置不完整，不能注册或登录。可以先在本机玩。");
      return;
    }
    if (!loginName || !email) {
      setTip("登录名需要 3 到 20 位，只能用小写字母、数字和下划线。大写会当成小写。中文请写在显示昵称里。没有登录。");
      return;
    }
    if (password.length < 6) {
      setTip("密码至少 6 位。没有登录。");
      return;
    }
    if (isReg && nickname && (nickname.length > 30 || /[<>]/.test(nickname))) {
      setTip("显示昵称最多 30 个字，不能有尖括号。没有登录。");
      return;
    }
    busy = true;
    try {
      ensureClient();
      if (!client) { setTip("Supabase 脚本没有加载。没有登录。"); return; }
      if (isReg) {
        var signed = await client.auth.signUp({
          email: email,
          password: password,
          options: { data: { display_name: nickname || loginName } }
        });
        var outcome = Status.signupOutcome(signed.data, signed.error);
        setTip(outcome.message);
        if (!outcome.signedIn) return;
        me = { user: signed.data.user, profile: null };
        await loadProfile();
        if (window.enterLobby) window.enterLobby({ flavor: true });
      } else {
        var logged = await client.auth.signInWithPassword({ email: email, password: password });
        if (logged.error || !logged.data || !logged.data.session) {
          setTip(Status.explainAuthError(logged.error || { message: "没有返回登录会话" }));
          return;
        }
        me = { user: logged.data.user, profile: null };
        await loadProfile();
        setTip("已登录。同一登录名可以在别的设备上再用密码进来。");
        if (window.enterLobby) window.enterLobby({ flavor: true });
      }
    } finally {
      busy = false;
      if (window.refreshLobbyUI) window.refreshLobbyUI();
    }
  }

  async function boot() {
    var linkError = hashError();
    if (linkError) setTip(linkError);
    else if (window.bengLegacyNotice) setTip(window.bengLegacyNotice);
    await refreshDiag();
    if (!ensureClient()) return;
    client.auth.onAuthStateChange(function (event, session) {
      if (event === "PASSWORD_RECOVERY") {
        setTip("这个试用版没有找回密码。没有处于登录状态时，忘了密码就不能再进这个登录名。");
      } else if (event === "SIGNED_OUT") {
        me = null;
        if (window.refreshLobbyUI) window.refreshLobbyUI();
      } else if (session && session.user && event === "SIGNED_IN") {
        me = { user: session.user, profile: me && me.profile };
      }
    });
    var got = await client.auth.getUser();
    if (got.error || !got.data || !got.data.user) {
      me = null;
      if (got.error && got.error.name !== "AuthSessionMissingError" && !/session missing/i.test(got.error.message || "")) {
        setTip("服务器没有确认登录：" + got.error.message + "。先当作未登录。本机进度还在。");
      }
      return;
    }
    me = { user: got.data.user, profile: null };
    await loadProfile();
    if (window.enterLobby) window.enterLobby({ flavor: false });
    if (window.refreshLobbyUI) window.refreshLobbyUI();
  }

  function bind() {
    if (bound) return;
    bound = true;
    function tab(reg) {
      $("tabLogin").classList.toggle("active", !reg);
      $("tabRegister").classList.toggle("active", reg);
      $("loginSubmitBtn").textContent = reg ? "注册" : "登录";
      if ($("accDisplay")) $("accDisplay").style.display = reg ? "block" : "none";
    }
    $("tabLogin").onclick = function () { tab(false); };
    $("tabRegister").onclick = function () { tab(true); };
    tab(false);
    $("loginSubmitBtn").onclick = function () { onSubmit(); };
    $("playLocalBtn").onclick = function () {
      setTip("正在使用本机进度。好友、私信和圈子需要登录，不会用旧的本地名单代替。");
      if (window.enterLobby) window.enterLobby({ flavor: false });
    };
    $("checkConnBtn").onclick = function () { refreshDiag(); };
  }

  async function logout() {
    if (client) await client.auth.signOut();
    me = null;
    chatWith = null;
    feedRows = [];
  }

  function afterLogout() {
    setTip("已退出登录。本机游戏进度还在这台设备上。忘了密码就不能再进这个登录名。");
  }

  window.BengSocial = {
    bind: bind,
    boot: boot,
    refreshDiag: refreshDiag,
    playerLabel: playerLabel,
    playerName: playerName,
    renderFriends: function () { fillProfile(); return renderFriends(); },
    searchFriend: searchFriend,
    renderCircle: function () { return renderCircle(true); },
    loadMoreCircle: function () { return renderCircle(false); },
    publishText: publishText,
    publishResult: publishResult,
    sendChat: sendChat,
    renderChat: renderChat,
    openChat: openChat,
    logout: logout,
    afterLogout: afterLogout,
    resultFields: resultFields,
    sessionClient: function () { return client; },
    selfId: function () { return me && me.user && me.user.id; }
  };
})();
