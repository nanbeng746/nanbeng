(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BengStatus = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var PROJECT_URL = "https://trnkjjpijiuaorhossim.supabase.co";

  function isConfigured(cfg) {
    if (!cfg || typeof cfg !== "object") return false;
    var url = String(cfg.url || "").trim().replace(/\/+$/, "");
    var key = String(cfg.publishableKey || "").trim();
    if (url !== PROJECT_URL) return false;
    if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return false;
    if (/service_role|sb_secret_/i.test(key)) return false;
    return true;
  }

  function normalizeLoginName(raw) {
    var name = String(raw || "").trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(name)) return "";
    return name;
  }

  function syntheticLoginEmail(raw) {
    var name = normalizeLoginName(raw);
    if (!name) return "";
    return "u_" + name + "@accounts.beng.invalid";
  }

  function explainAuthError(error) {
    var msg = String((error && (error.message || error.msg)) || "");
    var low = msg.toLowerCase();
    var code = String((error && error.code) || "");
    if (low.indexOf("email address not authorized") !== -1 || low.indexOf("email not confirmed") !== -1 || code === "email_address_not_authorized") {
      return "服务器还在要求验证邮件。登录名对应的内部地址不是真实邮箱，收不到信。请家长只在 beng-game 关掉 Confirm email 后再试。现在没有登录。";
    }
    if (low.indexOf("rate limit") !== -1 || code === "over_email_send_rate_limit") {
      return "认证服务拒绝了这次注册。如果它还在尝试发信，说明 Confirm email 还开着。现在没有登录。";
    }
    if (low.indexOf("invalid login") !== -1 || low.indexOf("invalid credentials") !== -1) {
      return "登录名或密码不对。没有登录。忘了密码又没有处于登录状态时，这个登录名找不回来。";
    }
    if (low.indexOf("password") !== -1) {
      return "密码至少 6 位。密码只交给 Supabase，不会写进本机存档。没有登录。";
    }
    if (low.indexOf("user already registered") !== -1 || low.indexOf("already been registered") !== -1) {
      return "这个登录名已经注册过。请直接登录。没有自助找回密码。现在没有登录。";
    }
    if (!msg) return "认证服务没有完成操作。没有登录。";
    return "认证服务返回：" + msg + "。没有登录。";
  }

  function signupOutcome(data, error) {
    if (error) {
      return { signedIn: false, pending: false, message: explainAuthError(error) };
    }
    var session = data && data.session;
    if (session && session.access_token) {
      return {
        signedIn: true,
        pending: false,
        message: "服务器发来了登录会话，所以这次已登录。这只说明认证服务接受了这次注册，不代表 accounts.beng.invalid 已经在所有情况下都试过。"
      };
    }
    return {
      signedIn: false,
      pending: true,
      message: "服务器没有建立登录会话。Confirm email 如果还开着，用户名注册不会完成，因为内部地址不是真实邮箱，也不会有验证信。请家长只在 beng-game 关掉 Confirm email 后再试。现在没有登录，游戏不会把这次注册当成成功。"
    };
  }

  function classifyProbes(probes) {
    var lines = [];
    if (!probes || probes.networkError) {
      return {
        level: "network",
        lines: ["连不上认证服务器。这台设备可能访问不了 supabase.co，好友、私信和圈子都不可用。不会改用本机假社交。"]
      };
    }
    var authStatus = probes.authStatus;
    var rootBody = String(probes.rootBody || "");
    var tableStatus = probes.tableStatus;
    var tableBody = String(probes.tableBody || "");
    var rootIsOpenApiRestriction = probes.rootStatus === 401 && (
      rootBody.indexOf("UNAUTHORIZED_INVALID_API_KEY_TYPE") !== -1
      || rootBody.indexOf("Secret API key required") !== -1
      || rootBody.indexOf("Only secret API keys") !== -1
    );
    if (authStatus >= 200 && authStatus < 300) {
      lines.push("认证服务有响应（HTTP " + authStatus + "）。这只说明地址通了，不代表验证邮件已经能寄给普通玩家。");
    } else {
      lines.push("认证服务没有正常响应（HTTP " + (authStatus || 0) + "）。");
    }
    if (rootIsOpenApiRestriction) {
      lines.push("接口目录 /rest/v1/ 返回 401，并提示需要 secret key。这是公开钥匙不能下载 OpenAPI 文档的限制，不代表钥匙是坏的。不要把 secret key 放进网页。");
    } else if (probes.rootStatus) {
      lines.push("接口目录 /rest/v1/ 返回 HTTP " + probes.rootStatus + "。");
    }
    var tableCode = "";
    try {
      tableCode = JSON.parse(tableBody).code || "";
    } catch (e) {
      tableCode = "";
    }
    var level = "unknown";
    if (tableCode === "PGRST205" || tableBody.indexOf("PGRST205") !== -1) {
      level = "migration_missing";
      lines.push("玩家资料表还不存在（PGRST205）。公开钥匙可以访问数据接口，但家长还没有执行社交数据库脚本。社交功能现在不能用。");
    } else if (tableStatus === 401 && (tableCode === "UNAUTHORIZED_INVALID_API_KEY_TYPE" || tableBody.indexOf("Invalid API key") !== -1)) {
      level = "key_rejected";
      lines.push("数据接口拒绝了这把公开钥匙。请核对 publishable key。");
    } else if (tableStatus === 200) {
      level = "bad_grants";
      lines.push("未登录却读到了玩家资料。这和脚本里的权限不一致，先不要使用社交功能。");
    } else if (tableStatus === 401 || tableStatus === 403) {
      level = "ready_for_login";
      lines.push("未登录时读取玩家资料被拒绝（HTTP " + tableStatus + "）。这是正常的，不代表数据接口坏了。登录后才能用好友、私信和圈子。");
    } else if (tableStatus) {
      level = "table_unexpected";
      lines.push("探测玩家资料表返回 HTTP " + tableStatus + "。社交功能先不要当成可用。");
    } else {
      level = "table_unexpected";
      lines.push("没有拿到玩家资料表的探测结果。");
    }
    if (!(authStatus >= 200 && authStatus < 300) && level !== "key_rejected") level = "auth_down";
    lines.push("登录名会转成 u_名字@accounts.beng.invalid。真实注册和换设备再登录还没在这里验过。没有会话就不是登录成功。");
    return { level: level, lines: lines };
  }

  return {
    PROJECT_URL: PROJECT_URL,
    isConfigured: isConfigured,
    normalizeLoginName: normalizeLoginName,
    syntheticLoginEmail: syntheticLoginEmail,
    explainAuthError: explainAuthError,
    signupOutcome: signupOutcome,
    classifyProbes: classifyProbes
  };
});
